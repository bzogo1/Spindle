// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  MemoryPasswordRotationStore,
  setPasswordRotationStoreForTests,
} from "@/lib/password-rotation"
import { createAccessToken } from "@/lib/auth/token-codec"
import { POST } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let store: MemoryPasswordRotationStore

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/password/rotation/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) => (id === "u1" ? { ...user, id } : null))
  store = new MemoryPasswordRotationStore()
  setPasswordRotationStoreForTests(store)
})

describe("POST /api/auth/password/rotation/record", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post({ password: "x" }, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    expect((await post({ password: "x" })).status).toBe(401)
  })

  it("rejects tokens whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    expect((await post({ password: "x" }, accessCookie())).status).toBe(401)
  })

  it("rejects malformed bodies", async () => {
    expect((await post("not json", accessCookie())).status).toBe(400)
    expect((await post({}, accessCookie())).status).toBe(400)
    expect((await post({ password: "" }, accessCookie())).status).toBe(400)
    expect((await post({ password: "x", extra: 1 }, accessCookie())).status).toBe(400)
  })

  it("records the change and returns bookkeeping fields", async () => {
    const response = await post({ password: "new-secret-password" }, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.passwordChangedAt).not.toBeNull()
    expect(data.historySize).toBe(1)

    const record = store.getRecord("u1")
    expect(record.passwordChangedAt).toBe(data.passwordChangedAt)
    expect(record.historyHashes).toHaveLength(1)
    expect(record.historyHashes[0]).toMatch(/^scrypt\$/)
  })

  it("always hashes plaintext — even values resembling scrypt hashes", async () => {
    // The endpoint is plaintext-only bookkeeping; a password that starts
    // with "scrypt$" must still be hashed, not stored verbatim.
    const response = await post({ password: "scrypt$deadbeef$not-a-real-hash" }, accessCookie())
    expect(response.status).toBe(200)
    const record = store.getRecord("u1")
    expect(record.historyHashes[0]).not.toBe("scrypt$deadbeef$not-a-real-hash")
    expect(record.historyHashes[0]).toMatch(/^scrypt\$/)
  })
})
