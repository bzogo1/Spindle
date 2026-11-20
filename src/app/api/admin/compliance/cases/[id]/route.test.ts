// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  COMPLIANCE_NOTE_BODY_MAX,
  clearComplianceStoreForTests,
  createCase,
} from "@/lib/compliance"

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

function req(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.20.2.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function patchReq(id: string, body: unknown, cookie?: string) {
  return PATCH(
    req(
      `/api/admin/compliance/cases/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      cookie,
    ),
    ctx(id),
  )
}

let caseId: string

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearComplianceStoreForTests()
  caseId = createCase({
    type: "fraud_review",
    subjectType: "affiliate",
    subjectId: "aff_1",
  }).id
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/compliance/cases/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req(`/api/admin/compliance/cases/${caseId}`), ctx(caseId))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req(`/api/admin/compliance/cases/${caseId}`, undefined, cookieFor("user@example.com", "u9")),
      ctx(caseId),
    )
    expect(response.status).toBe(403)
  })

  it("returns one case with its note log for an admin", async () => {
    const response = await GET(
      req(`/api/admin/compliance/cases/${caseId}`, undefined, adminCookie()),
      ctx(caseId),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.case.id).toBe(caseId)
    expect(body.case.status).toBe("open")
    expect(body.case.notes).toEqual([])
  })

  it("404s for unknown ids", async () => {
    const response = await GET(
      req("/api/admin/compliance/cases/ccase_missing", undefined, adminCookie()),
      ctx("ccase_missing"),
    )
    expect(response.status).toBe(404)
  })
})

describe("PATCH /api/admin/compliance/cases/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await patchReq(caseId, { action: "add_note", body: "hi" })
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await patchReq(
      caseId,
      { action: "add_note", body: "hi" },
      cookieFor("user@example.com", "u9"),
    )
    expect(response.status).toBe(403)
  })

  it("rejects cross-origin requests with 403", async () => {
    const response = await PATCH(
      req(
        `/api/admin/compliance/cases/${caseId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "http://evil.example",
          },
          body: JSON.stringify({ action: "add_note", body: "hi" }),
        },
        adminCookie(),
      ),
      ctx(caseId),
    )
    expect(response.status).toBe(403)
  })

  it("appends a note authored by the admin", async () => {
    const response = await patchReq(
      caseId,
      { action: "add_note", body: "first admin note" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.case.notes).toHaveLength(1)
    expect(body.case.notes[0]).toMatchObject({
      kind: "note",
      actorId: "admin@example.com",
      body: "first admin note",
    })
  })

  it("transitions a case through the state machine", async () => {
    const response = await patchReq(
      caseId,
      { action: "transition", to: "investigating" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.case.status).toBe("investigating")
    expect(body.case.notes.at(-1)).toMatchObject({
      kind: "transition",
      actorId: "admin@example.com",
    })
    expect(body.case.notes.at(-1).body).toContain('"open" to "investigating"')
  })

  it("returns 409 for an illegal transition", async () => {
    // open cannot jump straight to resolved.
    const response = await patchReq(caseId, { action: "transition", to: "resolved" }, adminCookie())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe("invalid_transition")
  })

  it("404s patches for unknown ids", async () => {
    const response = await patchReq(
      "ccase_missing",
      { action: "transition", to: "investigating" },
      adminCookie(),
    )
    expect(response.status).toBe(404)
  })

  it("rejects invalid actions and oversized notes with 400", async () => {
    const badBodies: unknown[] = [
      { action: "bogus" },
      { action: "add_note", body: "   " },
      { action: "add_note", body: "x".repeat(COMPLIANCE_NOTE_BODY_MAX + 1) },
      { action: "add_note" }, // missing body
      { action: "transition", to: "bogus" },
      { action: "transition" }, // missing to
    ]
    for (const body of badBodies) {
      const response = await patchReq(caseId, body, adminCookie())
      expect(response.status).toBe(400)
    }
  })

  it("rejects malformed JSON with 400", async () => {
    const response = await PATCH(
      req(
        `/api/admin/compliance/cases/${caseId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{nope",
        },
        adminCookie(),
      ),
      ctx(caseId),
    )
    expect(response.status).toBe(400)
  })
})
