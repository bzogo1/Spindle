// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { setChallengeStoreForTests } from "@/lib/webauthn/challenge-store"
import { setCredentialStoreForTests } from "@/lib/webauthn/credential-store"
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

function post(cookie?: string, body?: unknown) {
  return POST(
    new Request("http://localhost/api/auth/webauthn/register/begin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        "sec-fetch-site": "same-origin",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setChallengeStoreForTests(undefined)
  setCredentialStoreForTests(undefined)
})

describe("POST /api/auth/webauthn/register/begin", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post()
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/webauthn/register/begin", {
        method: "POST",
        headers: {
          cookie: `${ACCESS_COOKIE}=${createAccessToken({ sid: "s", uid: user.id, email: user.email, name: user.name }).token}`,
          origin: "https://evil.example",
        },
      }),
    )
    expect(response.status).toBe(403)
  })

  it("returns creation options bound to the user and rpId", async () => {
    const cookie = createAccessToken({
      sid: "s",
      uid: user.id,
      email: user.email,
      name: user.name,
    }).token
    const response = await post(cookie)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.challengeId).toBeTruthy()
    expect(body.options.rp.id).toBe("localhost")
    expect(body.options.rp.name).toBe("Spindle")
    expect(body.options.user.name).toBe(user.email)
    expect(body.options.attestation).toBe("none")
    expect(body.options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }])
    expect(body.options.excludeCredentials).toEqual([])
  })

  it("lists existing credentials as excludeCredentials", async () => {
    const { getCredentialStore } = await import("@/lib/webauthn/credential-store")
    getCredentialStore().save({
      userId: user.id,
      credentialId: "existing-key",
      publicKeyCose: "e30",
      counter: 0,
      transports: ["usb"],
      aaguid: null,
    })
    const cookie = createAccessToken({
      sid: "s",
      uid: user.id,
      email: user.email,
      name: user.name,
    }).token
    const response = await post(cookie)
    const body = await response.json()
    expect(body.options.excludeCredentials).toEqual([
      { type: "public-key", id: "existing-key", transports: ["usb"] },
    ])
  })

  it("emits resident-key (passkey) options when the body asks for a passkey", async () => {
    const cookie = createAccessToken({
      sid: "s",
      uid: user.id,
      email: user.email,
      name: user.name,
    }).token
    const response = await post(cookie, { passkey: true })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.options.authenticatorSelection).toEqual({
      residentKey: "required",
      userVerification: "preferred",
      requireResidentKey: true,
    })
    // user.id stays the base64url UTF-8 user id — the discoverable user handle.
    expect(Buffer.from(body.options.user.id, "base64url").toString()).toBe(user.id)
  })

  it("defaults to security-key options for absent or non-passkey bodies", async () => {
    const cookie = createAccessToken({
      sid: "s",
      uid: user.id,
      email: user.email,
      name: user.name,
    }).token
    for (const body of [undefined, {}, { passkey: false }, { passkey: "yes" }]) {
      const response = await post(cookie, body)
      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json.options.authenticatorSelection.residentKey).toBe("preferred")
      expect(json.options.authenticatorSelection.requireResidentKey).toBe(false)
    }
  })
})
