import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_LOGIN_ALERT_PREFERENCES,
  FAILURE_THRESHOLD,
  MAX_FAILURE_ENTRIES,
  VELOCITY_THRESHOLD,
  MemoryLoginAlertStore,
  type SignInFingerprint,
} from "./login-alerts"

const BASE: SignInFingerprint = {
  userId: "u1",
  email: "ada@lab.edu",
  ip: "203.0.113.10",
  userAgent: "Mozilla/5.0 (Macintosh) TestBrowser/1.0",
}

let store: MemoryLoginAlertStore

beforeEach(() => {
  store = new MemoryLoginAlertStore()
})

describe("recordSuccessfulSignIn", () => {
  it("registers fingerprints silently on the first sign-in", () => {
    expect(store.recordSuccessfulSignIn(BASE)).toEqual([])
    expect(store.listAlerts("u1")).toEqual([])
  })

  it("alerts on a new user agent", () => {
    store.recordSuccessfulSignIn(BASE)
    const alerts = store.recordSuccessfulSignIn({
      ...BASE,
      userAgent: "Mozilla/5.0 (Windows) OtherBrowser/2.0",
    })
    expect(alerts.map((a) => a.kind)).toContain("new_device")
    expect(alerts[0]).toMatchObject({
      userId: "u1",
      severity: "warning",
      read: false,
    })
    expect(store.listAlerts("u1")).toHaveLength(alerts.length)
  })

  it("alerts on a new IP", () => {
    store.recordSuccessfulSignIn(BASE)
    const alerts = store.recordSuccessfulSignIn({ ...BASE, ip: "198.51.100.7" })
    expect(alerts.map((a) => a.kind)).toContain("new_ip")
    const alert = alerts.find((a) => a.kind === "new_ip")
    expect(alert?.severity).toBe("info")
    expect(alert?.ip).toBe("198.51.100.7")
  })

  it("does not re-alert for a known device and IP", () => {
    store.recordSuccessfulSignIn(BASE)
    // Same fingerprint => no new_device/new_ip at all.
    const second = store.recordSuccessfulSignIn(BASE)
    expect(second.filter((a) => a.kind === "new_device" || a.kind === "new_ip")).toEqual([])
  })

  it("raises velocity after repeated sign-ins in the window", () => {
    const t0 = 1_000_000
    store.recordSuccessfulSignIn({ ...BASE, now: t0 })
    // First sign-in seeded fingerprints; subsequent ones within the window.
    for (let i = 1; i < VELOCITY_THRESHOLD; i += 1) {
      store.recordSuccessfulSignIn({ ...BASE, now: t0 + i * 1000 })
    }
    const alerts = store.listAlerts("u1")
    expect(alerts.some((a) => a.kind === "velocity")).toBe(true)
  })

  it("does not count sign-ins outside the velocity window", () => {
    const t0 = 1_000_000
    store.recordSuccessfulSignIn({ ...BASE, now: t0 })
    for (let i = 1; i < VELOCITY_THRESHOLD; i += 1) {
      store.recordSuccessfulSignIn({ ...BASE, now: t0 + i * 1000 + 11 * 60 * 1000 })
    }
    expect(store.listAlerts("u1").some((a) => a.kind === "velocity")).toBe(false)
  })

  it("honors the per-kind re-alert cooldown", () => {
    const t0 = 2_000_000
    // Seed fingerprints, then cross the velocity threshold twice inside the
    // cooldown window — only one velocity alert should be recorded.
    store.recordSuccessfulSignIn({ ...BASE, now: t0 })
    for (let i = 1; i <= VELOCITY_THRESHOLD + 2; i += 1) {
      store.recordSuccessfulSignIn({ ...BASE, now: t0 + i * 1000 })
    }
    expect(store.listAlerts("u1").filter((a) => a.kind === "velocity")).toHaveLength(1)
  })
})

describe("recordSignInFailure", () => {
  const failure = { email: "ada@lab.edu", ip: "203.0.113.99", userAgent: "bot" }

  it("returns null below the failure threshold", () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      expect(store.recordSignInFailure({ ...failure, now: i })).toBeNull()
    }
  })

  it("returns a brute-force draft at the threshold and resets the window", () => {
    let draft = null
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      draft = store.recordSignInFailure({ ...failure, now: i })
    }
    expect(draft).toMatchObject({ kind: "brute_force", email: "ada@lab.edu" })
    // Window was reset: the next failure alone does not re-trigger.
    expect(store.recordSignInFailure({ ...failure, now: FAILURE_THRESHOLD + 1 })).toBeNull()
  })

  it("evicts the oldest failure windows beyond the entry cap", () => {
    const t0 = 5_000_000
    // One email accumulates nearly a full brute-force window.
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      store.recordSignInFailure({ email: "victim@lab.edu", ip: null, userAgent: null, now: t0 + i })
    }
    // A spray of unique emails pushes the map past the hard cap; the oldest
    // entries (including the victim's partial window) are evicted.
    for (let i = 0; i < MAX_FAILURE_ENTRIES + 5; i += 1) {
      store.recordSignInFailure({
        email: `spray-${i}@example.com`,
        ip: null,
        userAgent: null,
        now: t0 + 100 + i,
      })
    }
    // The victim's window was evicted, so one more failure cannot complete it.
    expect(
      store.recordSignInFailure({
        email: "victim@lab.edu",
        ip: null,
        userAgent: null,
        now: t0 + 200_000,
      }),
    ).toBeNull()
    // But a fresh window still reaches the threshold normally.
    let draft = null
    for (let i = 1; i < FAILURE_THRESHOLD; i += 1) {
      draft = store.recordSignInFailure({
        email: "victim@lab.edu",
        ip: null,
        userAgent: null,
        now: t0 + 200_000 + i,
      })
    }
    expect(draft).toMatchObject({ kind: "brute_force", email: "victim@lab.edu" })
  })

  it("tracks failures per email independently", () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      store.recordSignInFailure({ ...failure, now: i })
    }
    // A different email has its own window.
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      expect(
        store.recordSignInFailure({
          email: "grace@lab.edu",
          ip: null,
          userAgent: null,
          now: i,
        }),
      ).toBeNull()
    }
  })
})

describe("createAlert", () => {
  it("creates an alert for a user and respects the cooldown", () => {
    const alert = store.createAlert({
      userId: "u1",
      kind: "brute_force",
      ip: "203.0.113.1",
      userAgent: "bot",
      now: 5000,
    })
    expect(alert).toMatchObject({
      userId: "u1",
      kind: "brute_force",
      severity: "critical",
      ip: "203.0.113.1",
    })
    expect(store.createAlert({ userId: "u1", kind: "brute_force", now: 6000 })).toBeNull()
    expect(store.listAlerts("u1")).toHaveLength(1)
  })
})

describe("listAlerts / mark read", () => {
  it("lists newest first and filters unread", () => {
    store.createAlert({ userId: "u1", kind: "new_ip", now: 1000 })
    store.createAlert({ userId: "u1", kind: "velocity", now: 2000 })
    expect(store.listAlerts("u1").map((a) => a.kind)).toEqual(["velocity", "new_ip"])
    store.markAlertsRead("u1", [store.listAlerts("u1")[0].id])
    expect(store.listAlerts("u1", { unreadOnly: true }).map((a) => a.kind)).toEqual(["new_ip"])
    expect(store.unreadCount("u1")).toBe(1)
    store.markAllAlertsRead("u1")
    expect(store.unreadCount("u1")).toBe(0)
  })

  it("cannot mark another user's alerts", () => {
    const alert = store.createAlert({ userId: "u1", kind: "new_ip" })
    expect(store.markAlertsRead("u2", [alert!.id])).toBe(0)
    expect(store.listAlerts("u2")).toEqual([])
  })
})

describe("preferences", () => {
  it("defaults to enabled and merges partial updates", () => {
    expect(store.getPreferences("u1")).toEqual(DEFAULT_LOGIN_ALERT_PREFERENCES)
    const prefs = store.setPreferences("u1", { inAppNotifications: false })
    expect(prefs).toEqual({ inAppNotifications: false, emailNotifications: true })
    expect(store.getPreferences("u1")).toEqual(prefs)
  })
})
