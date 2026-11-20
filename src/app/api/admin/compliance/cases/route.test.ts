// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  COMPLIANCE_NOTE_BODY_MAX,
  clearComplianceStoreForTests,
  createCase,
  getCase,
  listCases,
  type CreateComplianceCaseInput,
} from "@/lib/compliance"

import { GET, POST } from "./route"

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

function req(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.20.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function postReq(body: unknown, cookie?: string, headers?: Record<string, string>) {
  return POST(
    req(
      "/api/admin/compliance/cases",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      cookie,
    ),
  )
}

const validBody: CreateComplianceCaseInput = {
  type: "fraud_review",
  subjectType: "affiliate",
  subjectId: "aff_1",
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearComplianceStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/compliance/cases", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/compliance/cases"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req("/api/admin/compliance/cases", undefined, cookieFor("user@example.com", "u9")),
    )
    expect(response.status).toBe(403)
  })

  it("returns an empty list for an admin", async () => {
    const response = await GET(req("/api/admin/compliance/cases", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.cases).toEqual([])
    expect(body.total).toBe(0)
  })

  it("lists cases and applies filters", async () => {
    createCase(validBody)
    createCase({ ...validBody, type: "kyc", subjectType: "user", subjectId: "u1" })

    const all = await GET(req("/api/admin/compliance/cases", undefined, adminCookie()))
    expect((await all.json()).total).toBe(2)

    const kyc = await GET(req("/api/admin/compliance/cases?type=kyc", undefined, adminCookie()))
    const kycBody = await kyc.json()
    expect(kycBody.total).toBe(1)
    expect(kycBody.cases[0].type).toBe("kyc")

    const bySubject = await GET(
      req("/api/admin/compliance/cases?subjectId=u1", undefined, adminCookie()),
    )
    expect((await bySubject.json()).total).toBe(1)
  })

  it("paginates with limit and offset", async () => {
    createCase({ ...validBody, subjectId: "s1" })
    createCase({ ...validBody, subjectId: "s2" })
    const response = await GET(
      req("/api/admin/compliance/cases?limit=1&offset=1", undefined, adminCookie()),
    )
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.cases).toHaveLength(1)
  })

  it("rejects malformed limit/offset values with 400", async () => {
    for (const qs of ["limit=10abc", "limit=1.9", "limit=-1", "offset=abc", "offset=-2"]) {
      const response = await GET(req(`/api/admin/compliance/cases?${qs}`, undefined, adminCookie()))
      expect(response.status).toBe(400)
    }
  })

  it("rejects invalid enum filters with 400", async () => {
    for (const qs of ["status=bogus", "type=bogus", "priority=urgent", "subjectType=bogus"]) {
      const response = await GET(req(`/api/admin/compliance/cases?${qs}`, undefined, adminCookie()))
      expect(response.status).toBe(400)
    }
  })
})

describe("POST /api/admin/compliance/cases", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await postReq(validBody)
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await postReq(validBody, cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
  })

  it("rejects cross-origin requests with 403", async () => {
    const response = await postReq(validBody, adminCookie(), {
      origin: "http://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("creates a case and appends the optional first note", async () => {
    const response = await postReq(
      { ...validBody, priority: "high", note: "opened for review" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.case).toMatchObject({
      type: "fraud_review",
      subjectType: "affiliate",
      subjectId: "aff_1",
      status: "open",
      priority: "high",
    })
    expect(body.case.notes).toHaveLength(1)
    expect(body.case.notes[0]).toMatchObject({
      kind: "note",
      actorId: "admin@example.com",
      body: "opened for review",
    })
    expect(getCase(body.case.id)?.status).toBe("open")
  })

  it("rejects invalid bodies with 400", async () => {
    const badBodies: unknown[] = [
      { ...validBody, type: "bogus" },
      { ...validBody, subjectType: "bogus" },
      { ...validBody, subjectId: "   " },
      { ...validBody, priority: "urgent" },
      { ...validBody, note: "x".repeat(COMPLIANCE_NOTE_BODY_MAX + 1) },
      "not-an-object",
    ]
    for (const body of badBodies) {
      const response = await postReq(body, adminCookie())
      expect(response.status).toBe(400)
    }
    expect(listCases().total).toBe(0)
  })

  it("rejects malformed JSON with 400", async () => {
    const response = await POST(
      req(
        "/api/admin/compliance/cases",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{nope",
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(400)
  })
})
