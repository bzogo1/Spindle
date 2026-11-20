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
  setImpersonationStoreForTests,
} from "@/lib/auth/impersonation"
import { POST } from "./route"

const ADMIN_EMAIL = "root@example.com"
const TARGET_EMAIL = "ada@example.com"
const OTHER_ADMIN_EMAIL = "second@example.com"

const users: Record<string, AuthUser> = {
  "admin-1": {
    id: "admin-1",
    email: ADMIN_EMAIL,
    name: "Root",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  "user-1": {
    id: "user-1",
    email: TARGET_EMAIL,
    name: "Ada",
    emailVerified: true,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
  "admin-2": {
    id: "admin-2",
    email: OTHER_ADMIN_EMAIL,
    name: "Second",
    emailVerified: true,
    createdAt: "2026-01-03T00:00:00.000Z",
  },
  "user-2": {
    id: "user-2",
    email: "bob@example.com",
    name: "Bob",
    emailVerified: true,
    createdAt: "2026-01-04T00:00:00.000Z",
  },
}

const getUserById = vi.fn(async (id: string) => users[id] ?? null)
const getUserByEmail = vi.fn(async (email: string) => {
  const normalized = email.trim().toLowerCase()
  return Object.values(users).find((u) => u.email === normalized) ?? null
})
const getSessionContext = vi.fn(async (id: string) => {
  const user = users[id] ?? null
  return user ? { user, workspace: null } : null
})

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, getUserByEmail, getSessionContext }),
  }
})

let ipCounter = 0

function post(
  body: unknown,
  options: { uid?: string; sid?: string; email?: string; marker?: string } = {},
) {
  ipCounter += 1
  const uid = options.uid ?? "admin-1"
  const email = options.email ?? users[uid]?.email ?? ADMIN_EMAIL
  const token = createAccessToken({
    sid: options.sid ?? "admin-sid",
    uid,
    email,
    name: users[uid]?.name ?? null,
  }).token
  const cookies = [`${ACCESS_COOKIE}=${token}`]
  if (options.marker) cookies.push(`${IMPERSONATION_COOKIE}=${options.marker}`)
  return POST(
    new Request("http://localhost/api/auth/admin/impersonate/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies.join("; "),
        "x-forwarded-for": `10.1.0.${ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  setImpersonationStoreForTests(new MemoryImpersonationStore())
  setAdminEmailsForTests([ADMIN_EMAIL, OTHER_ADMIN_EMAIL])
  getUserById.mockClear()
  getUserByEmail.mockClear()
})

describe("POST /api/auth/admin/impersonate/start", () => {
  it("rejects unauthenticated callers with 401", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/auth/admin/impersonate/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.2.0.${ipCounter}`,
        },
        body: JSON.stringify({ email: TARGET_EMAIL }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it("rejects non-admin callers with 403", async () => {
    const response = await post({ email: TARGET_EMAIL }, { uid: "user-2" })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.code).toBe("forbidden")
  })

  it("rejects an impersonated (non-admin) session trying to start another", async () => {
    // Simulate: admin already impersonating user-1; the request now carries
    // the target's access token + marker.
    const first = await post({ email: TARGET_EMAIL })
    expect(first.status).toBe(200)
    const setCookie = first.headers.get("set-cookie") ?? ""
    const marker = /spindle_imp=([^;]+)/.exec(setCookie)?.[1]
    const impToken = /spindle_at=([^;]+)/.exec(setCookie)?.[1]
    expect(marker).toBeTruthy()
    expect(impToken).toBeTruthy()

    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/auth/admin/impersonate/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ACCESS_COOKIE}=${impToken}; ${IMPERSONATION_COOKIE}=${marker}`,
          "x-forwarded-for": `10.3.0.${ipCounter}`,
        },
        body: JSON.stringify({ email: "bob@example.com" }),
      }),
    )
    // requireAdmin resolves the target's email -> not admin -> 403.
    expect(response.status).toBe(403)
  })

  it("starts an impersonation for a valid target and sets cookies", async () => {
    const response = await post({ email: TARGET_EMAIL })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.impersonation.targetEmail).toBe(TARGET_EMAIL)

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${ACCESS_COOKIE}=`)
    expect(setCookie).toContain(`${IMPERSONATION_COOKIE}=`)

    const record = getImpersonationStore().get(data.impersonation.id)
    expect(record?.adminUserId).toBe("admin-1")
    expect(record?.targetUserId).toBe("user-1")
    expect(record?.endReason).toBeNull()

    // The response carries a session description for the TARGET user so the
    // client can adopt it (re-arming the refresh timer to the imp expiry).
    expect(data.session?.user?.id).toBe("user-1")
    expect(data.session?.sessionId).toBe(data.impersonation.id)
    expect(data.session?.expiresAt).toBe(data.impersonation.expiresAt ?? record?.expiresAt)
  })

  it("resolves targets by userId as well as email", async () => {
    const response = await post({ userId: "user-1" })
    expect(response.status).toBe(200)
  })

  it("blocks self-impersonation with 400", async () => {
    const response = await post({ email: ADMIN_EMAIL })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.code).toBe("self")
  })

  it("blocks impersonating another admin with 403", async () => {
    const response = await post({ email: OTHER_ADMIN_EMAIL })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.code).toBe("admin_target")
  })

  it("returns 404 for unknown targets", async () => {
    const response = await post({ email: "ghost@example.com" })
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.code).toBe("target_not_found")
  })

  it("returns 400 when neither email nor userId is provided", async () => {
    const response = await post({})
    expect(response.status).toBe(400)
  })

  it("returns 409 when the admin already has an active impersonation", async () => {
    const first = await post({ email: TARGET_EMAIL })
    expect(first.status).toBe(200)
    const second = await post({ email: "bob@example.com" })
    expect(second.status).toBe(409)
    const data = await second.json()
    expect(data.code).toBe("already_active")
  })
})
