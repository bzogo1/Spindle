// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { changelogReleases } from "@/lib/changelog"
import { clearNewsletterStore, subscribe } from "@/lib/newsletter-store"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const getUserByEmail = vi.hoisted(() => vi.fn())
const sendReleaseNotes = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, getUserByEmail }),
  }
})

vi.mock("@/lib/release-notes-send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/release-notes-send")>()
  return {
    ...actual,
    sendReleaseNotes,
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

function req(method: "GET" | "POST", query = "", cookie?: string, body?: unknown) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.1.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (body !== undefined) headers["content-type"] = "application/json"
  return new Request(`http://localhost/api/admin/release-notes${query}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  getUserByEmail.mockReset()
  getUserByEmail.mockResolvedValue(null)
  sendReleaseNotes.mockReset()
  sendReleaseNotes.mockResolvedValue({
    attempted: 0,
    suppressed: 0,
    sent: 0,
    unconfigured: 0,
    failed: 0,
  })
  setAdminEmailsForTests(["admin@example.com"])
  clearNewsletterStore()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/release-notes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("GET"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(req("GET", "", cookieFor("user@example.com", "u9")))
    expect(response.status).toBe(403)
  })

  it("returns the latest entry preview with recipient estimate", async () => {
    subscribe("ada@example.com")
    subscribe("bob@example.com")

    const response = await GET(req("GET", "", adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].slug).toBe(changelogReleases[0]!.slug)
    expect(body.subject).toBeTruthy()
    expect(body.text).toContain("Spindle")
    expect(body.html).toContain("<!doctype html>")
    expect(body.recipientCount).toBe(2)
    expect(typeof body.emailConfigured).toBe("boolean")
  })

  it("honours latestCount and entryIds", async () => {
    const byCount = await GET(req("GET", "?latestCount=1", adminCookie()))
    const countBody = await byCount.json()
    expect(countBody.entries).toHaveLength(1)

    const byIds = await GET(req("GET", `?entryIds=${changelogReleases[0]!.slug}`, adminCookie()))
    const idsBody = await byIds.json()
    expect(idsBody.entries).toHaveLength(1)
    expect(idsBody.entries[0].slug).toBe(changelogReleases[0]!.slug)
  })

  it("rejects an unknown entry slug", async () => {
    const response = await GET(req("GET", "?entryIds=bogus", adminCookie()))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("rejects an out-of-range latestCount", async () => {
    const response = await GET(req("GET", "?latestCount=99", adminCookie()))
    expect(response.status).toBe(400)
  })
})

describe("POST /api/admin/release-notes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await POST(req("POST", "", undefined, { latestCount: 1 }))
    expect(response.status).toBe(401)
  })

  it("sends to active subscribers and returns honest counts", async () => {
    subscribe("ada@example.com")
    subscribe("bob@example.com")
    sendReleaseNotes.mockResolvedValue({
      attempted: 2,
      suppressed: 0,
      sent: 0,
      unconfigured: 2,
      failed: 0,
    })

    const response = await POST(
      req("POST", "", adminCookie(), { latestCount: 1, audience: "subscribers" }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.result).toEqual({
      attempted: 2,
      suppressed: 0,
      sent: 0,
      unconfigured: 2,
      failed: 0,
    })
    expect(body.audienceNote).toBeNull()

    expect(sendReleaseNotes).toHaveBeenCalledTimes(1)
    const call = sendReleaseNotes.mock.calls[0]![0] as {
      entries: unknown[]
      recipients: { email: string }[]
    }
    expect(call.entries).toHaveLength(1)
    expect(call.recipients.map((r) => r.email).sort()).toEqual([
      "ada@example.com",
      "bob@example.com",
    ])
  })

  it("enriches recipients with backend display names when available", async () => {
    subscribe("ada@example.com")
    subscribe("bob@example.com")
    getUserByEmail.mockImplementation(async (email: string) =>
      email === "ada@example.com"
        ? { ...adminUser, id: "u-ada", email, name: "Ada Lovelace" }
        : null,
    )

    const response = await POST(
      req("POST", "", adminCookie(), { latestCount: 1, audience: "subscribers" }),
    )
    expect(response.status).toBe(200)

    const call = sendReleaseNotes.mock.calls[0]![0] as {
      recipients: { email: string; userName?: string }[]
    }
    const byEmail = new Map(call.recipients.map((r) => [r.email, r.userName]))
    expect(byEmail.get("ada@example.com")).toBe("Ada Lovelace")
    expect(byEmail.get("bob@example.com")).toBeUndefined()
  })

  it("passes through suppressed counts from sendReleaseNotes", async () => {
    subscribe("ada@example.com")
    sendReleaseNotes.mockResolvedValue({
      attempted: 0,
      suppressed: 1,
      sent: 0,
      unconfigured: 0,
      failed: 0,
    })

    const response = await POST(
      req("POST", "", adminCookie(), { latestCount: 1, audience: "subscribers" }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).toMatchObject({ attempted: 0, suppressed: 1 })
  })

  it("falls back to subscribers for all-users with a note", async () => {
    subscribe("ada@example.com")
    const response = await POST(
      req("POST", "", adminCookie(), { latestCount: 1, audience: "all-users" }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.audienceNote).toContain("subscribers")
  })

  it("rejects a body with neither entryIds nor latestCount", async () => {
    const response = await POST(req("POST", "", adminCookie(), { audience: "subscribers" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("rejects an invalid audience", async () => {
    const response = await POST(
      req("POST", "", adminCookie(), { latestCount: 1, audience: "everyone" }),
    )
    expect(response.status).toBe(400)
  })
})
