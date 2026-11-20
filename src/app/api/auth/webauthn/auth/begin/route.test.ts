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

function post(cookie?: string) {
  return POST(
    new Request("http://localhost/api/auth/webauthn/auth/begin", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        "sec-fetch-site": "same-origin",
      },
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setChallengeStoreForTests(undefined)
  setCredentialStoreForTests(undefined)
})

describe("POST /api/auth/webauthn/auth/begin", () => {
  it("works anonymously with empty allowCredentials (discoverable flow)", async () => {
    const response = await post()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.challengeId).toBeTruthy()
    expect(body.options.challenge).toBeTruthy()
    expect(body.options.rpId).toBe("localhost")
    expect(body.options.allowCredentials).toEqual([])
  })

  it("scopes allowCredentials to the signed-in user's keys", async () => {
    const { getCredentialStore } = await import("@/lib/webauthn/credential-store")
    getCredentialStore().save({
      userId: user.id,
      credentialId: "key-1",
      publicKeyCose: "e30",
      counter: 0,
      transports: ["internal"],
      aaguid: null,
    })
    getCredentialStore().save({
      userId: "other",
      credentialId: "key-2",
      publicKeyCose: "e30",
      counter: 0,
      transports: [],
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
    expect(body.options.allowCredentials).toEqual([
      { type: "public-key", id: "key-1", transports: ["internal"] },
    ])
  })
})
