import { beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/auth/backend"
import { verifyAuthToken } from "@/lib/auth/token-codec"
import { setAdminEmailsForTests } from "@/lib/admin"
import {
  getImpersonationStore,
  IMPERSONATION_TTL_MS,
  MemoryImpersonationStore,
  mintAdminRestoreToken,
  mintImpersonationAccessToken,
  setImpersonationStoreForTests,
  startImpersonation,
} from "./impersonation"

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

function input(overrides: Partial<Parameters<typeof startImpersonation>[0]> = {}) {
  return {
    adminUserId: admin.id,
    adminEmail: admin.email,
    adminName: admin.name,
    adminSessionId: "admin-sid",
    target,
    ...overrides,
  }
}

beforeEach(() => {
  setImpersonationStoreForTests(new MemoryImpersonationStore())
  setAdminEmailsForTests(["root@example.com"])
})

describe("MemoryImpersonationStore", () => {
  it("creates records with a 30-minute expiry and tracks lifecycle", () => {
    const store = getImpersonationStore()
    const record = store.create(input())

    expect(record.id).toMatch(/^imp_/)
    expect(record.adminUserId).toBe(admin.id)
    expect(record.targetUserId).toBe(target.id)
    expect(record.endReason).toBeNull()
    expect(new Date(record.expiresAt).getTime() - new Date(record.startedAt).getTime()).toBe(
      IMPERSONATION_TTL_MS,
    )

    const active = store.getActive(record.id)
    expect(active?.id).toBe(record.id)

    store.end(record.id, "stopped")
    expect(store.getActive(record.id)).toBeNull()
    expect(store.get(record.id)?.endReason).toBe("stopped")
    expect(store.findActiveByAdmin(admin.id)).toBeNull()
  })

  it("lazily expires records past expiresAt", () => {
    const store = getImpersonationStore()
    const record = store.create({ ...input(), now: 1_000 })
    const later = 1_000 + IMPERSONATION_TTL_MS + 1

    expect(store.getActive(record.id, later)).toBeNull()
    expect(store.get(record.id)?.endReason).toBe("expired")
    expect(store.get(record.id)?.endedAt).not.toBeNull()
  })

  it("list() stamps expired records so history never shows them as live", () => {
    const store = getImpersonationStore()
    const record = store.create({ ...input(), now: 1_000 })
    const later = 1_000 + IMPERSONATION_TTL_MS + 1

    const listed = store.list(later)
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(record.id)
    expect(listed[0].endReason).toBe("expired")
    expect(listed[0].endedAt).not.toBeNull()
  })

  it("findActiveByTarget locates the live impersonation for a user", () => {
    const store = getImpersonationStore()
    const record = store.create(input())
    expect(store.findActiveByTarget(target.id)?.id).toBe(record.id)
    expect(store.findActiveByTarget("someone-else")).toBeNull()
  })

  it("finders stamp expired records instead of leaving them active", () => {
    const store = getImpersonationStore()
    const later = 1_000 + IMPERSONATION_TTL_MS + 1
    const byAdmin = store.create({ ...input(), now: 1_000 })
    const byTarget = store.create({
      ...input(),
      target: { ...target, id: "user-2" },
      now: 1_000,
    })

    expect(store.findActiveByAdmin(admin.id, later)).toBeNull()
    expect(store.get(byAdmin.id)?.endReason).toBe("expired")
    expect(store.get(byAdmin.id)?.endedAt).not.toBeNull()

    expect(store.findActiveByTarget("user-2", later)).toBeNull()
    expect(store.get(byTarget.id)?.endReason).toBe("expired")
  })
})

describe("startImpersonation", () => {
  it("creates a record and mints a target-scoped access token", () => {
    const result = startImpersonation(input())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const payload = verifyAuthToken(result.accessToken, "access")
    expect(payload).not.toBeNull()
    expect(payload?.uid).toBe(target.id)
    expect(payload?.email).toBe(target.email)
    expect(payload?.sid).toBe(result.record.id)
    // 30-minute box, matching the record expiry (token exp is epoch seconds).
    expect(payload!.exp).toBe(Math.floor(new Date(result.record.expiresAt).getTime() / 1000))
  })

  it("blocks self-impersonation", () => {
    const result = startImpersonation(input({ target: { ...target, id: admin.id } }))
    expect(result).toMatchObject({ ok: false, reason: "self" })
  })

  it("blocks impersonating another admin", () => {
    const otherAdmin: AuthUser = { ...target, email: "second-admin@example.com" }
    setAdminEmailsForTests(["root@example.com", "second-admin@example.com"])
    const result = startImpersonation(input({ target: otherAdmin }))
    expect(result).toMatchObject({ ok: false, reason: "admin_target" })
  })

  it("allows impersonating a non-admin even when other admins exist", () => {
    setAdminEmailsForTests(["root@example.com", "other@example.com"])
    const result = startImpersonation(input())
    expect(result.ok).toBe(true)
  })

  it("blocks a second active impersonation for the same admin", () => {
    expect(startImpersonation(input()).ok).toBe(true)
    const second = startImpersonation(input({ target: { ...target, id: "user-2" } }))
    expect(second).toMatchObject({ ok: false, reason: "already_active" })
  })

  it("allows a different admin to impersonate independently", () => {
    expect(startImpersonation(input()).ok).toBe(true)
    const result = startImpersonation(
      input({
        adminUserId: "admin-2",
        adminEmail: "second@example.com",
        target: { ...target, id: "user-2" },
      }),
    )
    expect(result.ok).toBe(true)
  })
})

describe("mintAdminRestoreToken", () => {
  it("restores the admin's original session claims", () => {
    const result = startImpersonation(input())
    if (!result.ok) throw new Error("expected ok")
    const restore = mintAdminRestoreToken(result.record)
    const payload = verifyAuthToken(restore.token, "access")
    expect(payload?.uid).toBe(admin.id)
    expect(payload?.email).toBe(admin.email)
    expect(payload?.sid).toBe("admin-sid")
  })
})

describe("mintImpersonationAccessToken", () => {
  it("produces a token that expires with the record", () => {
    const store = getImpersonationStore()
    const record = store.create(input())
    const { token, expiresAt } = mintImpersonationAccessToken(record, target)
    const payload = verifyAuthToken(token, "access")
    expect(payload?.uid).toBe(target.id)
    expect(payload?.exp).toBe(Math.floor(new Date(record.expiresAt).getTime() / 1000))
    expect(expiresAt.getTime()).toBe(payload!.exp * 1000)
  })
})
