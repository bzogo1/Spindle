import { beforeEach, describe, expect, it } from "vitest"

import { MemoryAuthBackend } from "./backend"
import {
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  MemorySessionLimitStore,
  UNLIMITED_SESSION_LIMIT,
  planSessionEvictions,
  sessionLimitSchema,
  setSessionLimitStoreForTests,
  type SessionDescriptor,
} from "./session-limits"

const NOW = 1_700_000_000_000

function session(
  id: string,
  createdAt: number,
  overrides: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    id,
    createdAt,
    revokedAt: null,
    expiresAt: NOW + 60_000,
    ...overrides,
  }
}

describe("sessionLimitSchema", () => {
  it("accepts 0 (unlimited) and 1–50", () => {
    expect(sessionLimitSchema.safeParse({ limit: 0 }).success).toBe(true)
    expect(sessionLimitSchema.safeParse({ limit: 1 }).success).toBe(true)
    expect(sessionLimitSchema.safeParse({ limit: MAX_SESSION_LIMIT }).success).toBe(true)
  })

  it("rejects out-of-range, fractional, and extra fields", () => {
    expect(sessionLimitSchema.safeParse({ limit: -1 }).success).toBe(false)
    expect(sessionLimitSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(sessionLimitSchema.safeParse({ limit: 2.5 }).success).toBe(false)
    expect(sessionLimitSchema.safeParse({ limit: "3" }).success).toBe(false)
    expect(sessionLimitSchema.safeParse({ limit: 3, extra: 1 }).success).toBe(false)
  })
})

describe("MemorySessionLimitStore", () => {
  let store: MemorySessionLimitStore

  beforeEach(() => {
    store = new MemorySessionLimitStore()
  })

  it("defaults to DEFAULT_SESSION_LIMIT when unset", () => {
    expect(store.getLimit("u1")).toBe(DEFAULT_SESSION_LIMIT)
    expect(store.getStoredLimit("u1")).toBeNull()
  })

  it("stores and returns per-user limits", () => {
    store.setLimit("u1", 2)
    store.setLimit("u2", UNLIMITED_SESSION_LIMIT)
    expect(store.getLimit("u1")).toBe(2)
    expect(store.getLimit("u2")).toBe(0)
    expect(store.getStoredLimit("u2")).toBe(0)
  })
})

describe("planSessionEvictions", () => {
  it("returns [] for unlimited or when within the cap", () => {
    const sessions = [session("a", 1), session("b", 2), session("c", 3)]
    expect(planSessionEvictions(sessions, 0, { now: NOW })).toEqual([])
    expect(planSessionEvictions(sessions, 3, { now: NOW })).toEqual([])
    expect(planSessionEvictions(sessions, 5, { now: NOW })).toEqual([])
  })

  it("evicts the oldest sessions first until within the cap", () => {
    const sessions = [session("newest", 30), session("oldest", 10), session("middle", 20)]
    // limit 2 with 3 active → evict exactly the oldest.
    expect(planSessionEvictions(sessions, 2, { now: NOW })).toEqual(["oldest"])
    // limit 1 → evict two oldest, keep newest.
    expect(planSessionEvictions(sessions, 1, { now: NOW })).toEqual(["oldest", "middle"])
  })

  it("ignores revoked and expired sessions", () => {
    const sessions = [
      session("dead", 1, { revokedAt: 5 }),
      session("expired", 2, { expiresAt: NOW - 1 }),
      session("live-old", 3),
      session("live-new", 4),
    ]
    expect(planSessionEvictions(sessions, 2, { now: NOW })).toEqual([])
    expect(planSessionEvictions(sessions, 1, { now: NOW })).toEqual(["live-old"])
  })

  it("preserveId survives even on createdAt ties", () => {
    // All minted in the same millisecond: without preserveId the id
    // tiebreak is arbitrary; the preserved (newest) session must survive.
    const sessions = [session("s1", 100), session("s2", 100), session("s3", 100)]
    const victims = planSessionEvictions(sessions, 2, { now: NOW, preserveId: "s3" })
    expect(victims).toHaveLength(1)
    expect(victims).not.toContain("s3")
  })
})

describe("session limit enforcement in MemoryAuthBackend", () => {
  let backend: MemoryAuthBackend
  let store: MemorySessionLimitStore

  beforeEach(() => {
    backend = new MemoryAuthBackend()
    store = new MemorySessionLimitStore()
    setSessionLimitStoreForTests(store)
  })

  async function signUp(email = "a@b.co") {
    const { user } = await backend.signUp({
      email,
      password: "password123",
      workspaceName: "W",
    })
    return user
  }

  async function signIn(email = "a@b.co") {
    const result = await backend.signIn(email, "password123")
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`)
    return result.tokens
  }

  it("evicts the oldest session when a new sign-in exceeds the limit", async () => {
    const user = await signUp()
    store.setLimit(user.id, 2)

    const t1 = await signIn()
    const t2 = await signIn()
    const t3 = await signIn()

    const sessions = await backend.listSessions(user.id)
    expect(sessions).toHaveLength(2)
    // Exactly one of the two older sessions was evicted (createdAt ties are
    // broken by id, so which of t1/t2 dies is not guaranteed); the session
    // being minted is always preserved.
    const [r1, r2, r3] = await Promise.all([
      backend.refreshSession(t1.refreshToken),
      backend.refreshSession(t2.refreshToken),
      backend.refreshSession(t3.refreshToken),
    ])
    expect([r1, r2].filter((r) => r === null)).toHaveLength(1)
    expect(r3).not.toBeNull()
  })

  it("does not evict while within the default limit", async () => {
    const user = await signUp()
    for (let i = 0; i < DEFAULT_SESSION_LIMIT; i++) await signIn()
    expect(await backend.listSessions(user.id)).toHaveLength(DEFAULT_SESSION_LIMIT)
  })

  it("limit 0 means unlimited", async () => {
    const user = await signUp()
    store.setLimit(user.id, UNLIMITED_SESSION_LIMIT)
    for (let i = 0; i < 7; i++) await signIn()
    expect(await backend.listSessions(user.id)).toHaveLength(7)
  })

  it("createSessionForUser (OAuth/passwordless path) is also capped", async () => {
    const user = await signUp()
    store.setLimit(user.id, 1)

    await backend.createSessionForUser(user.id)
    const second = await backend.createSessionForUser(user.id)

    const sessions = await backend.listSessions(user.id)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(second.session.sessionId)
  })

  it("does not evict another user's sessions", async () => {
    const u1 = await signUp("a@b.co")
    store.setLimit(u1.id, 1)
    await signIn("a@b.co")
    await signIn("a@b.co") // evicts u1's first session

    const u2 = await signUp("c@d.co")
    await signIn("c@d.co")
    expect(await backend.listSessions(u2.id)).toHaveLength(1)
  })

  it("counts only the target user's sessions — other users' sessions never evicted", async () => {
    // Regression: enforceSessionLimit previously fed ALL sessions in the
    // backend into the planner, so a user's sign-in could count and evict
    // other users' sessions (cross-tenant sign-out).
    const a = await signUp("a@b.co")
    const b = await signUp("c@d.co")
    store.setLimit(a.id, 2)
    store.setLimit(b.id, 2)

    // A is exactly at its limit.
    const a1 = await signIn("a@b.co")
    const a2 = await signIn("a@b.co")
    // B overflows by one — total active sessions across users is now 5,
    // far above B's limit of 2. A correct per-user count sees only B's 3.
    const b1 = await signIn("c@d.co")
    const b2 = await signIn("c@d.co")
    const b3 = await signIn("c@d.co")

    // A's sessions are untouched: both still listed as active.
    const aSessions = await backend.listSessions(a.id)
    expect(aSessions.map((s) => s.id).sort()).toEqual(
      [a1.session.sessionId, a2.session.sessionId].sort(),
    )

    // B is capped at 2 with the just-minted session preserved; exactly one
    // of b1/b2 was evicted (createdAt ties break by id, so which is
    // arbitrary).
    const bSessions = await backend.listSessions(b.id)
    expect(bSessions).toHaveLength(2)
    expect(bSessions[0].id).toBe(b3.session.sessionId)
    const [rb1, rb2] = await Promise.all([
      backend.refreshSession(b1.refreshToken),
      backend.refreshSession(b2.refreshToken),
    ])
    expect([rb1, rb2].filter((r) => r === null)).toHaveLength(1)
  })
})
