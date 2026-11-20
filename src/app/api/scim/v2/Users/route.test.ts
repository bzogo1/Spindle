// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser, WorkspaceInfo, WorkspaceMemberInfo } from "@/lib/auth/backend"
import { createScimToken, resetScimTokensForTests } from "@/lib/scim-tokens"
import { SCIM_SCHEMA_LIST_RESPONSE, SCIM_SCHEMA_USER } from "@/lib/scim"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { GET, POST } from "./route"

const getWorkspace = vi.hoisted(() => vi.fn())
const getUserByEmail = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())
const upsertOAuthUser = vi.hoisted(() => vi.fn())
const addWorkspaceMember = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getWorkspace,
      getUserByEmail,
      listWorkspaceMembers,
      upsertOAuthUser,
      addWorkspaceMember,
    }),
  }
})

const workspace: WorkspaceInfo = { id: "ws-1", name: "Research team", slug: "research" }

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    email: "ada@example.com",
    name: "Ada",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function memberOf(
  user: AuthUser,
  role: WorkspaceMemberInfo["role"] = "member",
): WorkspaceMemberInfo {
  return { user, role }
}

let ipCounter = 0
let bearer: string

function call(
  method: "GET" | "POST",
  path: string,
  options: { token?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.0.${++ipCounter}`,
  }
  const token = options.token === undefined ? bearer : options.token
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost${path}`, init)
  return method === "GET" ? GET(request) : POST(request)
}

beforeEach(() => {
  getWorkspace.mockReset().mockResolvedValue(workspace)
  getUserByEmail.mockReset().mockResolvedValue(null)
  listWorkspaceMembers.mockReset().mockResolvedValue([])
  upsertOAuthUser.mockReset()
  addWorkspaceMember.mockReset()
  resetScimTokensForTests()
  resetWorkspaceAuditForTests()
  bearer = createScimToken("ws-1").token
})

describe("GET /api/scim/v2/Users", () => {
  it("rejects requests without a bearer token", async () => {
    const response = await call("GET", "/api/scim/v2/Users", { token: null })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
    expect(await response.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
    })
  })

  it("rejects forged tokens", async () => {
    const response = await call("GET", "/api/scim/v2/Users", { token: "spim_forged" })
    expect(response.status).toBe(401)
  })

  it("lists workspace members as SCIM Users in a ListResponse", async () => {
    listWorkspaceMembers.mockResolvedValue([
      memberOf(makeUser(), "admin"),
      memberOf(makeUser({ id: "user-2", email: "grace@example.com", name: "Grace" }), "member"),
    ])
    const response = await call("GET", "/api/scim/v2/Users")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schemas).toEqual([SCIM_SCHEMA_LIST_RESPONSE])
    expect(body.totalResults).toBe(2)
    expect(body.startIndex).toBe(1)
    expect(body.itemsPerPage).toBe(2)
    expect(body.Resources.map((r: { userName: string }) => r.userName)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ])
    expect(body.Resources[0].schemas).toEqual([SCIM_SCHEMA_USER])
    expect(body.Resources[0].meta.location).toBe("/api/scim/v2/Users/user-1")
  })

  it("applies the userName eq filter", async () => {
    listWorkspaceMembers.mockResolvedValue([
      memberOf(makeUser()),
      memberOf(makeUser({ id: "user-2", email: "grace@example.com" })),
    ])
    const response = await call(
      "GET",
      "/api/scim/v2/Users?filter=" + encodeURIComponent('userName eq "ADA@example.com"'),
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.totalResults).toBe(1)
    expect(body.Resources[0].id).toBe("user-1")
  })

  it("returns 400 for unsupported filters instead of ignoring them", async () => {
    const response = await call(
      "GET",
      "/api/scim/v2/Users?filter=" + encodeURIComponent('emails eq "a@b.co"'),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ status: "400" })
  })

  it("paginates with 1-based startIndex and count", async () => {
    listWorkspaceMembers.mockResolvedValue([
      memberOf(makeUser({ id: "u1", email: "u1@x.co" })),
      memberOf(makeUser({ id: "u2", email: "u2@x.co" })),
      memberOf(makeUser({ id: "u3", email: "u3@x.co" })),
    ])
    const response = await call("GET", "/api/scim/v2/Users?startIndex=2&count=1")
    const body = await response.json()
    expect(body.totalResults).toBe(3)
    expect(body.startIndex).toBe(2)
    expect(body.itemsPerPage).toBe(1)
    expect(body.Resources[0].id).toBe("u2")
  })

  it("caps count at the declared maxResults", async () => {
    listWorkspaceMembers.mockResolvedValue([memberOf(makeUser())])
    const response = await call("GET", "/api/scim/v2/Users?count=9999")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.itemsPerPage).toBe(1)
  })
})

describe("POST /api/scim/v2/Users", () => {
  const newUserBody = {
    schemas: [SCIM_SCHEMA_USER],
    userName: "new@example.com",
    name: { formatted: "New Person", givenName: "New", familyName: "Person" },
    emails: [{ value: "new@example.com", type: "work", primary: true }],
    active: true,
  }

  it("rejects invalid JSON and unparseable bodies", async () => {
    const badJson = await call("POST", "/api/scim/v2/Users", { body: "{not json" })
    expect(badJson.status).toBe(400)

    const noEmail = await call("POST", "/api/scim/v2/Users", { body: { userName: "no-at-sign" } })
    expect(noEmail.status).toBe(400)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("returns 404 when the token's workspace is gone", async () => {
    getWorkspace.mockResolvedValue(null)
    const response = await call("POST", "/api/scim/v2/Users", { body: newUserBody })
    expect(response.status).toBe(404)
  })

  it("provisions a new user at the workspace defaultJoinRole and audits it", async () => {
    const created = makeUser({ id: "user-new", email: "new@example.com", name: "New Person" })
    upsertOAuthUser.mockResolvedValue({ user: created, created: true })
    addWorkspaceMember.mockResolvedValue({ workspace, role: "member" })

    const response = await call("POST", "/api/scim/v2/Users", { body: newUserBody })

    expect(response.status).toBe(201)
    expect(upsertOAuthUser).toHaveBeenCalledWith({
      email: "new@example.com",
      name: "New Person",
      provider: "scim",
    })
    expect(addWorkspaceMember).toHaveBeenCalledWith({
      userId: "user-new",
      workspace,
      role: "member",
    })

    const body = await response.json()
    expect(body).toMatchObject({
      schemas: [SCIM_SCHEMA_USER],
      id: "user-new",
      userName: "new@example.com",
      active: true,
    })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "scim.user_provisioned",
      actorId: null,
      details: { userId: "user-new", email: "new@example.com", role: "member" },
    })
    expect(events[0].details.scimTokenId).toBeTruthy()
  })

  it("honours a configured defaultJoinRole of admin", async () => {
    const { updateWorkspaceSettings } = await import("@/lib/workspace-settings")
    const { resetWorkspaceSettingsForTests } = await import("@/lib/workspace-settings")
    resetWorkspaceSettingsForTests()
    updateWorkspaceSettings("ws-1", { defaultJoinRole: "admin" })

    const created = makeUser({ id: "user-new", email: "new@example.com" })
    upsertOAuthUser.mockResolvedValue({ user: created, created: true })
    addWorkspaceMember.mockResolvedValue({ workspace, role: "admin" })

    const response = await call("POST", "/api/scim/v2/Users", { body: newUserBody })
    expect(response.status).toBe(201)
    expect(addWorkspaceMember).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }))
  })

  it("returns 409 when the user already belongs to the workspace", async () => {
    const existing = makeUser()
    getUserByEmail.mockResolvedValue(existing)
    listWorkspaceMembers.mockResolvedValue([memberOf(existing, "member")])

    const response = await call("POST", "/api/scim/v2/Users", {
      body: { userName: "ada@example.com" },
    })
    expect(response.status).toBe(409)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
    expect(addWorkspaceMember).not.toHaveBeenCalled()
  })

  it("adds an existing global account that is not yet a member", async () => {
    const existing = makeUser({ id: "user-9", email: "ada@example.com" })
    getUserByEmail.mockResolvedValue(existing)
    listWorkspaceMembers.mockResolvedValue([])
    upsertOAuthUser.mockResolvedValue({ user: existing, created: false })
    addWorkspaceMember.mockResolvedValue({ workspace, role: "member" })

    const response = await call("POST", "/api/scim/v2/Users", {
      body: { userName: "ada@example.com" },
    })
    expect(response.status).toBe(201)
    expect(addWorkspaceMember).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-9" }))
  })
})
