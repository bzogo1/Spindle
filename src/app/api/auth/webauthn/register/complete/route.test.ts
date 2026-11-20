// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getChallengeStore, setChallengeStoreForTests } from "@/lib/webauthn/challenge-store"
import { getCredentialStore, setCredentialStoreForTests } from "@/lib/webauthn/credential-store"
import { makeRegistrationFixture } from "@/lib/webauthn/test-utils"
import { base64urlEncode } from "@/lib/webauthn/types"
import { POST } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return { ...actual, getAuthBackend: () => ({ getUserById }) }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookie() {
  return `${ACCESS_COOKIE}=${createAccessToken({ sid: "s", uid: user.id, email: user.email, name: user.name }).token}`
}

function post(body: unknown, cookieHeader?: string) {
  return POST(
    new Request("http://localhost/api/auth/webauthn/register/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    }),
  )
}

/** Issues a register challenge and returns {challengeId, challengeB64}. */
function issueChallenge(userId = user.id, kind?: "passkey" | "security-key") {
  const record = getChallengeStore().issue({ userId, purpose: "register", kind })
  return { challengeId: record.id, challengeB64: record.challenge }
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setChallengeStoreForTests(undefined)
  setCredentialStoreForTests(undefined)
})

describe("POST /api/auth/webauthn/register/complete", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post({ challengeId: "x", credential: {} })
    expect(response.status).toBe(401)
  })

  it("rejects an unknown or wrong-purpose challenge", async () => {
    const response = await post({ challengeId: "nope", credential: {} }, cookie())
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("invalid_challenge")

    // A challenge issued for "authenticate" cannot complete registration.
    const authChallenge = getChallengeStore().issue({ userId: user.id, purpose: "authenticate" })
    const response2 = await post({ challengeId: authChallenge.id, credential: {} }, cookie())
    expect(response2.status).toBe(400)
  })

  it("rejects malformed credential payloads with 400", async () => {
    const { challengeId } = issueChallenge()
    const response = await post({ challengeId, credential: { bogus: true } }, cookie())
    expect(response.status).toBe(400)
  })

  it("completes a full 'none' attestation ceremony and stores the credential", async () => {
    const { challengeId, challengeB64 } = issueChallenge()
    const fixture = makeRegistrationFixture({ challengeB64 })

    const response = await post(
      {
        challengeId,
        credential: fixture.credentialJSON,
        label: "  My YubiKey  ",
      },
      cookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.credential.label).toBe("My YubiKey")
    expect(body.credential.id).toBe(fixture.credentialJSON.id)
    // The stored record keeps only public material.
    const stored = getCredentialStore().findActiveByCredentialId(
      fixture.credentialJSON.id as string,
    )
    expect(stored?.userId).toBe(user.id)
    expect(stored?.publicKeyCose).toBe(fixture.key.coseB64)

    // Challenge is single-use.
    const replay = await post({ challengeId, credential: fixture.credentialJSON }, cookie())
    expect(replay.status).toBe(400)
  })

  it("rejects a credential whose challenge does not match", async () => {
    const { challengeId } = issueChallenge()
    const fixture = makeRegistrationFixture({ challengeB64: base64urlEncode("forged") })
    const response = await post({ challengeId, credential: fixture.credentialJSON }, cookie())
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe("challenge_mismatch")
  })

  it("stores kind 'passkey' when the challenge was issued for a passkey", async () => {
    const { challengeId, challengeB64 } = issueChallenge(user.id, "passkey")
    const fixture = makeRegistrationFixture({ challengeB64 })

    const response = await post({ challengeId, credential: fixture.credentialJSON }, cookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.credential.kind).toBe("passkey")
    // Passkeys get a passkey-flavoured default label.
    expect(body.credential.label).toBe("Passkey")

    const stored = getCredentialStore().findActiveByCredentialId(
      fixture.credentialJSON.id as string,
    )
    expect(stored?.kind).toBe("passkey")
  })

  it("stores kind 'security-key' for plain registration challenges", async () => {
    const { challengeId, challengeB64 } = issueChallenge()
    const fixture = makeRegistrationFixture({ challengeB64 })

    const response = await post({ challengeId, credential: fixture.credentialJSON }, cookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.credential.kind).toBe("security-key")
  })

  it("returns 409 when the credential id is already registered", async () => {
    const { challengeId, challengeB64 } = issueChallenge()
    const fixture = makeRegistrationFixture({ challengeB64 })
    getCredentialStore().save({
      userId: "someone-else",
      credentialId: fixture.credentialJSON.id as string,
      publicKeyCose: fixture.key.coseB64,
      counter: 0,
      transports: [],
      aaguid: null,
    })
    const response = await post({ challengeId, credential: fixture.credentialJSON }, cookie())
    expect(response.status).toBe(409)
  })
})
