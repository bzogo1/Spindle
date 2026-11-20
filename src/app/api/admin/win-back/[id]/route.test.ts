// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearNewsletterStore } from "@/lib/newsletter-store"
import { clearWinBackStore, createCampaign, updateCampaign } from "@/lib/win-back"

import { GET, PATCH, POST } from "./route"
import { POST as RUN_POST } from "./run/route"

const getUserById = vi.hoisted(() => vi.fn())
const mockRunCampaign = vi.hoisted(() => vi.fn())

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
    runCampaign: (...args: unknown[]) => mockRunCampaign(...args),
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
    "x-forwarded-for": `10.8.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function jsonReq(method: string, body: unknown, cookie: string) {
  return req(
    "/api/admin/win-back/x",
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    cookie,
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  mockRunCampaign.mockReset()
  setAdminEmailsForTests(["admin@example.com"])
  clearNewsletterStore()
  clearWinBackStore()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/win-back/[id]", () => {
  it("returns one campaign", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    const response = await GET(
      req(`/api/admin/win-back/${campaign.id}`, undefined, adminCookie()),
      ctx(campaign.id),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).campaign.id).toBe(campaign.id)
  })

  it("404s for unknown ids", async () => {
    const response = await GET(
      req("/api/admin/win-back/wb_missing", undefined, adminCookie()),
      ctx("wb_missing"),
    )
    expect(response.status).toBe(404)
  })
})

describe("PATCH /api/admin/win-back/[id]", () => {
  it("updates status and fields", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    const response = await PATCH(
      jsonReq("PATCH", { status: "active", name: "renamed" }, adminCookie()),
      ctx(campaign.id),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.campaign).toMatchObject({ status: "active", name: "renamed" })
  })

  it("rejects an invalid status and a completed-campaign edit", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    const bad = await PATCH(jsonReq("PATCH", { status: "bogus" }, adminCookie()), ctx(campaign.id))
    expect(bad.status).toBe(400)

    updateCampaign(campaign.id, { status: "completed" })
    const immutable = await PATCH(jsonReq("PATCH", { name: "x" }, adminCookie()), ctx(campaign.id))
    expect(immutable.status).toBe(400)
  })
})

describe("POST /api/admin/win-back/[id] (run)", () => {
  it("executes runCampaign and returns the outcome", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    mockRunCampaign.mockResolvedValue({
      campaign,
      candidates: 3,
      sent: 2,
      suppressed: 1,
      failed: 0,
    })

    const response = await POST(
      req(`/api/admin/win-back/${campaign.id}`, { method: "POST" }, adminCookie()),
      ctx(campaign.id),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, candidates: 3, sent: 2, suppressed: 1, failed: 0 })
    expect(mockRunCampaign).toHaveBeenCalledWith(
      campaign.id,
      expect.objectContaining({
        unsubscribeUrl: expect.any(Function),
      }),
    )
  })

  it("passes a per-recipient unsubscribe URL builder to runCampaign", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    mockRunCampaign.mockResolvedValue({
      campaign,
      candidates: 1,
      sent: 1,
      suppressed: 0,
      failed: 0,
    })

    await POST(
      req(`/api/admin/win-back/${campaign.id}`, { method: "POST" }, adminCookie()),
      ctx(campaign.id),
    )

    const options = mockRunCampaign.mock.calls[0][1] as {
      unsubscribeUrl: (email: string) => string | undefined
    }
    const url = options.unsubscribeUrl("user@example.com")
    expect(url).toContain("/unsubscribe?token=")
    expect(url).toContain("email=user%40example.com")
  })

  it("propagates run errors as 4xx/404", async () => {
    const { WinBackError } = await import("@/lib/win-back")
    mockRunCampaign.mockRejectedValue(new WinBackError("not_found", "Campaign not found."))
    const response = await POST(
      req("/api/admin/win-back/wb_missing", { method: "POST" }, adminCookie()),
      ctx("wb_missing"),
    )
    expect(response.status).toBe(404)
  })

  it("POST /run alias behaves identically", async () => {
    const campaign = createCampaign({
      name: "c",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    mockRunCampaign.mockResolvedValue({
      campaign,
      candidates: 0,
      sent: 0,
      suppressed: 0,
      failed: 0,
    })
    const response = await RUN_POST(
      req(`/api/admin/win-back/${campaign.id}/run`, { method: "POST" }, adminCookie()),
      ctx(campaign.id),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })
})
