// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearComplianceStoreForTests, createCase } from "@/lib/compliance"

import { GET } from "./route"

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

function req(path: string, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.20.3.${ipCounter}`,
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearComplianceStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/compliance/report", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/compliance/report"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req("/api/admin/compliance/report", cookieFor("user@example.com", "u9")),
    )
    expect(response.status).toBe(403)
  })

  it("returns the aggregated JSON report for an admin", async () => {
    createCase({
      type: "fraud_review",
      subjectType: "affiliate",
      subjectId: "aff_1",
    })
    const response = await GET(req("/api/admin/compliance/report", adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.report.cases.total).toBe(1)
    expect(body.report.cases.byStatus.open).toBe(1)
    expect(body.report.period).toEqual({ start: null, end: null })
    // Every section of ProgramComplianceReport is present.
    for (const key of ["affiliates", "cases", "fraudFlags", "commissions", "payouts", "taxForms"]) {
      expect(body.report).toHaveProperty(key)
    }
  })

  it("accepts valid period selectors", async () => {
    for (const period of ["all", "2025", "2025-06", "2025-06-15"]) {
      const response = await GET(
        req(`/api/admin/compliance/report?period=${period}`, adminCookie()),
      )
      expect(response.status).toBe(200)
    }
  })

  it("rejects invalid periods with 400", async () => {
    for (const period of ["bogus", "2025-13", "2025-02-31", "25", "2025-1-1"]) {
      const response = await GET(
        req(`/api/admin/compliance/report?period=${encodeURIComponent(period)}`, adminCookie()),
      )
      expect(response.status).toBe(400)
    }
  })

  it("rejects invalid formats with 400", async () => {
    const response = await GET(req("/api/admin/compliance/report?format=xml", adminCookie()))
    expect(response.status).toBe(400)
  })

  it("returns a CSV audit trail with text/csv content type", async () => {
    const record = createCase({
      type: "policy_violation",
      subjectType: "user",
      subjectId: "u1",
    })
    const response = await GET(req("/api/admin/compliance/report?format=csv", adminCookie()))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    const csv = await response.text()
    const lines = csv.trimEnd().split("\r\n")
    expect(lines[0]).toBe(
      "timestamp,actor_id,event,case_id,case_type,case_status,priority,subject_type,subject_id,note",
    )
    // Case with no notes produces a header-only file.
    expect(lines).toHaveLength(1)
    expect(csv).not.toContain(record.id)

    // A period-scoped CSV for a window that excludes everything is also
    // header-only and well-formed.
    const scoped = await GET(
      req("/api/admin/compliance/report?format=csv&period=1999", adminCookie()),
    )
    expect(scoped.status).toBe(200)
    expect((await scoped.text()).trimEnd().split("\r\n")).toHaveLength(1)
  })
})
