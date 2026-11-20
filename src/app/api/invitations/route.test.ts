// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { createAccessToken } from "@/lib/auth/token-codec"
import { MemoryAuthBackend, setAuthBackendForTests } from "@/lib/auth/backend"
import { invitationResendCooldown, invitationStore } from "@/lib/invitations"
import type { WorkspaceRole } from "@/lib/members/permissions"

import { GET, POST } from "./route"

const sendInvitationEmail = vi.fn()

vi.mock("@/lib/auth/mailer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mailer")>()
  return { ...mod, sendInvitationEmail: (...args: unknown[]) => sendInvitationEmail(...args) }
})

// Enable the mock-session branch of actor resolution; real helpers intact.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

function mockCookie(role: WorkspaceRole = "owner", email = "owner@acme.dev"): string {
  const session: MockSessionData = {
    user: { name: "Olivia Owner", email },
    workspace: { name: "Acme Research", slug: "acme", role },
    signedInAt: "2026-11-19T12:00:00.000Z",
  }
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(session)}`
}

function authCookie(uid = "u-admin", email = "real@acme.dev"): string {
  const { token } = createAccessToken({ sid: "s1", uid, email, name: "Real" })
  return `spindle_at=${token}`
}

let ipCounter = 0
function request(
  method: "GET" | "POST",
  options: { body?: unknown; cookie?: string; ip?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = options.cookie
  const init: RequestInit = { method, headers }
  if (method === "POST") {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body ?? {})
  }
  return method === "GET"
    ? GET(new Request("http://localhost/api/invitations", init))
    : POST(new Request("http://localhost/api/invitations", init))
}

beforeEach(() => {
  invitationStore.reset()
  invitationResendCooldown.reset()
  sendInvitationEmail.mockReset().mockResolvedValue(undefined)
})

describe("GET /api/invitations", () => {
  it("rejects unauthenticated callers", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("lists only the caller's invitations with view status", async () => {
    invitationStore.create({
      email: "a@x.dev",
      role: "member",
      inviter: { id: "mock:owner@acme.dev", email: "owner@acme.dev", name: "Olivia" },
      workspaceName: "Acme",
    })
    invitationStore.create({
      email: "b@x.dev",
      role: "member",
      inviter: { id: "mock:other@acme.dev", email: "other@acme.dev", name: "Other" },
      workspaceName: "Acme",
    })

    const response = await request("GET", { cookie: mockCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.invitations).toHaveLength(1)
    expect(body.invitations[0]).toMatchObject({
      email: "a@x.dev",
      role: "member",
      status: "pending",
      workspaceName: "Acme",
      inviterName: "Olivia",
    })
    expect(body.invitations[0]).not.toHaveProperty("inviterId")
  })

  it("rate-limits repeated GETs per IP", async () => {
    const ip = "203.0.113.200"
    // publicRead allows 60 requests/minute per IP; unauthenticated calls
    // still count toward the budget.
    for (let i = 0; i < 60; i += 1) {
      const response = await request("GET", { ip })
      expect(response.status).toBe(401)
    }
    const limited = await request("GET", { ip })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ code: "rate_limited" })
  })
})

describe("POST /api/invitations", () => {
  it("rejects unauthenticated callers and cross-origin posts", async () => {
    expect(
      (await request("POST", { body: { email: "invite-target@acme.dev", role: "member" } })).status,
    ).toBe(401)

    const foreign = await POST(
      new Request("http://localhost/api/invitations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: mockCookie(),
          origin: "https://evil.example",
        },
        body: JSON.stringify({ email: "invite-target@acme.dev", role: "member" }),
      }),
    )
    expect(foreign.status).toBe(403)
  })

  it("creates a pending invite and emails the accept link", async () => {
    const response = await request("POST", {
      cookie: mockCookie(),
      body: { email: "New@Acme.dev", role: "admin" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.invitation).toMatchObject({
      email: "new@acme.dev",
      role: "admin",
      status: "pending",
      workspaceName: "Acme Research",
      inviterName: "Olivia Owner",
    })
    expect(sendInvitationEmail).toHaveBeenCalledTimes(1)
    const mail = sendInvitationEmail.mock.calls[0][0]
    expect(mail.to).toBe("new@acme.dev")
    expect(mail.url).toContain("/invite?token=")
    expect(invitationStore.listForInviter("mock:owner@acme.dev")).toHaveLength(1)
  })

  it("works for real-auth sessions (owner of personal workspace)", async () => {
    const mem = new MemoryAuthBackend()
    const { user } = await mem.upsertOAuthUser({
      email: "real@acme.dev",
      provider: "test",
    })
    setAuthBackendForTests(mem)
    try {
      const response = await request("POST", {
        cookie: authCookie(user.id, "real@acme.dev"),
        body: { email: "join@acme.dev", role: "member" },
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.invitation.workspaceName).toBe("Personal workspace")
      expect(invitationStore.listForInviter(`user:${user.id}`)).toHaveLength(1)
    } finally {
      setAuthBackendForTests(undefined)
    }
  })

  it("enforces recorded workspace roles for real-auth sessions", async () => {
    const mem = new MemoryAuthBackend()
    const { user: owner, workspace } = await mem.signUp({
      email: "owner@acme.dev",
      password: "password123",
      workspaceName: "Acme",
    })
    const { user: admin } = await mem.upsertOAuthUser({
      email: "admin@acme.dev",
      provider: "test",
    })
    await mem.addWorkspaceMember({ userId: admin.id, workspace, role: "admin" })
    const { user: member } = await mem.upsertOAuthUser({
      email: "member@acme.dev",
      provider: "test",
    })
    await mem.addWorkspaceMember({ userId: member.id, workspace, role: "member" })
    setAuthBackendForTests(mem)
    try {
      // A member cannot invite at all — even for the member role.
      const memberInvite = await request("POST", {
        cookie: authCookie(member.id, "member@acme.dev"),
        body: { email: "x1@acme.dev", role: "member" },
      })
      expect(memberInvite.status).toBe(403)

      // An admin cannot grant owner…
      const adminOwner = await request("POST", {
        cookie: authCookie(admin.id, "admin@acme.dev"),
        body: { email: "x2@acme.dev", role: "owner" },
      })
      expect(adminOwner.status).toBe(403)

      // …but can grant member/admin.
      const adminMember = await request("POST", {
        cookie: authCookie(admin.id, "admin@acme.dev"),
        body: { email: "x3@acme.dev", role: "member" },
      })
      expect(adminMember.status).toBe(200)

      // The workspace owner can grant any role, including owner.
      const ownerInvite = await request("POST", {
        cookie: authCookie(owner.id, "owner@acme.dev"),
        body: { email: "x4@acme.dev", role: "owner" },
      })
      expect(ownerInvite.status).toBe(200)
      const body = await ownerInvite.json()
      expect(body.invitation.role).toBe("owner")
      expect(body.invitation.workspaceName).toBe("Acme")
    } finally {
      setAuthBackendForTests(undefined)
    }
  })

  it("fails closed when the real-auth role cannot be resolved", async () => {
    const mem = new MemoryAuthBackend()
    const { user } = await mem.upsertOAuthUser({
      email: "real@acme.dev",
      provider: "test",
    })
    // A backend whose membership lookup errors must not fall back to owner.
    vi.spyOn(mem, "listWorkspaceMemberships").mockRejectedValue(new Error("store down"))
    setAuthBackendForTests(mem)
    try {
      const response = await request("POST", {
        cookie: authCookie(user.id, "real@acme.dev"),
        body: { email: "join@acme.dev", role: "member" },
      })
      expect(response.status).toBe(401)
    } finally {
      setAuthBackendForTests(undefined)
    }
  })

  it("stores the inviter's workspaceId so accept can record membership", async () => {
    const mem = new MemoryAuthBackend()
    const { user } = await mem.upsertOAuthUser({
      email: "real@acme.dev",
      provider: "test",
    })
    setAuthBackendForTests(mem)
    try {
      const response = await request("POST", {
        cookie: authCookie(user.id),
        body: { email: "join@acme.dev", role: "member" },
      })
      expect(response.status).toBe(200)
      const [record] = invitationStore.listForInviter(`user:${user.id}`)
      const context = await mem.getSessionContext(user.id)
      expect(record.workspaceId).toBe(context?.workspace?.id)
      expect(record.workspaceId).toBeTruthy()
    } finally {
      setAuthBackendForTests(undefined)
    }
  })

  it("forbids members and admins granting owner", async () => {
    const memberPost = await request("POST", {
      cookie: mockCookie("member", "member@acme.dev"),
      body: { email: "invite-target@acme.dev", role: "member" },
    })
    expect(memberPost.status).toBe(403)

    const adminOwner = await request("POST", {
      cookie: mockCookie("admin", "admin@acme.dev"),
      body: { email: "invite-target@acme.dev", role: "owner" },
    })
    expect(adminOwner.status).toBe(403)

    const adminMember = await request("POST", {
      cookie: mockCookie("admin", "admin@acme.dev"),
      body: { email: "invite-target@acme.dev", role: "member" },
    })
    expect(adminMember.status).toBe(200)
  })

  it("rejects invalid bodies and self-invites", async () => {
    expect(
      (await request("POST", { cookie: mockCookie(), body: { email: "nope", role: "member" } }))
        .status,
    ).toBe(400)
    expect(
      (
        await request("POST", {
          cookie: mockCookie(),
          body: { email: "invite-target@acme.dev", role: "superuser" },
        })
      ).status,
    ).toBe(400)

    const self = await request("POST", {
      cookie: mockCookie(),
      body: { email: "owner@acme.dev", role: "member" },
    })
    expect(self.status).toBe(422)
    expect(await self.json()).toMatchObject({ code: "cannot_invite_self" })
  })

  it("answers 409 duplicate_pending for a live invite to the same email", async () => {
    invitationStore.create({
      email: "dup@acme.dev",
      role: "member",
      inviter: { id: "mock:owner@acme.dev", email: "owner@acme.dev", name: "Olivia" },
      workspaceName: "Acme",
    })
    invitationResendCooldown.reset() // isolate from the create-path cooldown

    const response = await request("POST", {
      cookie: mockCookie(),
      body: { email: "dup@acme.dev", role: "member" },
    })
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe("duplicate_pending")
    expect(body.invitation.email).toBe("dup@acme.dev")
  })

  it("rate-limits repeat sends to the same address", async () => {
    const ip = "203.0.113.99"
    await request("POST", {
      cookie: mockCookie(),
      ip,
      body: { email: "cool@acme.dev", role: "member" },
    })
    const second = await request("POST", {
      cookie: mockCookie(),
      ip,
      body: { email: "cool@acme.dev", role: "member" },
    })
    // Same email is inside the per-email cooldown — 429 before the store's
    // duplicate check even runs.
    expect(second.status).toBe(429)
    expect(second.headers.get("retry-after")).toBeTruthy()
  })
})
