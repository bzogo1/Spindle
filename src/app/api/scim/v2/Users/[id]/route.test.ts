// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser, WorkspaceInfo, WorkspaceMemberInfo } from "@/lib/auth/backend"
import { createScimToken, resetScimTokensForTests } from "@/lib/scim-tokens"
import { SCIM_SCHEMA_USER } from "@/lib/scim"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import { updateWorkspaceSettings, resetWorkspaceSettingsForTests } from "@/lib/workspace-settings"

import { DELETE, GET, PATCH } from "./route"

const getWorkspace = vi.hoisted(() => vi.fn())
const getUserById = vi.hoisted(() => vi.fn())
const getUserByEmail = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())
const addWorkspaceMember = vi.hoisted(() => vi.fn())
const removeWorkspaceMember = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getWorkspace,
      getUserById,
      getUserByEmail,
      listWorkspaceMembers,
      addWorkspaceMember,
      removeWorkspaceMember,
    }),
  }
})

const workspace: WorkspaceInfo = { id: "ws-1", name: "Research team", slug: "research" }

const ada: AuthUser = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
}

function memberOf(
  user: AuthUser,
  role: WorkspaceMemberInfo["role"] = "member",
): WorkspaceMemberInfo {
  return { user, role }
}

let ipCounter = 0
let bearer: string

type RouteContext = { params: Promise<{ id: string }> }
const ctx = (id: string): RouteContext => ({ params: Promise.resolve({ id }) })

function call(
  method: "GET" | "PATCH" | "DELETE",
  userId: string,
  options: { token?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.8.0.${++ipCounter}`,
  }
  const token = options.token === undefined ? bearer : options.token
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body)
  }
  const request = new Request(
    `http://localhost/api/scim/v2/Users/${encodeURIComponent(userId)}`,
    init,
  )
  const context = ctx(userId)
  if (method === "GET") return GET(request, context)
  if (method === "PATCH") return PATCH(request, context)
  return DELETE(request, context)
}

const patchActive = (active: boolean) => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  Operations: [{ op: "replace", path: "active", value: active }],
})

beforeEach(() => {
  getWorkspace.mockReset().mockResolvedValue(workspace)
  getUserById.mockReset()
  getUserByEmail.mockReset()
  listWorkspaceMembers.mockReset().mockResolvedValue([memberOf(ada)])
  addWorkspaceMember.mockReset()
  removeWorkspaceMember.mockReset().mockResolvedValue(undefined)
  resetScimTokensForTests()
  resetWorkspaceAuditForTests()
  resetWorkspaceSettingsForTests()
  bearer = createScimToken("ws-1").token
})

describe("GET /api/scim/v2/Users/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await call("GET", "user-1", { token: null })
    expect(response.status).toBe(401)
  })

  it("returns the SCIM User resource for a member", async () => {
    const response = await call("GET", "user-1")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      schemas: [SCIM_SCHEMA_USER],
      id: "user-1",
      userName: "ada@example.com",
      active: true,
    })
  })

  it("returns 404 for ids outside the workspace roster", async () => {
    const response = await call("GET", "user-unknown")
    expect(response.status).toBe(404)
  })
})

describe("PATCH /api/scim/v2/Users/[id]", () => {
  it("rejects malformed JSON and non-PatchOp bodies", async () => {
    expect((await call("PATCH", "user-1", { body: "{oops" })).status).toBe(400)
    expect((await call("PATCH", "user-1", { body: { hello: "world" } })).status).toBe(400)
  })

  it("rejects operations that do not target active", async () => {
    const response = await call("PATCH", "user-1", {
      body: {
        Operations: [{ op: "replace", path: "displayName", value: "x" }],
      },
    })
    expect(response.status).toBe(400)
    expect(removeWorkspaceMember).not.toHaveBeenCalled()
  })

  it("deprovisions on active:false → 204, removes membership, audits", async () => {
    const response = await call("PATCH", "user-1", { body: patchActive(false) })
    expect(response.status).toBe(204)
    expect(removeWorkspaceMember).toHaveBeenCalledWith("user-1", "ws-1")

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "scim.user_deprovisioned",
      actorId: null,
      details: { userId: "user-1", userName: "ada@example.com" },
    })
  })

  it("returns 404 when deprovisioning a non-member", async () => {
    listWorkspaceMembers.mockResolvedValue([])
    const response = await call("PATCH", "user-1", { body: patchActive(false) })
    expect(response.status).toBe(404)
    expect(removeWorkspaceMember).not.toHaveBeenCalled()
  })

  it("is idempotent on active:true for an existing member", async () => {
    const response = await call("PATCH", "user-1", { body: patchActive(true) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "user-1", active: true })
    expect(addWorkspaceMember).not.toHaveBeenCalled()
  })

  it("re-provisions a known non-member user at defaultJoinRole", async () => {
    listWorkspaceMembers.mockResolvedValue([])
    getUserById.mockResolvedValue(ada)
    updateWorkspaceSettings("ws-1", { defaultJoinRole: "admin" })
    addWorkspaceMember.mockResolvedValue({ workspace, role: "admin" })

    const response = await call("PATCH", "user-1", { body: patchActive(true) })
    expect(response.status).toBe(200)
    expect(addWorkspaceMember).toHaveBeenCalledWith({
      userId: "user-1",
      workspace,
      role: "admin",
    })
    const events = listWorkspaceEvents("ws-1").events
    expect(events[0]).toMatchObject({ type: "scim.user_provisioned", details: { role: "admin" } })
  })

  it("returns 404 when activating an unknown user id", async () => {
    listWorkspaceMembers.mockResolvedValue([])
    getUserById.mockResolvedValue(null)
    const response = await call("PATCH", "user-ghost", { body: patchActive(true) })
    expect(response.status).toBe(404)
  })
})

describe("DELETE /api/scim/v2/Users/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await call("DELETE", "user-1", { token: null })).status).toBe(401)
  })

  it("deprovisions a member → 204 with audit event", async () => {
    const response = await call("DELETE", "user-1")
    expect(response.status).toBe(204)
    expect(removeWorkspaceMember).toHaveBeenCalledWith("user-1", "ws-1")
    expect(listWorkspaceEvents("ws-1").events[0]).toMatchObject({
      type: "scim.user_deprovisioned",
      details: { userId: "user-1" },
    })
  })

  it("returns 404 for non-members", async () => {
    listWorkspaceMembers.mockResolvedValue([])
    const response = await call("DELETE", "user-1")
    expect(response.status).toBe(404)
    expect(removeWorkspaceMember).not.toHaveBeenCalled()
  })
})
