// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearNewsletterStore } from "@/lib/newsletter-store"
import { clearWinBackStore, createCampaign } from "@/lib/win-back"
import type { WinBackUserRecord } from "@/lib/win-back"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const mockUserSource = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

vi.mock("@/lib/win-back", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/win-back")>()
  return {
    ...actual,
    defaultWinBackUserSource: (...args: unknown[]) => mockUserSource(...args),
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

function req(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function inactiveRecord(email: string): WinBackUserRecord {
  return {
    id: `u-${email}`,
    email,
    createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    lastActivityAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  mockUserSource.mockReset()
  mockUserSource.mockReturnValue([inactiveRecord("old@example.com")])
  setAdminEmailsForTests(["admin@example.com"])
  clearNewsletterStore()
  clearWinBackStore()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/win-back", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/win-back"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req("/api/admin/win-back", undefined, cookieFor("user@example.com", "u9")),
    )
    expect(response.status).toBe(403)
  })

  it("lists campaigns for an admin", async () => {
    createCampaign({ name: "c1", subject: "s", bodyTemplate: "b", minInactiveDays: 30 })
    const response = await GET(req("/api/admin/win-back", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.campaigns).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it("filters by status and rejects a bad status", async () => {
    const campaign = createCampaign({
      name: "c1",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    const { updateCampaign } = await import("@/lib/win-back")
    updateCampaign(campaign.id, { status: "active" })

    const okRes = await GET(req("/api/admin/win-back?status=active", undefined, adminCookie()))
    expect((await okRes.json()).campaigns).toHaveLength(1)

    const badRes = await GET(req("/api/admin/win-back?status=bogus", undefined, adminCookie()))
    expect(badRes.status).toBe(400)
  })

  it("preview returns the candidate count for a campaign", async () => {
    mockUserSource.mockReturnValue([
      inactiveRecord("a@example.com"),
      inactiveRecord("b@example.com"),
      {
        ...inactiveRecord("c@example.com"),
        lastActivityAt: new Date().toISOString(), // active → excluded
      },
    ])
    const campaign = createCampaign({
      name: "c1",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    const response = await GET(
      req(`/api/admin/win-back?preview=1&campaignId=${campaign.id}`, undefined, adminCookie()),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.candidateCount).toBe(2)
  })

  it("preview 404s for an unknown campaign and 400s without campaignId", async () => {
    const missing = await GET(
      req("/api/admin/win-back?preview=1&campaignId=wb_nope", undefined, adminCookie()),
    )
    expect(missing.status).toBe(404)

    const noId = await GET(req("/api/admin/win-back?preview=1", undefined, adminCookie()))
    expect(noId.status).toBe(400)
  })
})

describe("POST /api/admin/win-back", () => {
  it("creates a draft campaign", async () => {
    const response = await POST(
      req(
        "/api/admin/win-back",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Spring win-back",
            subject: "Come back {{name}}",
            body: "We saved your spot.",
            minInactiveDays: 45,
            targetSegment: "newsletter",
          }),
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.campaign).toMatchObject({
      name: "Spring win-back",
      status: "draft",
      minInactiveDays: 45,
      targetSegment: "newsletter",
    })
  })

  it("rejects invalid payloads", async () => {
    const response = await POST(
      req(
        "/api/admin/win-back",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x", subject: "s", body: "b", minInactiveDays: 0 }),
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(400)
  })
})
