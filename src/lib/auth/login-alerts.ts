import { randomUUID } from "node:crypto"

import type { AuthBackend } from "@/lib/auth/backend"
import { publishNotificationEvent } from "@/lib/notifications/hub"

/**
 * Suspicious-login alerts.
 *
 * Heuristics evaluated at sign-in time produce per-user alert records that
 * surface on `/app/security` and (when enabled) fan out through the
 * notifications hub:
 *
 *  - `new_device`  — sign-in from a user agent never seen for this account.
 *  - `new_ip`      — sign-in from an IP address never seen for this account.
 *  - `velocity`    — more successful sign-ins than expected in a short window
 *                    (possible credential stuffing or session hijack replay).
 *  - `brute_force` — repeated failed sign-ins against the account email.
 *
 * Like {@link MemoryAuthBackend} and the auth audit log this is a DEVELOPMENT
 * store: alerts live in a bounded in-memory structure inside one process and
 * are lost on restart. It exists so the alert flow is exercisable in dev and
 * tests; production MUST persist alerts behind the same
 * `getLoginAlertStore`/`setLoginAlertStoreForTests` seam (see
 * prisma/AUTH-SCHEMA.md).
 *
 * NEVER store passwords, tokens, session ids, or request bodies here. The
 * user agent and IP are security context the user is allowed to see about
 * their own account; they are truncated before being stored on an alert.
 */

export type LoginAlertKind = "new_device" | "new_ip" | "velocity" | "brute_force"
export type LoginAlertSeverity = "info" | "warning" | "critical"

export interface LoginAlert {
  id: string
  userId: string
  kind: LoginAlertKind
  severity: LoginAlertSeverity
  /** Short human-readable headline for lists and notifications. */
  title: string
  /** One-sentence explanation shown under the title. */
  detail: string
  /** Client IP observed for the triggering sign-in, if known. */
  ip: string | null
  /** Truncated user-agent string observed for the triggering sign-in. */
  userAgent: string | null
  createdAt: string
  read: boolean
}

/** Per-user delivery preferences for login alerts. */
export interface LoginAlertPreferences {
  /** Push a realtime inbox notification when an alert is created. */
  inAppNotifications: boolean
  /** Reserved for outbound mail delivery once a mailer is wired; stored now
   *  so the preference surface is stable. */
  emailNotifications: boolean
}

export const DEFAULT_LOGIN_ALERT_PREFERENCES: LoginAlertPreferences = {
  inAppNotifications: true,
  emailNotifications: true,
}

export interface SignInFingerprint {
  userId: string
  email: string
  ip: string | null
  userAgent: string | null
}

/**
 * Draft returned by `recordSignInFailure` when the failure window crosses the
 * brute-force threshold. The caller resolves `email` to a user and calls
 * `createAlert` — failed sign-ins carry no verified identity, so the store
 * cannot attribute them on its own.
 */
export interface BruteForceDraft {
  kind: "brute_force"
  email: string
  ip: string | null
  userAgent: string | null
}

export interface ListLoginAlertsOptions {
  /** Only return unread alerts. */
  unreadOnly?: boolean
  /** Max alerts to return (newest first). Default 100, hard cap 500. */
  limit?: number
}

const DEFAULT_ALERT_LIMIT = 100
const MAX_ALERT_LIMIT = 500
const MAX_ALERTS_PER_USER = 200

/** Successful sign-ins within this window count toward the velocity check. */
export const VELOCITY_WINDOW_MS = 10 * 60 * 1000
/** Sign-ins at or above this count inside the window raise `velocity`. */
export const VELOCITY_THRESHOLD = 5

/** Failed sign-ins within this window count toward the brute-force check. */
export const FAILURE_WINDOW_MS = 10 * 60 * 1000
/** Failures at or above this count inside the window raise `brute_force`. */
export const FAILURE_THRESHOLD = 8

/** Re-alert cooldown per user+kind so a noisy client cannot spam the feed. */
const ALERT_COOLDOWN_MS = 15 * 60 * 1000

/**
 * Bounds for the per-email failure maps. Once the tracked-email count passes
 * {@link FAILURE_PRUNE_THRESHOLD} stale entries are swept; at
 * {@link MAX_FAILURE_ENTRIES} the oldest entries are evicted so a spray of
 * unique emails cannot grow memory without bound (same opportunistic-prune
 * pattern as `createRateLimiter` in site-forms).
 */
export const FAILURE_PRUNE_THRESHOLD = 500
export const MAX_FAILURE_ENTRIES = 1000

/** Cap stored fingerprints so a user cycling IPs cannot grow memory unbounded. */
const MAX_FINGERPRINTS_PER_USER = 100

const MAX_UA_LENGTH = 200

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function pruneTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  // Timestamps are appended in order; drop everything older than the window.
  let start = 0
  while (start < timestamps.length && timestamps[start] <= cutoff) start += 1
  return start === 0 ? timestamps : timestamps.slice(start)
}

type UserAlertState = {
  alerts: LoginAlert[]
  /** userAgent string -> last seen (ms). */
  devices: Map<string, number>
  /** ip string -> last seen (ms). */
  ips: Map<string, number>
  /** Successful sign-in timestamps inside the velocity window. */
  signIns: number[]
  /** Per-kind timestamp of the most recent alert (re-alert cooldown). */
  lastAlertAt: Partial<Record<LoginAlertKind, number>>
  preferences: LoginAlertPreferences
}

function newUserState(): UserAlertState {
  return {
    alerts: [],
    devices: new Map(),
    ips: new Map(),
    signIns: [],
    lastAlertAt: {},
    preferences: { ...DEFAULT_LOGIN_ALERT_PREFERENCES },
  }
}

function rememberFingerprint(map: Map<string, number>, key: string, now: number): boolean {
  // Returns true when the fingerprint was already known.
  const known = map.has(key)
  map.set(key, now)
  // Refresh insertion order so the oldest entry is evicted first.
  map.delete(key)
  map.set(key, now)
  while (map.size > MAX_FINGERPRINTS_PER_USER) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
  return known
}

const KIND_COPY: Record<
  LoginAlertKind,
  { severity: LoginAlertSeverity; title: string; detail: (input: SignInFingerprint) => string }
> = {
  new_device: {
    severity: "warning",
    title: "Sign-in from a new device",
    detail: (input) =>
      `A sign-in used a browser or device we have not seen on this account before${input.userAgent ? ` (${truncate(input.userAgent, 80)})` : ""}. If this was not you, change your password and revoke sessions.`,
  },
  new_ip: {
    severity: "info",
    title: "Sign-in from a new location",
    detail: (input) =>
      `A sign-in came from an IP address we have not seen on this account before${input.ip ? ` (${input.ip})` : ""}. If you are traveling or on a new network this is expected; otherwise review your sessions.`,
  },
  velocity: {
    severity: "warning",
    title: "Unusual sign-in activity",
    detail: () =>
      "Many successful sign-ins happened in a short period. This can indicate credential stuffing or a replayed session. If you did not sign in repeatedly, secure your account.",
  },
  brute_force: {
    severity: "critical",
    title: "Repeated failed sign-in attempts",
    detail: (input) =>
      `We saw many failed sign-in attempts against this account${input.ip ? ` from ${input.ip}` : ""}. If this was not you, consider enabling two-factor authentication.`,
  },
}

export interface LoginAlertStore {
  /**
   * Records a successful sign-in and returns any alerts it triggered
   * (new device, new IP, velocity). The first-ever sign-in only registers
   * fingerprints and returns an empty list.
   */
  recordSuccessfulSignIn(input: SignInFingerprint & { now?: number }): LoginAlert[]
  /**
   * Records a failed sign-in attempt. Returns a {@link BruteForceDraft} when
   * the per-email failure window crosses the threshold (at most once per
   * cooldown), otherwise null. The caller resolves the user and calls
   * {@link createAlert}.
   */
  recordSignInFailure(input: {
    email: string
    ip: string | null
    userAgent: string | null
    now?: number
  }): BruteForceDraft | null
  /** Persists an alert for a user (used for brute-force drafts). */
  createAlert(input: {
    userId: string
    kind: LoginAlertKind
    ip?: string | null
    userAgent?: string | null
    now?: number
  }): LoginAlert | null
  /** Newest-first alert list for a user. */
  listAlerts(userId: string, options?: ListLoginAlertsOptions): LoginAlert[]
  /** Marks the given alert ids read; returns how many were updated. */
  markAlertsRead(userId: string, ids: string[]): number
  /** Marks every alert for the user read; returns how many were updated. */
  markAllAlertsRead(userId: string): number
  unreadCount(userId: string): number
  getPreferences(userId: string): LoginAlertPreferences
  setPreferences(userId: string, preferences: Partial<LoginAlertPreferences>): LoginAlertPreferences
}

/**
 * Bounded in-memory alert store. Per-user state is evicted once a user
 * accumulates {@link MAX_ALERTS_PER_USER} alerts by dropping the oldest
 * alerts first; fingerprints are capped per user as well.
 */
export class MemoryLoginAlertStore implements LoginAlertStore {
  private users = new Map<string, UserAlertState>()
  /** email -> failed sign-in timestamps inside the failure window. */
  private failures = new Map<string, number[]>()
  /** email -> last time a brute-force draft was emitted (cooldown). */
  private lastBruteForceDraftAt = new Map<string, number>()

  private stateFor(userId: string): UserAlertState {
    let state = this.users.get(userId)
    if (!state) {
      state = newUserState()
      this.users.set(userId, state)
    }
    return state
  }

  private pushAlert(state: UserAlertState, alert: LoginAlert): void {
    state.alerts.push(alert)
    if (state.alerts.length > MAX_ALERTS_PER_USER) {
      state.alerts.splice(0, state.alerts.length - MAX_ALERTS_PER_USER)
    }
  }

  private maybeAlert(
    state: UserAlertState,
    kind: LoginAlertKind,
    input: SignInFingerprint,
    now: number,
  ): LoginAlert | null {
    const last = state.lastAlertAt[kind]
    if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return null
    const copy = KIND_COPY[kind]
    const alert: LoginAlert = {
      id: `la_${randomUUID()}`,
      userId: input.userId,
      kind,
      severity: copy.severity,
      title: copy.title,
      detail: copy.detail(input),
      ip: input.ip,
      userAgent: truncate(input.userAgent, MAX_UA_LENGTH),
      createdAt: new Date(now).toISOString(),
      read: false,
    }
    state.lastAlertAt[kind] = now
    this.pushAlert(state, alert)
    return alert
  }

  recordSuccessfulSignIn(input: SignInFingerprint & { now?: number }): LoginAlert[] {
    const now = input.now ?? Date.now()
    const state = this.stateFor(input.userId)
    const fingerprint: SignInFingerprint = {
      userId: input.userId,
      email: input.email,
      ip: input.ip,
      userAgent: input.userAgent,
    }

    const alerts: LoginAlert[] = []

    // First sign-in only registers fingerprints — there is nothing to compare.
    const isFirstSignIn = state.devices.size === 0 && state.ips.size === 0

    const knownDevice = input.userAgent
      ? rememberFingerprint(state.devices, input.userAgent, now)
      : true
    const knownIp = input.ip ? rememberFingerprint(state.ips, input.ip, now) : true

    state.signIns = pruneTimestamps(state.signIns, VELOCITY_WINDOW_MS, now)
    state.signIns.push(now)

    if (!isFirstSignIn) {
      if (!knownDevice) {
        const alert = this.maybeAlert(state, "new_device", fingerprint, now)
        if (alert) alerts.push(alert)
      }
      if (!knownIp) {
        const alert = this.maybeAlert(state, "new_ip", fingerprint, now)
        if (alert) alerts.push(alert)
      }
      if (state.signIns.length >= VELOCITY_THRESHOLD) {
        const alert = this.maybeAlert(state, "velocity", fingerprint, now)
        if (alert) alerts.push(alert)
      }
    }

    return alerts
  }

  /**
   * Drops failure state that can no longer produce an alert: windows whose
   * timestamps all expired and draft timestamps past window+cooldown. Called
   * opportunistically once the tracked-email count passes the prune
   * threshold.
   */
  private pruneFailureState(now: number): void {
    for (const [key, timestamps] of this.failures) {
      if (pruneTimestamps(timestamps, FAILURE_WINDOW_MS, now).length === 0) {
        this.failures.delete(key)
      }
    }
    const draftExpiry = FAILURE_WINDOW_MS + ALERT_COOLDOWN_MS
    for (const [key, at] of this.lastBruteForceDraftAt) {
      if (now - at > draftExpiry) this.lastBruteForceDraftAt.delete(key)
    }
  }

  /** Evicts oldest failure entries until the map is under the hard cap. */
  private evictOldestFailures(): void {
    while (this.failures.size >= MAX_FAILURE_ENTRIES) {
      const oldest = this.failures.keys().next()
      if (oldest.done) return
      this.failures.delete(oldest.value)
      this.lastBruteForceDraftAt.delete(oldest.value)
    }
  }

  recordSignInFailure(input: {
    email: string
    ip: string | null
    userAgent: string | null
    now?: number
  }): BruteForceDraft | null {
    const now = input.now ?? Date.now()
    const email = input.email.trim().toLowerCase()
    if (!email) return null

    if (!this.failures.has(email)) {
      if (this.failures.size >= FAILURE_PRUNE_THRESHOLD) this.pruneFailureState(now)
      this.evictOldestFailures()
    }

    const timestamps = pruneTimestamps(this.failures.get(email) ?? [], FAILURE_WINDOW_MS, now)
    timestamps.push(now)
    // Re-insert so the entry moves to the newest position for LRU eviction.
    this.failures.delete(email)
    this.failures.set(email, timestamps)

    if (timestamps.length < FAILURE_THRESHOLD) return null

    const lastDraft = this.lastBruteForceDraftAt.get(email)
    if (lastDraft !== undefined && now - lastDraft < ALERT_COOLDOWN_MS) return null
    this.lastBruteForceDraftAt.set(email, now)
    // Reset the window so sustained attacks re-alert on the next threshold
    // crossing instead of every subsequent failure.
    this.failures.set(email, [])

    return { kind: "brute_force", email, ip: input.ip, userAgent: input.userAgent }
  }

  createAlert(input: {
    userId: string
    kind: LoginAlertKind
    ip?: string | null
    userAgent?: string | null
    now?: number
  }): LoginAlert | null {
    const now = input.now ?? Date.now()
    const state = this.stateFor(input.userId)
    return this.maybeAlert(
      state,
      input.kind,
      {
        userId: input.userId,
        email: "",
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      now,
    )
  }

  listAlerts(userId: string, options: ListLoginAlertsOptions = {}): LoginAlert[] {
    const state = this.users.get(userId)
    if (!state) return []
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_ALERT_LIMIT, 1), MAX_ALERT_LIMIT)
    const matched: LoginAlert[] = []
    for (let i = state.alerts.length - 1; i >= 0 && matched.length < limit; i -= 1) {
      const alert = state.alerts[i]
      if (options.unreadOnly && alert.read) continue
      matched.push(alert)
    }
    return matched
  }

  markAlertsRead(userId: string, ids: string[]): number {
    const state = this.users.get(userId)
    if (!state || ids.length === 0) return 0
    const wanted = new Set(ids)
    let updated = 0
    for (const alert of state.alerts) {
      if (!alert.read && wanted.has(alert.id)) {
        alert.read = true
        updated += 1
      }
    }
    return updated
  }

  markAllAlertsRead(userId: string): number {
    const state = this.users.get(userId)
    if (!state) return 0
    let updated = 0
    for (const alert of state.alerts) {
      if (!alert.read) {
        alert.read = true
        updated += 1
      }
    }
    return updated
  }

  unreadCount(userId: string): number {
    const state = this.users.get(userId)
    if (!state) return 0
    return state.alerts.reduce((count, alert) => count + (alert.read ? 0 : 1), 0)
  }

  getPreferences(userId: string): LoginAlertPreferences {
    return { ...this.stateFor(userId).preferences }
  }

  setPreferences(
    userId: string,
    preferences: Partial<LoginAlertPreferences>,
  ): LoginAlertPreferences {
    const state = this.stateFor(userId)
    state.preferences = {
      inAppNotifications: preferences.inAppNotifications ?? state.preferences.inAppNotifications,
      emailNotifications: preferences.emailNotifications ?? state.preferences.emailNotifications,
    }
    return { ...state.preferences }
  }
}

let alertStore: LoginAlertStore = new MemoryLoginAlertStore()

/** Single seam for the alert store (swap for a durable backend in prod). */
export function getLoginAlertStore(): LoginAlertStore {
  return alertStore
}

/** Test hook: replaces the alert store. */
export function setLoginAlertStoreForTests(next: LoginAlertStore | undefined): void {
  alertStore = next ?? new MemoryLoginAlertStore()
}

const SEVERITY_TO_NOTIFICATION_TYPE: Record<LoginAlertSeverity, "info" | "warning" | "error"> = {
  info: "info",
  warning: "warning",
  critical: "error",
}

/**
 * Fans freshly created login alerts out to the user's realtime notification
 * channel (`user:<id>` — the same principal key the notifications hub and
 * `/api/notifications` route use). Honors the user's in-app preference;
 * failures here must never break the sign-in response, so everything is
 * wrapped.
 */
function notifyLoginAlerts(userId: string, alerts: LoginAlert[]): void {
  try {
    if (alerts.length === 0) return
    if (!getLoginAlertStore().getPreferences(userId).inAppNotifications) return
    for (const alert of alerts) {
      publishNotificationEvent(`user:${userId}`, {
        type: "notification",
        notification: {
          type: SEVERITY_TO_NOTIFICATION_TYPE[alert.severity],
          title: alert.title,
          body: alert.detail,
          id: alert.id,
          href: "/app/security",
          createdAt: alert.createdAt,
          category: "security",
        },
      })
    }
  } catch {
    // Alerting is best-effort; sign-in must not fail because of it.
  }
}

/**
 * Shared post-sign-in hook for every session-creation route (password,
 * TOTP verify, OAuth callback, magic link, signup). Runs the suspicious-login
 * heuristics, publishes any created alerts to the notification hub, and
 * returns them so callers can annotate audit metadata. Never throws.
 */
export function evaluateSuccessfulSignIn(input: SignInFingerprint): LoginAlert[] {
  try {
    const alerts = getLoginAlertStore().recordSuccessfulSignIn(input)
    notifyLoginAlerts(input.userId, alerts)
    return alerts
  } catch {
    return []
  }
}

/**
 * Shared failure hook for credential-guessing endpoints. When the per-email
 * brute-force window crosses the threshold the draft is attributed to the
 * account behind the attempted email (if it exists) and turned into an alert.
 * `backend` only needs `getUserByEmail`. Never throws.
 */
export async function evaluateFailedSignIn(
  backend: Pick<AuthBackend, "getUserByEmail">,
  input: { email: string; ip: string | null; userAgent: string | null },
): Promise<LoginAlert | null> {
  try {
    const store = getLoginAlertStore()
    const draft: BruteForceDraft | null = store.recordSignInFailure(input)
    if (!draft) return null
    const user = await backend.getUserByEmail(draft.email)
    if (!user) return null
    const alert = store.createAlert({
      userId: user.id,
      kind: draft.kind,
      ip: draft.ip,
      userAgent: draft.userAgent,
    })
    if (alert) notifyLoginAlerts(user.id, [alert])
    return alert
  } catch {
    return null
  }
}
