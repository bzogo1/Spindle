// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearContactSubmissions, routeSubmission } from "@/lib/contact-routing"

import { GET, PATCH } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(method: "GET" | "PATCH", path = "", body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.20.0.${ipCounter}`,
    "content-type": "application/json",
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return (method === "GET" ? GET : PATCH)(
    new Request(`http://localhost/api/admin/contact${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function seed() {
  routeSubmission({
    id: "CT-00000001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    topic: "billing",
    subject: "Invoice question",
    message: "I was charged twice for my subscription invoice.",
  })
  routeSubmission({
    id: "CT-00000002",
    name: "Grace Hopper",
    email: "grace@navy.mil",
    topic: "product",
    subject: "Compiler bug",
    message: "The export feature crashes on large files.",
  })
  routeSubmission({
    id: "CT-00000003",
    name: "Spam Bot",
    email: "bot@spam.example",
    topic: "other",
    subject: "Buy now",
    message: "Cheap pills !!!",
    status: "spam",
    spamSignals: ["repeated-chars"],
  })
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearContactSubmissions()
  seed()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/contact", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await request("GET", "", undefined, cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists submissions newest-first for an admin", async () => {
    const response = await request("GET", "", undefined, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(3)
    expect(body.submissions).toHaveLength(3)
    expect(body.submissions[0].id).toBe("CT-00000003") // newest first
    expect(body.submissions[0].message).toContain("Cheap pills")
  })

  it("filters by status and queue", async () => {
    const spam = await (await request("GET", "?status=spam", undefined, adminCookie())).json()
    expect(spam.total).toBe(1)
    expect(spam.submissions[0].id).toBe("CT-00000003")

    const billing = await (await request("GET", "?queue=billing", undefined, adminCookie())).json()
    expect(billing.total).toBe(1)
    expect(billing.submissions[0].routedTo).toBe("billing")

    const support = await (await request("GET", "?queue=support", undefined, adminCookie())).json()
    expect(support.total).toBe(1)
    expect(support.submissions[0].id).toBe("CT-00000002")
  })

  it("searches across identifying fields", async () => {
    const response = await request("GET", "?q=navy.mil", undefined, adminCookie())
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.submissions[0].name).toBe("Grace Hopper")
  })

  it("paginates with limit and offset", async () => {
    const page = await (await request("GET", "?limit=2&offset=2", undefined, adminCookie())).json()
    expect(page.total).toBe(3)
    expect(page.submissions).toHaveLength(1)
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(2)
  })

  it.each([
    ["?status=bogus", "invalid status"],
    ["?queue=bogus", "invalid queue"],
    ["?limit=abc", "invalid limit"],
    ["?offset=-1", "invalid offset"],
  ])("rejects %s (%s)", async (query) => {
    const response = await request("GET", query, undefined, adminCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})

describe("PATCH /api/admin/contact", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("PATCH", "", { id: "CT-00000001", status: "resolved" })
    expect(response.status).toBe(401)
  })

  it("updates a submission's status and assignee", async () => {
    const response = await request(
      "PATCH",
      "",
      { id: "CT-00000001", status: "in_progress", assignee: "admin@x.io" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.submission.status).toBe("in_progress")
    expect(body.submission.assignee).toBe("admin@x.io")

    const listed = await (
      await request("GET", "?status=in_progress", undefined, adminCookie())
    ).json()
    expect(listed.total).toBe(1)
    expect(listed.submissions[0].id).toBe("CT-00000001")
  })

  it("returns 404 for an unknown id", async () => {
    const response = await request(
      "PATCH",
      "",
      { id: "CT-NOPE", status: "resolved" },
      adminCookie(),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("rejects invalid bodies", async () => {
    const bodies: unknown[] = [
      { status: "resolved" }, // missing id
      { id: "CT-00000001" }, // missing status
      { id: "CT-00000001", status: "bogus" },
      { id: "CT-00000001", status: "resolved", assignee: 42 },
    ]
    for (const body of bodies) {
      const response = await request("PATCH", "", body, adminCookie())
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects malformed JSON", async () => {
    ipCounter += 1
    const response = await PATCH(
      new Request("http://localhost/api/admin/contact", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.20.9.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
        },
        body: "{not json",
      }),
    )
    expect(response.status).toBe(400)
  })
})
