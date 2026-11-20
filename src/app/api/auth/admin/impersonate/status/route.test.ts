// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import type { AuthUser } from "@/lib/auth/backend"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  getImpersonationStore,
  IMPERSONATION_COOKIE,
  MemoryImpersonationStore,
  mintImpersonationAccessToken,
  setImpersonationStoreForTests,
  startImpersonation,
} from "@/lib/auth/impersonation"
import { GET } from "./route"

const admin: AuthUser = {
  id: "admin-1",
  email: "root@example.com",
  name: "Root",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
}

const target: AuthUser = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: "2026-01-02T00:00:00.000Z",
}

const regular: AuthUser = {
  id: "user-2",
  email: "bob@example.com",
  name: "Bob",
  emailVerified: true,
  createdAt: "2026-01-03T00:00:00.000Z",
}

const byId: Record<string, AuthUser> = {
  [admin.id]: admin,
  [target.id]: target,
  [regular.id]: regular,
}

const getUserById = vi.fn(async (id: string) => byId[id] ?? null)
const getUserByEmail = vi.fn(
  async (email: string) =>
    Object.values(byId).find((u) => u.email === email.trim().toLowerCase()) ?? null,
)

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return { ...actual, getAuthBackend: () => ({ getUserById, getUserByEmail }) }
})

let ipCounter = 0

function get(cookies: Record<string, string> = {}) {
  ipCounter += 1
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  return GET(
    new Request("http://localhost/api/auth/admin/impersonate/status", {
      headers: { cookie: header, "x-forwarded-for": `10.5.0.${ipCounter}` },
    }),
  )
}

function adminCookies() {
  return {
    [ACCESS_COOKIE]: createAccessToken({
      sid: "admin-sid",
      uid: admin.id,
      email: admin.email,
      name: admin.name,
    }).token,
  }
}

function impersonationCookies() {
  const result = startImpersonation({
    adminUserId: admin.id,
    adminEmail: admin.email,
    adminName: admin.name,
    adminSessionId: "admin-sid",
    target,
  })
  if (!result.ok) throw new Error("expected ok")
  const { token } = mintImpersonationAccessToken(result.record, target)
  return {
    record: result.record,
    cookies: { [ACCESS_COOKIE]: token, [IMPERSONATION_COOKIE]: result.record.id },
  }
}

beforeEach(() => {
  setImpersonationStoreForTests(new MemoryImpersonationStore())
  setAdminEmailsForTests([admin.email])
  getUserById.mockClear()
  getUserByEmail.mockClear()
})

describe("GET /api/auth/admin/impersonate/status", () => {
  it("reports active impersonation for the impersonated session", async () => {
    const { cookies } = impersonationCookies()
    const response = await get(cookies)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.active).toBe(true)
    expect(data.impersonation.targetEmail).toBe(target.email)
    expect(data.impersonation.expiresAt).toBeTruthy()
    // adminEmail is admin audit data — never serialized to the
    // impersonated (target) session.
    expect(data.impersonation.adminEmail).toBeUndefined()
  })

  it("does not treat the target's ordinary session + forged marker as impersonating", async () => {
    const { record } = impersonationCookies()
    // The real target user forges the marker with their OWN session token:
    // uid matches but sid is not the record id.
    const forged = createAccessToken({
      sid: "target-real-session",
      uid: target.id,
      email: target.email,
      name: target.name,
    }).token
    const response = await get({
      [ACCESS_COOKIE]: forged,
      [IMPERSONATION_COOKIE]: record.id,
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.active).toBe(false)
    // The forgery must not kill the admin's live impersonation.
    expect(getImpersonationStore().get(record.id)?.endReason).toBeNull()
  })

  it("reports inactive and clears the marker when the session is no longer impersonated", async () => {
    const { cookies } = impersonationCookies()
    // Admin's refresh cookie restored the admin session: access token is the
    // admin's, marker still present.
    const response = await get({
      ...adminCookies(),
      [IMPERSONATION_COOKIE]: cookies[IMPERSONATION_COOKIE],
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.active).toBe(false)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE}=;`)
    // The record was invalidated for audit.
    const record = getImpersonationStore().list()[0]
    expect(record.endReason).toBe("invalidated")
  })

  it("reports inactive for an admin with no impersonation and includes last record", async () => {
    impersonationCookies() // creates a record, then we act as the admin again
    const response = await get(adminCookies())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.active).toBe(false)
    expect(data.lastImpersonation?.targetEmail).toBe(target.email)
    // The admin-facing history view DOES include adminEmail for audit.
    expect(data.lastImpersonation?.adminEmail).toBe(admin.email)
  })

  it("rejects non-admin callers without a marker with 403", async () => {
    const response = await get({
      [ACCESS_COOKIE]: createAccessToken({
        sid: "s",
        uid: regular.id,
        email: regular.email,
        name: regular.name,
      }).token,
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated callers with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })
})
