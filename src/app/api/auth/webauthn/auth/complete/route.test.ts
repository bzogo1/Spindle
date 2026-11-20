// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { getChallengeStore, setChallengeStoreForTests } from "@/lib/webauthn/challenge-store"
import { getCredentialStore, setCredentialStoreForTests } from "@/lib/webauthn/credential-store"
import { bytesToB64, makeAssertionFixture, makeEcKey } from "@/lib/webauthn/test-utils"
import { POST } from "./route"

const getUserById = vi.fn()
const createSessionForUser = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, createSessionForUser }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const tokens = {
  accessToken: "at",
  refreshToken: "rt",
  session: {
    user,
    workspace: null,
    sessionId: "sess-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
}

function post(body: unknown, ip = "203.0.113.10") {
  return POST(
    new Request("http://localhost/api/auth/webauthn/auth/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        // The route's per-IP limiter (10/10min) is module-level; distinct IPs
        // per test keep the suite under the budget.
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    }),
  )
}

/** Registers a credential directly in the store; returns fixture pieces. */
function seedCredential(userId = user.id) {
  const key = makeEcKey()
  const credentialIdBytes = new Uint8Array(16).fill(5)
  const credentialId = bytesToB64(credentialIdBytes)
  getCredentialStore().save({
    userId,
    credentialId,
    publicKeyCose: key.coseB64,
    counter: 0,
    transports: ["usb"],
    aaguid: null,
  })
  return { key, credentialIdBytes, credentialId }
}

function issueAuthChallenge(userId = "") {
  return getChallengeStore().issue({ userId, purpose: "authenticate" })
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  createSessionForUser.mockReset().mockResolvedValue(tokens)
  setChallengeStoreForTests(undefined)
  setCredentialStoreForTests(undefined)
})

describe("POST /api/auth/webauthn/auth/complete", () => {
  it("rejects malformed bodies and unknown credentials", async () => {
    expect((await post({})).status).toBe(400)
    // Missing credential payload → treated as an invalid assertion (401),
    // not a malformed-request 400: the endpoint never confirms which part
    // of the payload was wrong.
    expect((await post({ challengeId: "x" })).status).toBe(401)

    const unknown = makeAssertionFixture(makeEcKey())
    const response = await post({
      challengeId: "whatever",
      credential: unknown.credentialJSON,
    })
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe("invalid_assertion")
  })

  it("signs in the credential owner with a valid anonymous-challenge assertion", async () => {
    const { key, credentialIdBytes } = seedCredential()
    const challenge = issueAuthChallenge("") // anonymous discoverable flow
    const fixture = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
      signCount: 1,
      storedCounter: 0,
      userHandle: user.id, // passkeys echo the UTF-8 user id as userHandle
    })

    const response = await post({
      challengeId: challenge.id,
      credential: fixture.credentialJSON,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.session.sessionId).toBe("sess-1")
    expect(response.headers.get("set-cookie")).toContain(ACCESS_COOKIE)
    expect(createSessionForUser).toHaveBeenCalledWith(user.id)
    // Counter was persisted.
    const stored = getCredentialStore().findActiveByCredentialId(
      fixture.credentialJSON.id as string,
    )
    expect(stored?.counter).toBe(1)
    expect(typeof stored?.lastUsedAt).toBe("string")
  })

  it("accepts a session-bound challenge issued by auth/begin", async () => {
    const { key, credentialIdBytes } = seedCredential()
    const challenge = issueAuthChallenge(user.id)
    const fixture = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
      signCount: 2,
      storedCounter: 1,
    })
    const response = await post({
      challengeId: challenge.id,
      credential: fixture.credentialJSON,
    })
    expect(response.status).toBe(200)
  })

  it("rejects replayed challenges and bad signatures", async () => {
    const { key, credentialIdBytes } = seedCredential()
    const challenge = issueAuthChallenge("")
    const fixture = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
      signCount: 1,
      userHandle: user.id,
    })

    const first = await post({ challengeId: challenge.id, credential: fixture.credentialJSON })
    expect(first.status).toBe(200)
    const replay = await post({ challengeId: challenge.id, credential: fixture.credentialJSON })
    expect(replay.status).toBe(400)

    // Fresh challenge but a signature that does not verify.
    const challenge2 = issueAuthChallenge("")
    const bad = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge2.challenge,
      signCount: 2,
      tamper: true,
      userHandle: user.id,
    })
    const badResponse = await post({ challengeId: challenge2.id, credential: bad.credentialJSON })
    expect(badResponse.status).toBe(401)
    expect((await badResponse.json()).code).toBe("invalid_assertion")
    expect(createSessionForUser).toHaveBeenCalledTimes(1)
  })

  it("enforces the userHandle on the discoverable (anonymous) path", async () => {
    const { key, credentialIdBytes } = seedCredential()

    // A different user id in the userHandle must be rejected.
    const challenge = issueAuthChallenge("")
    const wrongHandle = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
      signCount: 1,
      userHandle: "someone-else",
    })
    const mismatch = await post(
      { challengeId: challenge.id, credential: wrongHandle.credentialJSON },
      "203.0.113.21",
    )
    expect(mismatch.status).toBe(401)
    expect((await mismatch.json()).code).toBe("invalid_assertion")

    // A missing userHandle cannot answer an empty-allowCredentials request.
    const challenge2 = issueAuthChallenge("")
    const noHandle = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge2.challenge,
      signCount: 1,
    })
    const missing = await post(
      { challengeId: challenge2.id, credential: noHandle.credentialJSON },
      "203.0.113.21",
    )
    expect(missing.status).toBe(401)
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("rejects a mismatched userHandle even on session-bound challenges", async () => {
    const { key, credentialIdBytes } = seedCredential()
    const challenge = issueAuthChallenge(user.id)
    const fixture = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
      signCount: 1,
      userHandle: "other-user",
    })
    const response = await post(
      { challengeId: challenge.id, credential: fixture.credentialJSON },
      "203.0.113.22",
    )
    expect(response.status).toBe(401)
  })

  it("rejects assertions for revoked credentials", async () => {
    const { key, credentialIdBytes, credentialId } = seedCredential()
    getCredentialStore().revoke(user.id, credentialId)
    const challenge = issueAuthChallenge("")
    const fixture = makeAssertionFixture(key, {
      credentialId: credentialIdBytes,
      challengeB64: challenge.challenge,
    })
    const response = await post({ challengeId: challenge.id, credential: fixture.credentialJSON })
    expect(response.status).toBe(401)
  })
})
