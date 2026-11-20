// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getCredentialStore, setCredentialStoreForTests } from "@/lib/webauthn/credential-store"
import { DELETE, PATCH } from "./route"

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

const other = { ...user, id: "u2", email: "grace@lab.edu" }

function cookie(uid = user.id, email = user.email) {
  return `${ACCESS_COOKIE}=${createAccessToken({ sid: "s", uid, email, name: "X" }).token}`
}

function makeRequest(method: "DELETE" | "PATCH", body?: unknown, cookieHeader?: string) {
  return new Request(`http://localhost/api/auth/webauthn/credentials/k`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      "sec-fetch-site": "same-origin",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function save(userId: string, id: string, label = "Key") {
  getCredentialStore().save({
    userId,
    credentialId: id,
    publicKeyCose: "e30",
    counter: 0,
    transports: [],
    aaguid: null,
    label,
  })
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) =>
      id === user.id ? user : id === other.id ? other : null,
    )
  setCredentialStoreForTests(undefined)
})

describe("DELETE /api/auth/webauthn/credentials/[id]", () => {
  it("rejects unauthenticated and cross-origin requests", async () => {
    expect((await DELETE(makeRequest("DELETE"), params("k"))).status).toBe(401)

    const crossOrigin = new Request("http://localhost/api/auth/webauthn/credentials/k", {
      method: "DELETE",
      headers: { cookie: cookie(), origin: "https://evil.example" },
    })
    expect((await DELETE(crossOrigin, params("k"))).status).toBe(403)
  })

  it("revokes the caller's credential and 404s on foreign/missing ids", async () => {
    save(user.id, "mine")
    save(other.id, "theirs")

    // Foreign id is indistinguishable from missing.
    expect(
      (await DELETE(makeRequest("DELETE", undefined, cookie()), params("theirs"))).status,
    ).toBe(404)
    expect((await DELETE(makeRequest("DELETE", undefined, cookie()), params("nope"))).status).toBe(
      404,
    )

    const own = await DELETE(makeRequest("DELETE", undefined, cookie()), params("mine"))
    expect(own.status).toBe(200)
    expect(getCredentialStore().findActiveByCredentialId("mine")).toBeNull()
    // Other user's credential untouched.
    expect(getCredentialStore().findActiveByCredentialId("theirs")?.userId).toBe(other.id)
  })
})

describe("PATCH /api/auth/webauthn/credentials/[id]", () => {
  it("renames the caller's credential", async () => {
    save(user.id, "mine", "Old")
    const response = await PATCH(
      makeRequest("PATCH", { label: "New name" }, cookie()),
      params("mine"),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.credential.label).toBe("New name")
  })

  it("rejects bad bodies and foreign ids", async () => {
    save(other.id, "theirs")
    expect(
      (await PATCH(makeRequest("PATCH", { label: 42 }, cookie()), params("theirs"))).status,
    ).toBe(400)
    expect(
      (await PATCH(makeRequest("PATCH", { label: "x" }, cookie()), params("theirs"))).status,
    ).toBe(404)
  })
})
