// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { setDeviceFingerprintStoreForTests } from "@/lib/auth/fingerprint"
import { DELETE, POST } from "./route"

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

const HASH_A = "fp1:" + "a".repeat(64)
const HASH_B = "fp1:" + "b".repeat(64)

function accessCookie(uid = user.id, sid = "s1") {
  return createAccessToken({ sid, uid, email: user.email, name: user.name }).token
}

function post(body: unknown, options: { cookie?: string; origin?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  if (options.ip) headers["x-forwarded-for"] = options.ip
  return POST(
    new Request("http://localhost/api/auth/fingerprint", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function del(options: { cookie?: string; origin?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {}
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  if (options.ip) headers["x-forwarded-for"] = options.ip
  return DELETE(
    new Request("http://localhost/api/auth/fingerprint", {
      method: "DELETE",
      headers,
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setDeviceFingerprintStoreForTests(undefined)
})

describe("POST /api/auth/fingerprint", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post(
      { fingerprint: HASH_A },
      { cookie: accessCookie(), origin: "https://evil.example" },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post({ fingerprint: HASH_A })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects a token whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await post({ fingerprint: HASH_A }, { cookie: accessCookie() })
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON and invalid fingerprints", async () => {
    const badJson = await post("{not json", { cookie: accessCookie() })
    expect(badJson.status).toBe(400)

    for (const body of [
      {},
      { fingerprint: "not-a-fingerprint" },
      { fingerprint: 42 },
      { fingerprint: "fp1:tooshort" },
    ]) {
      const response = await post(body, { cookie: accessCookie() })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("registers a fingerprint and reports match transitions", async () => {
    const first = await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toMatchObject({
      ok: true,
      match: "new",
      fingerprint: { version: "fp1", hash: HASH_A, seenCount: 1 },
    })

    // Same session, same hash -> known, seenCount increments.
    const second = await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })
    const secondBody = await second.json()
    expect(secondBody.match).toBe("known")
    expect(secondBody.fingerprint.seenCount).toBe(2)

    // Same user, new session, different hash -> changed.
    const third = await post({ fingerprint: HASH_B }, { cookie: accessCookie("u1", "s2") })
    const thirdBody = await third.json()
    expect(thirdBody.match).toBe("changed")
    expect(thirdBody.fingerprint.hash).toBe(HASH_B)

    // A different user with the same hash is still 'new' for them.
    const other = await post({ fingerprint: HASH_A }, { cookie: accessCookie("u2", "s9") })
    const otherBody = await other.json()
    expect(otherBody.match).toBe("new")
  })

  it("accepts same-origin requests explicitly", async () => {
    const response = await post(
      { fingerprint: HASH_A },
      { cookie: accessCookie(), origin: "http://localhost" },
    )
    expect(response.status).toBe(200)
  })

  it("rate-limits excessive requests per client IP", async () => {
    // Dedicated IP so the shared "unknown" bucket used by other tests is
    // unaffected; the limiter allows 30 requests per minute.
    const ip = "203.0.113.99"
    let lastStatus = 0
    for (let i = 0; i < 31; i += 1) {
      const response = await post({ fingerprint: HASH_A }, { cookie: accessCookie(), ip })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
    const limited = await post({ fingerprint: HASH_A }, { cookie: accessCookie(), ip })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ ok: false, code: "rate_limited" })
  })
})

describe("DELETE /api/auth/fingerprint", () => {
  it("rejects cross-origin and unauthenticated requests", async () => {
    expect((await del({ origin: "https://evil.example", cookie: accessCookie() })).status).toBe(403)
    expect((await del()).status).toBe(401)
  })

  it("removes the caller's session fingerprint record", async () => {
    await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })

    const removed = await del({ cookie: accessCookie("u1", "s1") })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ ok: true, removed: true })

    // Second delete is idempotent.
    const again = await del({ cookie: accessCookie("u1", "s1") })
    expect(await again.json()).toMatchObject({ ok: true, removed: false })

    // The session's record is gone: re-registering reads 'new' again.
    const reRegister = await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })
    expect((await reRegister.json()).match).toBe("new")
  })

  it("does not remove another session's record", async () => {
    await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })
    await del({ cookie: accessCookie("u1", "s2") })

    // s1's record survives a delete scoped to s2.
    const reRegister = await post({ fingerprint: HASH_A }, { cookie: accessCookie("u1", "s1") })
    expect((await reRegister.json()).match).toBe("known")
  })
})
