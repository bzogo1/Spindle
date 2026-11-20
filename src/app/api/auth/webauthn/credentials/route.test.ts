// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { setCredentialStoreForTests } from "@/lib/webauthn/credential-store"
import { GET } from "./route"

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

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/auth/webauthn/credentials", {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setCredentialStoreForTests(undefined)
})

describe("GET /api/auth/webauthn/credentials", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await get()).status).toBe(401)
  })

  it("returns only the caller's credentials, without key material", async () => {
    const { getCredentialStore } = await import("@/lib/webauthn/credential-store")
    getCredentialStore().save({
      userId: user.id,
      credentialId: "key-1",
      publicKeyCose: "SECRET-COSE",
      counter: 3,
      transports: ["usb"],
      aaguid: "aaguid-b64",
      label: "YubiKey",
    })
    getCredentialStore().save({
      userId: "other",
      credentialId: "key-2",
      publicKeyCose: "e30",
      counter: 0,
      transports: [],
      aaguid: null,
    })
    getCredentialStore().save({
      userId: user.id,
      credentialId: "key-revoked",
      publicKeyCose: "e30",
      counter: 0,
      transports: [],
      aaguid: null,
    })
    getCredentialStore().revoke(user.id, "key-revoked")

    const cookie = createAccessToken({
      sid: "s",
      uid: user.id,
      email: user.email,
      name: user.name,
    }).token
    const response = await get(cookie)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.credentials).toHaveLength(1)
    expect(body.credentials[0]).toMatchObject({
      id: "key-1",
      label: "YubiKey",
      transports: ["usb"],
    })
    expect(JSON.stringify(body)).not.toContain("SECRET-COSE")
    expect(JSON.stringify(body)).not.toContain("aaguid")
  })
})
