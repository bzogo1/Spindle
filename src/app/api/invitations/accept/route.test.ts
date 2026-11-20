// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MemoryAuthBackend, setAuthBackendForTests } from "@/lib/auth/backend"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { createInvitationToken, invitationStore, type InvitationRecord } from "@/lib/invitations"

import { GET, POST } from "./route"

vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const INVITER = { id: "mock:owner@acme.dev", email: "owner@acme.dev", name: "Olivia Owner" }

let backend: MemoryAuthBackend

function seedInvite(
  email = "invitee@acme.dev",
  overrides: { workspaceId?: string | null; role?: "owner" | "admin" | "member" } = {},
): { record: InvitationRecord; token: string } {
  const result = invitationStore.create({
    email,
    role: overrides.role ?? "member",
    inviter: INVITER,
    workspaceName: "Acme Research",
    workspaceId: overrides.workspaceId ?? null,
  })
  if (!result.ok) throw new Error("seed failed")
  const token = createInvitationToken(
    result.invitation.id,
    new Date(result.invitation.expiresAt),
    result.invitation.lastSentAt,
  )
  return { record: result.invitation, token }
}

function mockCookie(email = "someone@acme.dev"): string {
  const session: MockSessionData = {
    user: { name: "Existing User", email },
    workspace: { name: "Old Workspace", slug: "old" },
    signedInAt: "2026-11-19T12:00:00.000Z",
  }
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(session)}`
}

let ipCounter = 0
function getStatus(token: string | null) {
  ipCounter += 1
  const url = token
    ? `http://localhost/api/invitations/accept?token=${encodeURIComponent(token)}`
    : "http://localhost/api/invitations/accept"
  return GET(new Request(url, { headers: { "x-forwarded-for": `198.51.100.${ipCounter}` } }))
}

function accept(token: string, options: { cookie?: string; ip?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = options.cookie
  return POST(
    new Request("http://localhost/api/invitations/accept", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    }),
  )
}

beforeEach(() => {
  invitationStore.reset()
  backend = new MemoryAuthBackend()
  setAuthBackendForTests(backend)
})

describe("GET /api/invitations/accept", () => {
  it("reports pending with invite details for a live token", async () => {
    const { token } = seedInvite()
    const response = await getStatus(token)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("pending")
    expect(body.invitation).toMatchObject({
      email: "invitee@acme.dev",
      role: "member",
      workspaceName: "Acme Research",
      inviterName: "Olivia Owner",
    })
  })

  it("reports invalid without a token or for a forged one", async () => {
    expect((await getStatus(null)).status).toBe(200)
    expect(await (await getStatus(null)).json()).toMatchObject({ status: "invalid" })
    expect(await (await getStatus("forged.token.here")).json()).toMatchObject({
      status: "invalid",
    })
  })

  it("reports used, revoked, and expired states", async () => {
    const used = seedInvite("used@acme.dev")
    invitationStore.accept(used.record.id, "user:x")
    expect(await (await getStatus(used.token)).json()).toMatchObject({ status: "used" })

    const revoked = seedInvite("revoked@acme.dev")
    invitationStore.revoke(INVITER.id, revoked.record.id)
    expect(await (await getStatus(revoked.token)).json()).toMatchObject({ status: "revoked" })

    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const expired = seedInvite("expired@acme.dev")
    vi.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))
    expect(await (await getStatus(expired.token)).json()).toMatchObject({ status: "expired" })
    vi.useRealTimers()
  })
})

describe("POST /api/invitations/accept — mock session mode", () => {
  it("consumes the invite and sets a mock session cookie for the invitee", async () => {
    const { record, token } = seedInvite()
    const response = await accept(token)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("accepted")
    expect(body.invitation.status).toBe("accepted")

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${MOCK_SESSION_COOKIE}=`)
    expect(setCookie).toContain("Max-Age")

    // Single-use: a second accept with the same token fails.
    const again = await accept(token, { ip: "203.0.113.50" })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: "invite_used" })
    expect(invitationStore.getById(record.id)?.acceptedUserId).toBe("mock:invitee@acme.dev")
  })

  it("replaces an existing mock session for a different account", async () => {
    const { token } = seedInvite()
    const response = await accept(token, { cookie: mockCookie("other@acme.dev") })
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(MOCK_SESSION_COOKIE)
  })

  it("rejects revoked, expired, and forged tokens", async () => {
    const revoked = seedInvite("rev@acme.dev")
    invitationStore.revoke(INVITER.id, revoked.record.id)
    const r1 = await accept(revoked.token, { ip: "203.0.113.51" })
    expect(r1.status).toBe(410)
    expect(await r1.json()).toMatchObject({ code: "invite_revoked" })

    const r2 = await accept("forged.token.here", { ip: "203.0.113.52" })
    expect(r2.status).toBe(400)
    expect(await r2.json()).toMatchObject({ code: "invalid_token" })
  })
})

describe("POST /api/invitations/accept — real auth mode", () => {
  it("provisions the invitee account and sets auth cookies", async () => {
    // A real access cookie forces the backend path even with mock auth on.
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    const { record, token } = seedInvite("newbie@acme.dev")
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.60",
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("accepted")
    expect(body.session.user.email).toBe("newbie@acme.dev")

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("spindle_at=")
    expect(setCookie).toContain("spindle_rt=")

    expect(invitationStore.getById(record.id)?.acceptedUserId).toBeTruthy()
    expect(invitationStore.getById(record.id)?.acceptedUserId).not.toBe("mock:newbie@acme.dev")
  })

  it("records workspace membership at the invited role and joins the workspace", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    // The invite targets the inviter's workspace id, as created via
    // POST /api/invitations with a real-auth actor.
    const { record, token } = seedInvite("joiner@acme.dev", {
      workspaceId: "ws_acme_research",
      role: "admin",
    })
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.61",
    })
    expect(response.status).toBe(200)
    const body = await response.json()

    // The issued session already resolves to the joined workspace.
    expect(body.session.workspace).toMatchObject({
      id: "ws_acme_research",
      name: "Acme Research",
    })

    const invitee = await backend.getUserByEmail("joiner@acme.dev")
    expect(invitee).not.toBeNull()
    const memberships = await backend.listWorkspaceMemberships(invitee!.id)
    expect(memberships).toContainEqual({
      workspace: expect.objectContaining({ id: "ws_acme_research", name: "Acme Research" }),
      role: "admin",
    })
    expect(invitationStore.getById(record.id)?.acceptedUserId).toBe(invitee!.id)
  })

  it("still accepts invites that carry no workspaceId (membership skipped)", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    const { token } = seedInvite("noworkspace@acme.dev")
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.62",
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    // Falls back to the invitee's own provisioned workspace.
    expect(body.session.workspace.name).toBe("Personal workspace")
  })

  it("releases the invite when session issuance fails", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    const { record, token } = seedInvite("retry@acme.dev", { workspaceId: "ws_acme" })
    const failingBackend = new MemoryAuthBackend()
    vi.spyOn(failingBackend, "createSessionForUser").mockRejectedValue(new Error("boom"))
    // Point the route at the failing backend for this request only.
    setAuthBackendForTests(failingBackend)
    try {
      const response = await accept(token, {
        cookie: `spindle_at=${accessToken}`,
        ip: "203.0.113.63",
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ code: "accept_failed" })
    } finally {
      setAuthBackendForTests(backend)
    }

    // Compensation: invite is pending again and membership was rolled back
    // on the backend that actually served the request.
    const after = invitationStore.getById(record.id)
    expect(after?.status).toBe("pending")
    expect(after?.acceptedUserId).toBeNull()
    const invitee = await failingBackend.getUserByEmail("retry@acme.dev")
    expect(await failingBackend.listWorkspaceMemberships(invitee!.id)).toEqual([
      expect.objectContaining({
        workspace: expect.objectContaining({ name: "Personal workspace" }),
      }),
    ])
  })

  it("keeps an existing member's role when they accept another invite", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    // The invitee already belongs to the target workspace as a member —
    // e.g. they joined earlier and a second invite (even one offering
    // owner) is accepted.
    const { workspace } = await backend.signUp({
      email: "owner@acme.dev",
      password: "password123",
      workspaceName: "Acme Research",
    })
    const { user: invitee } = await backend.upsertOAuthUser({
      email: "member@acme.dev",
      provider: "test",
    })
    await backend.addWorkspaceMember({ userId: invitee.id, workspace, role: "member" })

    const { token } = seedInvite("member@acme.dev", {
      workspaceId: workspace.id,
      role: "owner",
    })
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.64",
    })
    expect(response.status).toBe(200)

    // Re-accepting must not overwrite the recorded role.
    const memberships = await backend.listWorkspaceMemberships(invitee.id)
    expect(memberships).toContainEqual({
      workspace: expect.objectContaining({ id: workspace.id }),
      role: "member",
    })
  })

  it("restores a pre-existing membership instead of deleting it on session failure", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    const { workspace } = await backend.signUp({
      email: "owner@acme.dev",
      password: "password123",
      workspaceName: "Acme Research",
    })
    const { user: invitee } = await backend.upsertOAuthUser({
      email: "admin@acme.dev",
      provider: "test",
    })
    await backend.addWorkspaceMember({ userId: invitee.id, workspace, role: "admin" })

    const { record, token } = seedInvite("admin@acme.dev", {
      workspaceId: workspace.id,
      role: "member",
    })
    vi.spyOn(backend, "createSessionForUser").mockRejectedValueOnce(new Error("boom"))
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.65",
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: "accept_failed" })

    // The invite is released AND the pre-existing membership survives with
    // its prior role — the rollback must not remove what the invite did not
    // create.
    const after = invitationStore.getById(record.id)
    expect(after?.status).toBe("pending")
    const memberships = await backend.listWorkspaceMemberships(invitee.id)
    expect(memberships).toContainEqual({
      workspace: expect.objectContaining({ id: workspace.id }),
      role: "admin",
    })
  })

  it("releases the invite and fails closed when the membership lookup errors", async () => {
    const { createAccessToken } = await import("@/lib/auth/token-codec")
    const { token: accessToken } = createAccessToken({
      sid: "s1",
      uid: "u-someone-else",
      email: "other@acme.dev",
      name: "Other",
    })

    const { record, token } = seedInvite("lookupfail@acme.dev", { workspaceId: "ws_acme" })
    // The pre-write membership lookup is the first call after accept; make
    // only it throw so later assertions can read state normally.
    vi.spyOn(backend, "listWorkspaceMemberships").mockRejectedValueOnce(new Error("boom"))
    const response = await accept(token, {
      cookie: `spindle_at=${accessToken}`,
      ip: "203.0.113.66",
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: "accept_failed" })

    // The invite was handed back, and no membership was written: the invitee
    // keeps only the personal workspace their account was provisioned with.
    const after = invitationStore.getById(record.id)
    expect(after?.status).toBe("pending")
    expect(after?.acceptedUserId).toBeNull()
    const invitee = await backend.getUserByEmail("lookupfail@acme.dev")
    const memberships = await backend.listWorkspaceMemberships(invitee!.id)
    expect(memberships).toEqual([
      expect.objectContaining({
        workspace: expect.objectContaining({ name: "Personal workspace" }),
      }),
    ])
  })
})
