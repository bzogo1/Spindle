// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { getForcedResetStore, setForcedResetStoreForTests } from "@/lib/auth/forced-reset"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { DELETE, POST } from "./route"

const getUserById = vi.fn()
const getUserByEmail = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, getUserByEmail }),
  }
})

const admin = {
  id: "admin-1",
  email: "root@lab.edu",
  name: "Root",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const target = {
  id: "u-target",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function adminCookie() {
  return createAccessToken({ sid: "s-admin", uid: admin.id, email: admin.email, name: admin.name })
    .token
}

function userCookie(uid = target.id, email = target.email) {
  return createAccessToken({ sid: "s-user", uid, email, name: target.name }).token
}

let ipCounter = 0

function req(method: "POST" | "DELETE", body: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.7.7.${ipCounter}`,
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return (method === "POST" ? POST : DELETE)(
    new Request("http://localhost/api/auth/forced-reset", {
      method,
      headers,
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => {
    if (id === admin.id) return admin
    if (id === target.id) return target
    return null
  })
  getUserByEmail.mockReset().mockImplementation(async (email: string) => {
    if (email === target.email) return target
    return null
  })
  setAdminEmailsForTests([admin.email])
  setForcedResetStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/forced-reset", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    const anon = await req("POST", { userId: target.id })
    expect(anon.status).toBe(401)

    const user = await req("POST", { userId: target.id }, userCookie())
    expect(user.status).toBe(403)
    expect(await user.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(getForcedResetStore().get(target.id)).toBeNull()
  })

  it("flags a user by userId with reason and setBy recorded", async () => {
    const response = await req(
      "POST",
      { userId: target.id, reason: "credential stuffing hit" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, required: true, userId: target.id })

    const flag = getForcedResetStore().get(target.id)
    expect(flag?.required).toBe(true)
    expect(flag?.reason).toBe("credential stuffing hit")
    expect(flag?.setBy).toBe(admin.email)
    expect(typeof flag?.setAt).toBe("string")
  })

  it("flags a user by email", async () => {
    const response = await req("POST", { email: target.email }, adminCookie())
    expect(response.status).toBe(200)
    expect(getForcedResetStore().get(target.id)).not.toBeNull()
    expect(getUserByEmail).toHaveBeenCalledWith(target.email)
  })

  it("rejects ambiguous or missing targets and unknown users", async () => {
    for (const body of [{}, { userId: target.id, email: target.email }, { userId: "   " }]) {
      const response = await req("POST", body, adminCookie())
      expect(response.status).toBe(400)
    }
    const missing = await req("POST", { userId: "ghost" }, adminCookie())
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ ok: false, code: "user_not_found" })
  })

  it("records a forced_reset.set audit event with admin and reason metadata", async () => {
    const response = await req(
      "POST",
      { userId: target.id, reason: "credential stuffing hit" },
      adminCookie(),
    )
    expect(response.status).toBe(200)

    const events = listAuthEvents({ userId: target.id })
    const event = events.find((e) => (e.type as string) === "forced_reset.set")
    expect(event).toBeDefined()
    expect(event?.email).toBe(target.email)
    expect(event?.metadata.admin).toBe(admin.email)
    expect(event?.metadata.reason).toBe("credential stuffing hit")
  })
})

describe("DELETE /api/auth/forced-reset", () => {
  it("clears the flag for an admin", async () => {
    getForcedResetStore().require(target.id, { setBy: admin.email })
    const response = await req("DELETE", { userId: target.id }, adminCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, required: false })
    expect(getForcedResetStore().get(target.id)).toBeNull()

    const events = listAuthEvents({ userId: target.id })
    const event = events.find((e) => (e.type as string) === "forced_reset.cleared")
    expect(event).toBeDefined()
    expect(event?.metadata.admin).toBe(admin.email)
  })

  it("rejects non-admin callers", async () => {
    getForcedResetStore().require(target.id)
    const response = await req("DELETE", { email: target.email }, userCookie())
    expect(response.status).toBe(403)
    expect(getForcedResetStore().get(target.id)).not.toBeNull()
    // Rejected clears are not audited.
    expect(listAuthEvents({ userId: target.id })).toEqual([])
  })
})
