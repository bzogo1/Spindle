// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createInvitationToken,
  invitationResendCooldown,
  invitationStore,
  invitationViewStatus,
  INVITATION_REMINDER_MAX_COUNT,
  INVITATION_REMINDER_MIN_INTERVAL_MS,
  INVITATION_REMINDER_WINDOW_MS,
  INVITATION_TTL_MS,
  MemoryInvitationStore,
  resolveInvitationByToken,
  verifyInvitationToken,
  type InvitationRecord,
} from "./invitations"

const inviter = { id: "user:u1", email: "owner@acme.dev", name: "Olivia Owner" }

function createInvite(overrides: Partial<Parameters<MemoryInvitationStore["create"]>[0]> = {}) {
  const store = new MemoryInvitationStore()
  const result = store.create({
    email: "teammate@acme.dev",
    role: "member",
    inviter,
    workspaceName: "Acme Research",
    ...overrides,
  })
  if (!result.ok) throw new Error("expected create to succeed")
  return { store, record: result.invitation }
}

function tokenFor(record: InvitationRecord) {
  return createInvitationToken(record.id, new Date(record.expiresAt), record.lastSentAt)
}

beforeEach(() => {
  invitationStore.reset()
  invitationResendCooldown.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("invitation tokens", () => {
  it("round-trips a minted token", () => {
    const { record } = createInvite()
    const token = tokenFor(record)
    const payload = verifyInvitationToken(token)
    expect(payload).toEqual({
      iid: record.id,
      exp: Math.floor(Date.parse(record.expiresAt) / 1000),
      sts: Date.parse(record.lastSentAt),
    })
  })

  it("rejects tampered, malformed, and foreign-version tokens", () => {
    const { record } = createInvite()
    const token = tokenFor(record)
    expect(verifyInvitationToken(`${token}x`)).toBeNull()
    expect(verifyInvitationToken("not-a-token")).toBeNull()
    expect(verifyInvitationToken(token.replace("inv1.", "inv2."))).toBeNull()
    expect(verifyInvitationToken("")).toBeNull()
  })

  it("rejects expired tokens unless ignoreExpiry is set", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const store = new MemoryInvitationStore()
    const result = store.create({
      email: "a@b.c",
      role: "member",
      inviter,
      workspaceName: "W",
    })
    if (!result.ok) throw new Error("unreachable")
    const token = tokenFor(result.invitation)

    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1000))
    expect(verifyInvitationToken(token)).toBeNull()
    expect(verifyInvitationToken(token, { ignoreExpiry: true })).not.toBeNull()
  })
})

describe("MemoryInvitationStore", () => {
  it("normalizes the invitee email and stamps inviter/workspace fields", () => {
    const { record } = createInvite({ email: "  Teammate@ACME.dev " })
    expect(record.email).toBe("teammate@acme.dev")
    expect(record.inviterEmail).toBe("owner@acme.dev")
    expect(record.status).toBe("pending")
    expect(record.acceptedAt).toBeNull()
    expect(Date.parse(record.expiresAt) - Date.parse(record.createdAt)).toBe(INVITATION_TTL_MS)
  })

  it("refuses a second live pending invite for the same email", () => {
    const store = new MemoryInvitationStore()
    const first = store.create({
      email: "dup@acme.dev",
      role: "member",
      inviter,
      workspaceName: "W",
    })
    expect(first.ok).toBe(true)
    const second = store.create({
      email: "DUP@acme.dev",
      role: "admin",
      inviter,
      workspaceName: "W",
    })
    expect(second).toMatchObject({ ok: false, code: "duplicate_pending" })
  })

  it("allows a fresh invite after the pending one expires", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const store = new MemoryInvitationStore()
    const input = { email: "e@acme.dev", role: "member" as const, inviter, workspaceName: "W" }
    expect(store.create(input).ok).toBe(true)
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(store.create(input).ok).toBe(true)
  })

  it("lists invites for the owning inviter, newest first", () => {
    vi.useFakeTimers()
    const store = new MemoryInvitationStore()
    store.create({ email: "a@x.dev", role: "member", inviter, workspaceName: "W" })
    vi.setSystemTime(Date.now() + 1000)
    store.create({
      email: "b@x.dev",
      role: "member",
      inviter: { id: "user:other", email: "o@x.dev", name: "Other" },
      workspaceName: "W",
    })
    vi.setSystemTime(Date.now() + 1000)
    store.create({ email: "c@x.dev", role: "admin", inviter, workspaceName: "W" })
    const list = store.listForInviter("user:u1")
    expect(list.map((r) => r.email)).toEqual(["c@x.dev", "a@x.dev"])
  })

  it("revokes only pending invites owned by the inviter", () => {
    const { store, record } = createInvite()
    expect(store.revoke("user:someone-else", record.id)).toBeNull()
    const revoked = store.revoke("user:u1", record.id)
    expect(revoked?.status).toBe("revoked")
    expect(store.revoke("user:u1", record.id)).toBeNull() // terminal now
  })

  it("resend extends expiry and stamps lastSentAt", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    vi.setSystemTime(new Date(Date.now() + 60_000))
    const resent = store.resend("user:u1", record.id)
    expect(resent).not.toBeNull()
    expect(Date.parse(resent!.lastSentAt)).toBe(Date.now())
    expect(Date.parse(resent!.expiresAt)).toBe(Date.now() + INVITATION_TTL_MS)
    expect(store.resend("user:u1", "inv_missing")).toBeNull()
  })

  it("accept is single-use and reports terminal states", () => {
    const { store, record } = createInvite()
    expect(store.accept(record.id, "user:new")).toMatchObject({ ok: true })
    expect(store.accept(record.id, "user:new2")).toEqual({ ok: false, reason: "used" })

    const second = createInvite({ email: "r@x.dev" })
    second.store.revoke("user:u1", second.record.id)
    expect(second.store.accept(second.record.id, "u")).toEqual({ ok: false, reason: "revoked" })

    expect(store.accept("inv_missing", "u")).toEqual({ ok: false, reason: "not_found" })
  })

  it("accept reports expired for past-due pending invites", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(store.accept(record.id, "u")).toEqual({ ok: false, reason: "expired" })
  })

  it("sweepExpired flips past-due pending invites to expired, lazily and explicitly", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    expect(store.getById(record.id)?.status).toBe("pending")

    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    // Lazy sweep on read.
    expect(store.getById(record.id)?.status).toBe("expired")
    expect(store.listForInviter("user:u1")[0].status).toBe("expired")
    // Explicit sweep is idempotent and reports nothing new.
    expect(store.sweepExpired()).toEqual([])
    expect(invitationViewStatus(store.getById(record.id)!)).toBe("expired")
  })

  it("resend revives a swept-expired invite and resets reminder counters", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    const reminded = store.remind("user:u1", record.id)
    expect(reminded.ok).toBe(true)

    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(store.getById(record.id)?.status).toBe("expired")

    const revived = store.resend("user:u1", record.id)
    expect(revived).not.toBeNull()
    expect(revived!.status).toBe("pending")
    expect(revived!.reminderCount).toBe(0)
    expect(revived!.lastReminderAt).toBeNull()
    expect(store.accept(record.id, "user:new")).toMatchObject({ ok: true })
  })

  it("accept reports expired AND flips status for lapsed invites", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    store.sweepExpired()
    expect(store.accept(record.id, "u")).toEqual({ ok: false, reason: "expired" })
    expect(store.getById(record.id)!.status).toBe("expired")
  })

  it("accept flips a lapsed pending invite to expired even without a prior sweep", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    // No sweepExpired/getById call — accept must flip the record itself.
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(store.accept(record.id, "u")).toEqual({ ok: false, reason: "expired" })
    // If accept had not flipped the status, this explicit sweep would still
    // find a pending record to expire.
    expect(store.sweepExpired()).toEqual([])
  })

  it("remind validates for the owning inviter only and does not stamp counters", () => {
    const { store, record } = createInvite()
    expect(store.remind("user:someone-else", record.id)).toEqual({
      ok: false,
      reason: "not_found",
    })
    expect(store.remind("user:u1", "inv_missing")).toEqual({ ok: false, reason: "not_found" })

    const result = store.remind("user:u1", record.id)
    expect(result.ok).toBe(true)
    // Validation only — stamping happens via markReminder after delivery,
    // so failed/unconfigured sends never burn reminder budget.
    const updated = store.getById(record.id)!
    expect(updated.reminderCount).toBe(0)
    expect(updated.lastReminderAt).toBeNull()
    // lastSentAt/expiresAt untouched — reminder does not rotate or extend.
    expect(updated.lastSentAt).toBe(record.lastSentAt)
    expect(updated.expiresAt).toBe(record.expiresAt)
  })

  it("remind + markReminder enforce the minimum interval and lifetime cap", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()

    // First reminder validates + stamps; an immediate second hits cooldown.
    expect(store.remind("user:u1", record.id).ok).toBe(true)
    expect(store.markReminder(record.id)).not.toBeNull()
    const cooling = store.remind("user:u1", record.id)
    expect(cooling.ok).toBe(false)
    if (!cooling.ok) {
      expect(cooling.reason).toBe("cooldown")
      expect(cooling.retryAfterSeconds).toBeGreaterThan(0)
    }

    // Past the interval, reminders proceed until the cap.
    vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
    for (let i = 0; i < INVITATION_REMINDER_MAX_COUNT - 1; i += 1) {
      vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
      expect(store.remind("user:u1", record.id).ok).toBe(true)
      expect(store.markReminder(record.id)).not.toBeNull()
    }
    expect(store.getById(record.id)!.reminderCount).toBe(INVITATION_REMINDER_MAX_COUNT)
    vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
    expect(store.remind("user:u1", record.id)).toEqual({ ok: false, reason: "cap" })
  })

  it("markReminder re-validates cap and interval atomically at stamp time", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()

    // A concurrent claim (e.g. manual remind landing between the tick's
    // snapshot and its stamp) consumes the slot first.
    expect(store.markReminder(record.id)).not.toBeNull()
    // Second stamp inside the interval is refused — no double-count.
    expect(store.markReminder(record.id)).toBeNull()
    expect(store.getById(record.id)!.reminderCount).toBe(1)

    // Burn the remaining budget, rewinding lastReminderAt between stamps so
    // only the cap — not the interval — gates the final attempt.
    for (let i = 1; i < INVITATION_REMINDER_MAX_COUNT; i += 1) {
      const rec = store.getById(record.id)!
      rec.lastReminderAt = new Date(
        Date.now() - INVITATION_REMINDER_MIN_INTERVAL_MS - 1,
      ).toISOString()
      expect(store.markReminder(record.id)).not.toBeNull()
    }
    expect(store.getById(record.id)!.reminderCount).toBe(INVITATION_REMINDER_MAX_COUNT)
    expect(store.markReminder(record.id)).toBeNull()

    // Terminal records can never be stamped.
    const other = createInvite({ email: "o@x.dev" })
    other.store.accept(other.record.id, "user:x")
    expect(other.store.markReminder(other.record.id)).toBeNull()
  })

  it("remind allows fresh invites (no near-expiry window) but pendingReminders does not", () => {
    const { store, record } = createInvite() // 7d left — outside tick window
    expect(store.pendingReminders()).toEqual([])
    // Manual remind is user-initiated: allowed anywhere in the pending window.
    expect(store.remind("user:u1", record.id).ok).toBe(true)
  })

  it("remind reports expired for lapsed invites (resend is the recovery)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(store.remind("user:u1", record.id)).toEqual({ ok: false, reason: "expired" })
  })

  it("pendingReminders returns only near-expiry invites with budget", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const store = new MemoryInvitationStore()
    const mk = (email: string) => {
      const r = store.create({ email, role: "member", inviter, workspaceName: "W" })
      if (!r.ok) throw new Error("unreachable")
      return r.invitation
    }
    const fresh = mk("fresh@x.dev") // 7d left — outside the window
    const due = mk("due@x.dev")
    const capped = mk("capped@x.dev")
    const terminal = mk("term@x.dev")

    // Move all three near-expiry invites inside the reminder window.
    const nearExpiry = new Date(Date.now() + INVITATION_REMINDER_WINDOW_MS - 60_000)
    for (const rec of [due, capped, terminal]) {
      rec.expiresAt = nearExpiry.toISOString()
    }
    // Cap one invite's reminders and terminate another.
    for (let i = 0; i < INVITATION_REMINDER_MAX_COUNT; i += 1) {
      store.markReminder(capped.id)
      capped.lastReminderAt = new Date(
        Date.now() - INVITATION_REMINDER_MIN_INTERVAL_MS - 1,
      ).toISOString()
    }
    store.accept(terminal.id, "user:x")

    const eligible = store.pendingReminders()
    expect(eligible.map((r) => r.id)).toEqual([due.id])
    expect(eligible.map((r) => r.id)).not.toContain(fresh.id)
  })

  it("pendingReminders respects the minimum interval between sends", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    record.expiresAt = new Date(Date.now() + INVITATION_REMINDER_WINDOW_MS - 1).toISOString()

    expect(store.pendingReminders().map((r) => r.id)).toEqual([record.id])
    store.markReminder(record.id)
    expect(store.pendingReminders()).toEqual([])

    vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
    expect(store.pendingReminders().map((r) => r.id)).toEqual([record.id])
  })

  it("stores workspaceId when provided and defaults it to null", () => {
    const { record } = createInvite({ workspaceId: "ws_acme" })
    expect(record.workspaceId).toBe("ws_acme")
    const plain = createInvite({ email: "plain@x.dev" })
    expect(plain.record.workspaceId).toBeNull()
  })

  it("release reverts a just-accepted invite to pending for the same user", () => {
    const { store, record } = createInvite()
    expect(store.accept(record.id, "user:new")).toMatchObject({ ok: true })
    expect(store.release(record.id, "user:new")).toBe(true)

    const reverted = store.getById(record.id)!
    expect(reverted.status).toBe("pending")
    expect(reverted.acceptedAt).toBeNull()
    expect(reverted.acceptedUserId).toBeNull()

    // The invite is usable again — and still single-use afterwards.
    expect(store.accept(record.id, "user:new")).toMatchObject({ ok: true })
    expect(store.accept(record.id, "user:other")).toEqual({ ok: false, reason: "used" })
  })

  it("release refuses to touch invites accepted by someone else or not accepted", () => {
    const { store, record } = createInvite()
    // Still pending — nothing to release.
    expect(store.release(record.id, "user:new")).toBe(false)

    expect(store.accept(record.id, "user:winner")).toMatchObject({ ok: true })
    // Wrong claimant cannot steal the release.
    expect(store.release(record.id, "user:loser")).toBe(false)
    expect(store.getById(record.id)?.status).toBe("accepted")

    // Terminal states are untouched too.
    const revoked = createInvite({ email: "r@x.dev" })
    revoked.store.revoke("user:u1", revoked.record.id)
    expect(revoked.store.release(revoked.record.id, "user:u1")).toBe(false)
    expect(revoked.store.getById(revoked.record.id)?.status).toBe("revoked")
  })
})

describe("invitationViewStatus", () => {
  it("maps pending-past-expiry to expired and passes terminal states through", () => {
    const { record } = createInvite()
    expect(invitationViewStatus(record)).toBe("pending")
    const past = { ...record, expiresAt: new Date(Date.now() - 1000).toISOString() }
    expect(invitationViewStatus(past)).toBe("expired")
    expect(invitationViewStatus({ ...record, status: "accepted" })).toBe("accepted")
    expect(invitationViewStatus({ ...record, status: "revoked" })).toBe("revoked")
  })
})

describe("resolveInvitationByToken", () => {
  function pendingWithToken() {
    const { store, record } = createInvite()
    const token = tokenFor(record)
    return { store, record, token }
  }

  it("resolves a live token to its pending record", () => {
    const { store, record, token } = pendingWithToken()
    expect(resolveInvitationByToken(token, store)).toEqual({
      status: "pending",
      invitation: record,
    })
  })

  it("reports invalid for forged tokens and unknown ids", () => {
    const { store, record } = createInvite()
    expect(resolveInvitationByToken("garbage", store).status).toBe("invalid")
    // Genuine signature but the record is gone (e.g. store reset).
    const orphan = tokenFor(record)
    store.reset()
    expect(resolveInvitationByToken(orphan, store).status).toBe("invalid")
  })

  it("reports used after acceptance", () => {
    const { store, record, token } = pendingWithToken()
    store.accept(record.id, "user:new")
    const resolved = resolveInvitationByToken(token, store)
    expect(resolved.status).toBe("used")
  })

  it("reports revoked after revocation", () => {
    const { store, record, token } = pendingWithToken()
    store.revoke("user:u1", record.id)
    expect(resolveInvitationByToken(token, store).status).toBe("revoked")
  })

  it("reports expired for past-due invites", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const store = new MemoryInvitationStore()
    const created = store.create({
      email: "e@x.dev",
      role: "member",
      inviter,
      workspaceName: "W",
    })
    if (!created.ok) throw new Error("unreachable")
    const token = tokenFor(created.invitation)
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    expect(resolveInvitationByToken(token, store).status).toBe("expired")
  })

  it("invalidates the previous link when the invite is resent", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { store, record } = createInvite()
    const firstToken = tokenFor(record)
    expect(resolveInvitationByToken(firstToken, store).status).toBe("pending")

    vi.setSystemTime(new Date(Date.now() + 60_000))
    const resent = store.resend("user:u1", record.id)
    expect(resent).not.toBeNull()
    // Old link is dead even though its signature and embedded expiry verify.
    expect(resolveInvitationByToken(firstToken, store).status).toBe("expired")
    // The freshly minted link resolves.
    const secondToken = tokenFor(resent!)
    expect(resolveInvitationByToken(secondToken, store).status).toBe("pending")
  })
})
