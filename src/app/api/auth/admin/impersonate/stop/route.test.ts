// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth/backend"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken, verifyAuthToken } from "@/lib/auth/token-codec"
import {
  getImpersonationStore,
  IMPERSONATION_COOKIE,
  MemoryImpersonationStore,
  mintImpersonationAccessToken,
  setImpersonationStoreForTests,
  startImpersonation,
} from "@/lib/auth/impersonation"
import { POST } from "./route"

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

const getUserById = vi.fn(async (id: string) =>
  id === admin.id ? admin : id === target.id ? target : null,
)
const getSessionContext = vi.fn(async (id: string) => {
  const user = id === admin.id ? admin : id === target.id ? target : null
  return user ? { user, workspace: null } : null
})

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return { ...actual, getAuthBackend: () => ({ getUserById, getSessionContext }) }
})

let ipCounter = 0

function req(cookies: Record<string, string>) {
  ipCounter += 1
  const header = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  return new Request("http://localhost/api/auth/admin/impersonate/stop", {
    method: "POST",
    headers: { cookie: header, "x-forwarded-for": `10.4.0.${ipCounter}` },
  })
}

/** Starts an impersonation via the store and returns the live cookies. */
function beginImpersonation() {
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
  getUserById.mockClear()
  getSessionContext.mockClear()
})

describe("POST /api/auth/admin/impersonate/stop", () => {
  it("ends the impersonation and restores the admin session", async () => {
    const { record, cookies } = beginImpersonation()
    const response = await POST(req(cookies))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.stopped).toBe(true)

    // The response goes to the impersonated (target) session: admin identity
    // and audit internals must be stripped like the status route does.
    expect(data.impersonation.targetEmail).toBe(target.email)
    expect(data.impersonation.id).toBe(record.id)
    expect(data.impersonation.adminEmail).toBeUndefined()
    expect(data.impersonation.adminUserId).toBeUndefined()
    expect(data.impersonation.adminSessionId).toBeUndefined()
    expect(data.impersonation.adminName).toBeUndefined()

    // Marker cleared, admin access token restored.
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE}=;`)
    const restored = /spindle_at=([^;]+)/.exec(setCookie)?.[1]
    expect(restored).toBeTruthy()
    const payload = verifyAuthToken(decodeURIComponent(restored!), "access")
    expect(payload?.uid).toBe(admin.id)
    expect(payload?.sid).toBe("admin-sid")

    const stored = getImpersonationStore().get(record.id)
    expect(stored?.endReason).toBe("stopped")
    expect(stored?.endedAt).not.toBeNull()
  })

  it("returns 404 when there is no impersonation marker", async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.code).toBe("no_impersonation")
  })

  it("returns 404 for an unknown marker and clears it", async () => {
    const response = await POST(req({ [IMPERSONATION_COOKIE]: "imp_missing" }))
    expect(response.status).toBe(404)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE}=;`)
  })

  it("rejects a marker replayed without the impersonated access token", async () => {
    const { cookies } = beginImpersonation()
    // Attacker holds only the marker cookie; access token is someone else's.
    const otherToken = mintImpersonationAccessToken(getImpersonationStore().list()[0], {
      ...target,
      id: "someone-else",
    }).token
    const response = await POST(
      req({ [ACCESS_COOKIE]: otherToken, [IMPERSONATION_COOKIE]: cookies[IMPERSONATION_COOKIE] }),
    )
    expect(response.status).toBe(401)
  })

  it("returns 409 session_restored for an admin-uid token that is not the imp token", async () => {
    const { record } = beginImpersonation()
    void record
    // mintImpersonationAccessToken binds sid to the RECORD id, so minting it
    // for the admin yields uid=admin + sid=record.id — not the impersonated
    // session, but still the admin's uid -> restored-session branch.
    const adminToken = mintImpersonationAccessToken(getImpersonationStore().list()[0], admin).token
    const response = await POST(
      req({
        [ACCESS_COOKIE]: adminToken,
        [IMPERSONATION_COOKIE]: getImpersonationStore().list()[0].id,
      }),
    )
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.code).toBe("session_restored")
  })

  it("rejects the target's ordinary session token paired with a forged marker", async () => {
    // The real target user could learn the record id; their normal session
    // token has the right uid but a sid that is NOT the record id.
    const { record } = beginImpersonation()
    const targetToken = createAccessToken({
      sid: "target-real-session",
      uid: target.id,
      email: target.email,
      name: target.name,
    }).token
    const response = await POST(
      req({ [ACCESS_COOKIE]: targetToken, [IMPERSONATION_COOKIE]: record.id }),
    )
    expect(response.status).toBe(401)
    // The live impersonation must survive the forgery attempt.
    expect(getImpersonationStore().get(record.id)?.endReason).toBeNull()
  })

  it("returns 409 session_restored when the admin session already took over", async () => {
    const { record } = beginImpersonation()
    // Refresh rotation mints a new sid — only adminUserId is stable.
    const adminToken = createAccessToken({
      sid: "rotated-admin-session",
      uid: admin.id,
      email: admin.email,
      name: admin.name,
    }).token
    const response = await POST(
      req({ [ACCESS_COOKIE]: adminToken, [IMPERSONATION_COOKIE]: record.id }),
    )
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.code).toBe("session_restored")
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE}=;`)
    expect(getImpersonationStore().get(record.id)?.endReason).toBe("invalidated")
  })

  it("includes the restored admin session in a successful stop", async () => {
    const { cookies } = beginImpersonation()
    const response = await POST(req(cookies))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.session?.user?.id).toBe(admin.id)
    expect(data.session?.sessionId).toBe("admin-sid")
    expect(data.session?.expiresAt).toBeTruthy()
  })

  it("treats an expired record as nothing to stop", async () => {
    const { record, cookies } = beginImpersonation()
    // Force expiry.
    const stored = getImpersonationStore().get(record.id)!
    stored.expiresAt = new Date(Date.now() - 1000).toISOString()
    const response = await POST(req(cookies))
    expect(response.status).toBe(404)
    expect(getImpersonationStore().get(record.id)?.endReason).toBe("expired")
  })
})
