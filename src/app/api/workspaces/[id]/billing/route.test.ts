// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import { getBilling, resetWorkspaceBillingForTests, updateBilling } from "@/lib/workspace-billing"

import { GET, PATCH } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      listWorkspaceMembers,
    }),
  }
})

const user = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
}

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(
  method: "GET" | "PATCH",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.3.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/billing`, init)
  const params = Promise.resolve({ id })
  return method === "GET" ? GET(request, { params }) : PATCH(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  listWorkspaceMembers.mockReset()
  resetWorkspaceBillingForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  listWorkspaceMembers.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }])
})

describe("GET /api/workspaces/[id]/billing", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects members with 403 — billing is owner/admin only", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns billing, seats, and the plan catalog to an owner", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    updateBilling("ws-1", { plan: "pro" })

    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      role: "owner",
      billing: { plan: "pro", status: "active" },
    })
    expect(body.seats).toEqual({ allowed: true, limit: 25, current: 3 })
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual(["free", "pro", "business"])
  })

  it("reports seat overflow against the free plan default", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    listWorkspaceMembers.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` })))

    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.billing.plan).toBe("free")
    expect(body.seats).toEqual({ allowed: false, limit: 5, current: 6 })
  })
})

describe("PATCH /api/workspaces/[id]/billing", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PATCH", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { plan: "pro" },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { plan: "pro" },
    })
    expect(response.status).toBe(403)
    expect(getBilling("ws-1").plan).toBe("free")
  })

  it("rejects invalid and empty bodies", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const badPlan = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { plan: "enterprise" },
    })
    expect(badPlan.status).toBe(400)

    const badDate = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { currentPeriodEnd: "tomorrow" },
    })
    expect(badDate.status).toBe(400)

    const smuggled = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { seatCount: 999 },
    })
    expect(smuggled.status).toBe(400)

    const empty = await call("PATCH", "ws-1", { cookie: cookieFor(), body: {} })
    expect(empty.status).toBe(400)
    expect(getBilling("ws-1")).toMatchObject({ plan: "free", status: "active" })
  })

  it("applies a partial update, snapshots seats, and records an audit event", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: {
        plan: "pro",
        status: "trialing",
        currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.billing).toEqual({
      plan: "pro",
      status: "trialing",
      currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      seatCount: 3,
    })
    expect(body.seats).toEqual({ allowed: true, limit: 25, current: 3 })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.billing_updated",
      actorId: user.id,
      details: {
        changed: ["plan", "status", "currentPeriodEnd"],
        plan: "pro",
        status: "trialing",
      },
    })
  })

  it("rejects a downgrade below the member count with 409 seat_overflow", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    listWorkspaceMembers.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` })))
    updateBilling("ws-1", { plan: "business" })

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { plan: "free" },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "seat_overflow",
    })
    expect(getBilling("ws-1").plan).toBe("business")
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })

  it("applies the downgrade when confirmSeatOverflow is true", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    listWorkspaceMembers.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` })))
    updateBilling("ws-1", { plan: "business" })

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { plan: "free", confirmSeatOverflow: true },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.billing.plan).toBe("free")
    expect(body.seats).toEqual({ allowed: false, limit: 5, current: 6 })
    // The confirm flag is consumed by the route, never stored.
    expect(body.billing).not.toHaveProperty("confirmSeatOverflow")
    const events = listWorkspaceEvents("ws-1").events
    expect(events[0]).toMatchObject({
      details: { changed: ["plan"], plan: "free" },
    })
  })

  it("does not require confirmation when the new plan fits the roster", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    listWorkspaceMembers.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` })))
    updateBilling("ws-1", { plan: "business" })

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { plan: "pro" },
    })

    expect(response.status).toBe(200)
    expect(getBilling("ws-1").plan).toBe("pro")
  })
})
