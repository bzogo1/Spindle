// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_AUDIT_CAPACITY,
  MemoryAuthAuditLog,
  listAuthEvents,
  recordAuthEvent,
  setAuthAuditLogForTests,
} from "./audit"

const signIn = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ signIn }),
  }
})

import { POST as signinPOST } from "@/app/api/auth/signin/route"

function postSignin(body: unknown, ip: string) {
  return signinPOST(
    new Request("http://localhost/api/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
        "user-agent": "audit-test-agent",
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  signIn.mockReset()
  setAuthAuditLogForTests(new MemoryAuthAuditLog(10))
})

describe("MemoryAuthAuditLog", () => {
  it("records events with timestamp, identity, ip, and userAgent", () => {
    const log = new MemoryAuthAuditLog()
    const event = log.record({
      type: "signin.success",
      userId: "u1",
      email: "ada@lab.edu",
      ip: "10.0.0.1",
      userAgent: "test-agent",
      metadata: { via: "password" },
    })

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(event).toMatchObject({
      type: "signin.success",
      userId: "u1",
      email: "ada@lab.edu",
      ip: "10.0.0.1",
      userAgent: "test-agent",
      metadata: { via: "password" },
    })
    expect(log.list()).toEqual([event])
  })

  it("defaults nullable fields to null", () => {
    const event = new MemoryAuthAuditLog().record({ type: "logout" })
    expect(event).toMatchObject({
      userId: null,
      email: null,
      ip: null,
      userAgent: null,
      metadata: {},
    })
  })

  it("evicts the oldest events once the capacity is exceeded", () => {
    const log = new MemoryAuthAuditLog(3)
    for (let i = 0; i < 5; i += 1) {
      log.record({ type: "logout", metadata: { i } })
    }
    expect(log.size).toBe(3)
    const events = log.list({ limit: 10 })
    // Newest first; i=0 and i=1 were evicted.
    expect(events.map((event) => event.metadata.i)).toEqual([4, 3, 2])
  })

  it("uses the default capacity when none is given", () => {
    const log = new MemoryAuthAuditLog()
    for (let i = 0; i < DEFAULT_AUDIT_CAPACITY + 5; i += 1) {
      log.record({ type: "token.refresh" })
    }
    expect(log.size).toBe(DEFAULT_AUDIT_CAPACITY)
  })

  it("filters by userId, email, and type", () => {
    const log = new MemoryAuthAuditLog()
    log.record({ type: "signin.success", userId: "u1", email: "a@x.io" })
    log.record({
      type: "signin.failure",
      email: "a@x.io",
      metadata: { reason: "invalid_credentials" },
    })
    log.record({ type: "logout", userId: "u2", email: "b@x.io" })

    expect(log.list({ userId: "u1" })).toHaveLength(1)
    expect(log.list({ email: "a@x.io" })).toHaveLength(2)
    expect(log.list({ type: "signin.failure" })).toHaveLength(1)
    expect(log.list({ userId: "u1", type: "logout" })).toHaveLength(0)
  })

  it("returns newest-first and honors the limit", () => {
    const log = new MemoryAuthAuditLog()
    for (let i = 0; i < 5; i += 1) log.record({ type: "logout", metadata: { i } })

    const events = log.list({ limit: 2 })
    expect(events.map((event) => event.metadata.i)).toEqual([4, 3])
  })

  it("clamps the limit into a sane range", () => {
    const log = new MemoryAuthAuditLog()
    log.record({ type: "logout" })
    expect(log.list({ limit: 0 })).toHaveLength(1)
    expect(log.list({ limit: 10_000 })).toHaveLength(1)
  })
})

describe("module helpers", () => {
  it("recordAuthEvent/listAuthEvents delegate to the configured store", () => {
    recordAuthEvent({ type: "signin.success", userId: "u9", email: "u9@x.io" })
    const events = listAuthEvents({ userId: "u9" })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "signin.success", userId: "u9" })
  })
})

describe("POST /api/auth/signin audit events", () => {
  it("records signin.failure with the attempted email on bad credentials", async () => {
    signIn.mockResolvedValue({ status: "invalid" })
    const response = await postSignin({ email: "ada@lab.edu", password: "wrong" }, "10.1.1.1")

    expect(response.status).toBe(401)
    const events = listAuthEvents({ email: "ada@lab.edu" })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "signin.failure",
      email: "ada@lab.edu",
      userId: null,
      ip: "10.1.1.1",
      userAgent: "audit-test-agent",
      metadata: { reason: "invalid_credentials" },
    })
    // The password must never appear anywhere in the recorded event.
    expect(JSON.stringify(events[0])).not.toContain("wrong")
  })

  it("records signin.success with the user id on a completed sign-in", async () => {
    signIn.mockResolvedValue({
      status: "ok",
      tokens: {
        accessToken: "at",
        refreshToken: "rt",
        session: {
          user: {
            id: "u1",
            email: "ada@lab.edu",
            name: "Ada",
            emailVerified: true,
            createdAt: new Date().toISOString(),
          },
          workspace: null,
          sessionId: "s1",
          expiresAt: new Date().toISOString(),
        },
      },
    })
    const response = await postSignin(
      { email: "ada@lab.edu", password: "correct-horse" },
      "10.1.1.2",
    )

    expect(response.status).toBe(200)
    const events = listAuthEvents({ userId: "u1" })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "signin.success",
      userId: "u1",
      email: "ada@lab.edu",
      ip: "10.1.1.2",
    })
    expect(JSON.stringify(events[0])).not.toContain("correct-horse")
    expect(JSON.stringify(events[0])).not.toContain('"rt"')
  })

  it("records signin.totp_challenge when the account requires 2FA", async () => {
    signIn.mockResolvedValue({ status: "totp_required", challenge: "ch" })
    const response = await postSignin(
      { email: "ada@lab.edu", password: "correct-horse" },
      "10.1.1.3",
    )

    expect(response.status).toBe(200)
    const events = listAuthEvents({ email: "ada@lab.edu" })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "signin.totp_challenge",
      email: "ada@lab.edu",
      userId: null,
    })
  })
})
