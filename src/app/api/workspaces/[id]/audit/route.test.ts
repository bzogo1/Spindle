// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { recordWorkspaceEvent, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
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

const actor = {
  id: "user-2",
  email: "bob@example.com",
  name: "Bob",
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
function call(id: string, query = "", options: { cookie?: string } = {}) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the route is rate limited per IP.
    "x-forwarded-for": `10.2.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  const request = new Request(`http://localhost/api/workspaces/${id}/audit${query}`, {
    method: "GET",
    headers,
  })
  const params = Promise.resolve({ id })
  return GET(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  resetWorkspaceAuditForTests()

  getUserById.mockImplementation(async (id: string) => {
    if (id === user.id) return user
    if (id === actor.id) return actor
    return null
  })
  listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
})

describe("GET /api/workspaces/[id]/audit", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("returns 401 — not 400 — for unauthenticated malformed params", async () => {
    // Auth runs before query-param validation, so anonymous callers cannot
    // probe validation behavior with garbage params.
    const response = await call("ws-1", "?since=not-a-date&limit=abc")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("returns 403 for plain members", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("ws-1", "", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns 403 for non-members", async () => {
    listWorkspaceMemberships.mockResolvedValue([])
    const response = await call("ws-1", "", { cookie: cookieFor() })
    expect(response.status).toBe(403)
  })

  it("returns an empty page when the workspace has no events", async () => {
    const response = await call("ws-1", "", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      events: [],
      total: 0,
      limit: 50,
      offset: 0,
    })
  })

  it("lists events newest-first with actor enrichment", async () => {
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "member.role_changed",
      actorId: actor.id,
      details: { from: "member", to: "admin" },
      now: 1_700_000_000_000,
    })
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "workspace.renamed",
      actorId: user.id,
      details: { from: "Old", to: "New" },
      now: 1_700_000_001_000,
    })
    // An event for another workspace must not leak in.
    recordWorkspaceEvent({
      workspaceId: "ws-2",
      type: "workspace.renamed",
      actorId: user.id,
      now: 1_700_000_002_000,
    })

    const response = await call("ws-1", "", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.events).toHaveLength(2)
    // Newest first.
    expect(body.events[0].type).toBe("workspace.renamed")
    expect(body.events[0].actor).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    expect(body.events[1].type).toBe("member.role_changed")
    expect(body.events[1].actor).toEqual({
      id: actor.id,
      name: actor.name,
      email: actor.email,
    })
  })

  it("filters by type substring, case-insensitive", async () => {
    recordWorkspaceEvent({ workspaceId: "ws-1", type: "member.joined", now: 1 })
    recordWorkspaceEvent({ workspaceId: "ws-1", type: "workspace.renamed", now: 2 })
    recordWorkspaceEvent({ workspaceId: "ws-1", type: "Member.removed", now: 3 })

    const response = await call("ws-1", "?type=member.", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.events.map((e: { type: string }) => e.type)).toEqual([
      "Member.removed",
      "member.joined",
    ])
  })

  it("filters by since/until bounds", async () => {
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "a",
      now: Date.parse("2026-01-01T00:00:00Z"),
    })
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "b",
      now: Date.parse("2026-01-15T00:00:00Z"),
    })
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "c",
      now: Date.parse("2026-02-01T00:00:00Z"),
    })

    const response = await call("ws-1", "?since=2026-01-10T00:00:00Z&until=2026-01-31T00:00:00Z", {
      cookie: cookieFor(),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.events[0].type).toBe("b")
  })

  it("paginates with limit and offset", async () => {
    for (let i = 0; i < 5; i += 1) {
      recordWorkspaceEvent({ workspaceId: "ws-1", type: `e${i}`, now: i })
    }

    const first = await call("ws-1", "?limit=2&offset=0", { cookie: cookieFor() })
    const firstBody = await first.json()
    expect(firstBody.total).toBe(5)
    expect(firstBody.limit).toBe(2)
    expect(firstBody.events.map((e: { type: string }) => e.type)).toEqual(["e4", "e3"])

    const second = await call("ws-1", "?limit=2&offset=2", { cookie: cookieFor() })
    const secondBody = await second.json()
    expect(secondBody.events.map((e: { type: string }) => e.type)).toEqual(["e2", "e1"])
  })

  it("clamps limit into 1–200 and defaults to 50", async () => {
    for (let i = 0; i < 3; i += 1) {
      recordWorkspaceEvent({ workspaceId: "ws-1", type: `e${i}`, now: i })
    }

    const high = await call("ws-1", "?limit=999", { cookie: cookieFor() })
    expect((await high.json()).limit).toBe(200)

    const low = await call("ws-1", "?limit=0", { cookie: cookieFor() })
    expect((await low.json()).limit).toBe(1)
  })

  it("returns 400 for malformed dates", async () => {
    for (const query of [
      "?since=not-a-date",
      // Date.parse accepts these, but they are not ISO-8601-ish.
      "?since=Jan+1+2020",
      "?until=01/15/2026",
      "?since=2026-13-45",
    ]) {
      const response = await call("ws-1", query, { cookie: cookieFor() })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("accepts ISO-8601 dates and datetimes for since/until", async () => {
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "a",
      now: Date.parse("2026-01-10T00:00:00Z"),
    })
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "b",
      now: Date.parse("2026-01-20T00:00:00Z"),
    })

    // Date-only (what <input type="date"> sends) and full datetimes both work.
    for (const query of [
      "?since=2026-01-15",
      "?since=2026-01-15T00:00:00Z",
      "?since=2026-01-15T00:00:00.000Z&until=2026-01-31",
    ]) {
      const response = await call("ws-1", query, { cookie: cookieFor() })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.total).toBe(1)
      expect(body.events[0].type).toBe("b")
    }
  })

  it("returns 400 for malformed limit/offset", async () => {
    for (const query of ["?limit=abc", "?limit=-1", "?offset=-5", "?offset=1.5"]) {
      const response = await call("ws-1", query, { cookie: cookieFor() })
      expect(response.status).toBe(400)
    }
  })

  it("resolves unknown actorIds to a null actor", async () => {
    recordWorkspaceEvent({
      workspaceId: "ws-1",
      type: "system.event",
      actorId: "ghost",
      now: 1,
    })

    const response = await call("ws-1", "", { cookie: cookieFor() })
    const body = await response.json()
    expect(body.events[0].actor).toBeNull()
    expect(body.events[0].actorId).toBe("ghost")
  })
})
