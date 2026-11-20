"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import {
  acceptSession,
  ensureFreshSession,
  getCurrentSession,
  loadSession,
  onAuthStateChange,
  signOut as apiSignOut,
  type ClientSession,
} from "@/lib/auth/auth-client"
import {
  registerDeviceFingerprintWithServer,
  unregisterDeviceFingerprintWithServer,
} from "@/lib/device/fingerprint-client"

/**
 * React session provider for the real auth flow. Mirrors the shape of
 * `MockSessionProvider` (`user`, `workspace`, `status`, `signIn`, `signOut`)
 * so screens can swap providers without changes — plus `loading` while the
 * first `/api/auth/session` resolution is in flight.
 *
 * Tokens never reach JavaScript: they live in httpOnly cookies and are
 * refreshed by `auth-client` (single-flight, scheduled before expiry, synced
 * across tabs via BroadcastChannel).
 */

export type SessionStatus = "loading" | "authenticated" | "unauthenticated"

/** Total registration attempts per session (initial + retries). */
const FINGERPRINT_MAX_ATTEMPTS = 2
/** Delay before the single fingerprint-registration retry. */
const FINGERPRINT_RETRY_DELAY_MS = 10_000
/** Upper bound for the best-effort fingerprint cleanup during sign-out. */
const FINGERPRINT_UNREGISTER_TIMEOUT_MS = 4_000

type FingerprintAttempt = {
  sessionId: string
  /** False once the owning effect instance cleaned up (session change/unmount). */
  active: boolean
  /** Pending retry timer, if any. */
  timer: ReturnType<typeof setTimeout> | null
}

export type SessionContextValue = {
  user: ClientSession["user"] | null
  workspace: ClientSession["workspace"]
  status: SessionStatus
  session: ClientSession | null
  signIn: (session: ClientSession) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(() => getCurrentSession())
  const [loaded, setLoaded] = useState(() => getCurrentSession() !== null)

  useEffect(() => {
    const unsubscribe = onAuthStateChange((next) => {
      setSession(next)
      setLoaded(true)
    })
    void loadSession()
      .catch(() => setLoaded(true))
      .finally(() => setLoaded(true))
    // Timers are throttled/paused while the laptop sleeps; re-check the
    // session when the tab becomes visible again so an expired access token
    // is refreshed instead of surfacing as a 401 on the next API call.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      void ensureFreshSession().catch(() => {})
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  // Register the device fingerprint once per session id. The POST is
  // best-effort and runs off the render path — fingerprinting must never
  // block or break auth.
  //
  //  - `fingerprintDoneRef` marks a session fully registered (set only on
  //    success) so each session costs at most one registration chain.
  //  - `fingerprintAttemptRef` owns the whole attempt chain (in-flight POST
  //    plus delayed retries) independently of effect lifecycles, so a
  //    StrictMode remount or a redundant session emission can never start a
  //    second concurrent POST for the same session — and cannot kill a
  //    pending retry either.
  //  - Failures get `FINGERPRINT_MAX_ATTEMPTS - 1` delayed retries; after
  //    exhaustion the attempt marker clears and a later session emission
  //    (token refresh, visibility change) tries again.
  const fingerprintDoneRef = useRef<string | null>(null)
  const fingerprintAttemptRef = useRef<FingerprintAttempt | null>(null)
  useEffect(() => {
    const sessionId = session?.sessionId ?? null
    if (!sessionId || fingerprintDoneRef.current === sessionId) return

    // An attempt already owns this session (POST in flight or retry
    // pending): do not start a duplicate. Revive `active` in case a
    // StrictMode cleanup pass deactivated it — harmless otherwise.
    const existing = fingerprintAttemptRef.current
    if (existing?.sessionId === sessionId) {
      existing.active = true
      return
    }

    // The session actually changed: abandon any attempt owned by the old
    // session so it cannot keep retrying (or mark done) in the background.
    if (existing) {
      existing.active = false
      if (existing.timer) clearTimeout(existing.timer)
    }

    const entry: FingerprintAttempt = { sessionId, active: true, timer: null }
    fingerprintAttemptRef.current = entry

    const run = (retriesLeft: number) => {
      void registerDeviceFingerprintWithServer().then((registered) => {
        if (registered) {
          fingerprintDoneRef.current = sessionId
          if (fingerprintAttemptRef.current === entry) fingerprintAttemptRef.current = null
          return
        }
        if (retriesLeft > 0 && entry.active) {
          entry.timer = setTimeout(() => run(retriesLeft - 1), FINGERPRINT_RETRY_DELAY_MS)
          return
        }
        // Retries exhausted (or attempt abandoned): clear the marker so a
        // later session emission can register again.
        if (fingerprintAttemptRef.current === entry) fingerprintAttemptRef.current = null
      })
    }
    run(FINGERPRINT_MAX_ATTEMPTS - 1)
    // No cleanup here: the attempt chain deliberately outlives this effect
    // (see the unmount-only effect below and the guards inside `run`).
  }, [session])

  // Real unmount only: deactivate the attempt and cancel any pending retry.
  // The in-flight POST is left to settle — its result only writes refs.
  useEffect(
    () => () => {
      const entry = fingerprintAttemptRef.current
      if (!entry) return
      entry.active = false
      if (entry.timer) clearTimeout(entry.timer)
    },
    [],
  )

  const signIn = useCallback((next: ClientSession) => {
    acceptSession(next)
  }, [])

  const signOut = useCallback(async () => {
    // Drop this session's fingerprint record while the access cookie is
    // still valid — best-effort, and bounded so a stalled request can never
    // block sign-out (the DELETE continues in the background regardless).
    await Promise.race([
      unregisterDeviceFingerprintWithServer(),
      new Promise((resolve) => setTimeout(resolve, FINGERPRINT_UNREGISTER_TIMEOUT_MS)),
    ])
    await apiSignOut()
    // Full navigation so server components re-render signed-out.
    window.location.assign("/")
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({
      user: session?.user ?? null,
      workspace: session?.workspace ?? null,
      session,
      status: !loaded ? "loading" : session ? "authenticated" : "unauthenticated",
      signIn,
      signOut,
    }),
    [session, loaded, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useAuthSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider")
  }
  return context
}
