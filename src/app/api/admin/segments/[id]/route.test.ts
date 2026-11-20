// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import type { AuthBackend } from "@/lib/auth/backend"
import { MemoryAuthBackend } from "@/lib/auth/backend"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearSegmentsForTests, createSegment } from "@/lib/segments"

import { DELETE, GET } from "./route"

const backendHolder = vi.hoisted(() => ({
  current: null as AuthBackend | null,
}))

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => backendHolder.current,
  }
})

let backend: MemoryAuthBackend
let adminUid: string

function adminCookie() {
  return createAccessToken({ sid: "s1", uid: adminUid, email: "admin@example.com", name: "A" })
    .token
}

function userCookie(uid: string, email: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "U" }).token
}

let ipCounter = 0

function request(
  method: "GET" | "DELETE",
  id: string,
  options: { cookie?: string; origin?: string } = {},
) {
  ipCounter += 1
  return (method === "GET" ? GET : DELETE)(
    new Request(`http://localhost/api/admin/segments/${id}`, {
      method,
      headers: {
        "x-forwarded-for": `10.9.7.${ipCounter}`,
        ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      },
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(async () => {
  backend = new MemoryAuthBackend()
  backendHolder.current = backend
  const admin = await backend.signUp({
    email: "admin@example.com",
    password: "password123",
    workspaceName: "Admin WS",
  })
  adminUid = admin.user.id
  await backend.signUp({
    email: "member@other.org",
    password: "password123",
    workspaceName: "Member WS",
  })
  setAdminEmailsForTests(["admin@example.com"])
  clearSegmentsForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/segments/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    const response = await request("GET", segment.id)
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    const member = await backend.getUserByEmail("member@other.org")
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    const response = await request("GET", segment.id, {
      cookie: userCookie(member!.id, "member@other.org"),
    })
    expect(response.status).toBe(403)
  })

  it("returns 404 for an unknown segment", async () => {
    const response = await request("GET", "seg_missing", { cookie: adminCookie() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("evaluates the segment against backend users", async () => {
    // Give the member a live session.
    await backend.signIn("member@other.org", "password123")
    const segment = createSegment({
      name: "Active members",
      combinator: "any",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })

    const response = await request("GET", segment.id, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.segment.id).toBe(segment.id)
    expect(body.evaluatedUsers).toBe(2)
    expect(body.matchCount).toBe(1)
    expect(body.sample).toEqual(["member@other.org"])
  })

  it("reports zero matches when the backend exposes no user store", async () => {
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    // A backend that resolves the admin but exposes no in-memory user store.
    backendHolder.current = {
      getUserById: async (id: string) =>
        id === adminUid
          ? {
              id: adminUid,
              email: "admin@example.com",
              name: null,
              emailVerified: true,
              createdAt: "",
            }
          : null,
    } as unknown as AuthBackend
    const response = await request("GET", segment.id, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.matchCount).toBe(0)
    expect(body.evaluatedUsers).toBe(0)
    expect(body.sample).toEqual([])
  })
})

describe("DELETE /api/admin/segments/[id]", () => {
  it("rejects cross-origin requests with 403", async () => {
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    const response = await request("DELETE", segment.id, {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    // The segment must not have been deleted.
    expect((await request("GET", segment.id, { cookie: adminCookie() })).status).toBe(200)
  })

  it("rejects unauthenticated requests with 401", async () => {
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    const response = await request("DELETE", segment.id)
    expect(response.status).toBe(401)
  })

  it("returns 404 for an unknown segment", async () => {
    const response = await request("DELETE", "seg_missing", { cookie: adminCookie() })
    expect(response.status).toBe(404)
  })

  it("deletes an existing segment", async () => {
    const segment = createSegment({
      name: "s",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    const response = await request("DELETE", segment.id, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, deleted: true })
    expect((await request("GET", segment.id, { cookie: adminCookie() })).status).toBe(404)
  })
})
