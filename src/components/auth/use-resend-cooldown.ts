"use client"

import { useCallback, useEffect, useState } from "react"

import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth-recovery"

/**
 * Counts down a resend cooldown so repeated emails cannot be triggered at
 * once. The deadline is persisted in sessionStorage so the countdown
 * survives remounts within the tab, and `notifyResendCooldown` lets API
 * callers push the server's `retryAfter` value into every mounted hook that
 * shares the same `storageKey` — the effective deadline is always the
 * *later* of the local and server values, so the server acts as a floor the
 * client cannot undercut.
 *
 * Each flow (verify-email, magic-link, password reset, …) should pass its
 * own `storageKey` so cooldowns never leak between unrelated forms; the
 * default key is a shared fallback for callers that do not care.
 */

export const RESEND_COOLDOWN_STORAGE_KEY = "spindle:auth:resend-cooldown"
const RESEND_COOLDOWN_SYNC_EVENT = "spindle:resend-cooldown-sync"

export type ResendCooldownOptions = {
  /** Fallback cooldown used by `start()` when the caller passes no value. */
  seconds?: number
  /** sessionStorage key scoping this cooldown to one flow. */
  storageKey?: string
}

function readStoredExpiry(storageKey: string): number {
  if (typeof window === "undefined") return 0
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return 0
    const expiry = Number(raw)
    return Number.isFinite(expiry) ? expiry : 0
  } catch {
    return 0
  }
}

function writeStoredExpiry(storageKey: string, expiry: number | null) {
  if (typeof window === "undefined") return
  try {
    if (expiry !== null && expiry > Date.now()) {
      window.sessionStorage.setItem(storageKey, String(expiry))
    } else {
      window.sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Storage can be unavailable (private mode); the in-memory countdown still works.
  }
}

function remainingFromStoredExpiry(storageKey: string): number {
  return Math.max(0, Math.ceil((readStoredExpiry(storageKey) - Date.now()) / 1000))
}

/** Deadline for `seconds` from now under `storageKey`, never earlier than stored. */
function expiryFor(storageKey: string, seconds: number): number {
  return Math.max(readStoredExpiry(storageKey), Date.now() + Math.max(0, seconds) * 1000)
}

/**
 * Pushes a server-reported cooldown (e.g. a 429 `retryAfter`, or the
 * `retryAfter` returned on a successful resend) into every mounted
 * `useResendCooldown` hook that uses `storageKey`, and persists it so
 * remounts keep the server's deadline too.
 */
export function notifyResendCooldown(
  seconds: number,
  storageKey: string = RESEND_COOLDOWN_STORAGE_KEY,
) {
  if (typeof window === "undefined" || !(seconds > 0)) return
  writeStoredExpiry(storageKey, expiryFor(storageKey, seconds))
  window.dispatchEvent(new CustomEvent(RESEND_COOLDOWN_SYNC_EVENT, { detail: { storageKey } }))
}

/** Counts down a resend cooldown so repeated emails cannot be triggered at once. */
export function useResendCooldown({
  seconds = RESEND_COOLDOWN_SECONDS,
  storageKey = RESEND_COOLDOWN_STORAGE_KEY,
}: ResendCooldownOptions = {}) {
  const [remaining, setRemaining] = useState(0)

  const applyStoredExpiry = useCallback(() => {
    setRemaining(remainingFromStoredExpiry(storageKey))
  }, [storageKey])

  // Restore any persisted deadline left by a previous mount/send.
  useEffect(() => {
    applyStoredExpiry()
  }, [applyStoredExpiry])

  // Adopt cooldowns pushed in by API responses (server retryAfter). Events
  // carry the storageKey they apply to; keyless events apply everywhere.
  useEffect(() => {
    if (typeof window === "undefined") return
    const handler = (event: Event) => {
      const key = (event as CustomEvent<{ storageKey?: string }>).detail?.storageKey
      if (key === undefined || key === storageKey) applyStoredExpiry()
    }
    window.addEventListener(RESEND_COOLDOWN_SYNC_EVENT, handler)
    return () => window.removeEventListener(RESEND_COOLDOWN_SYNC_EVENT, handler)
  }, [applyStoredExpiry, storageKey])

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setTimeout(() => {
      setRemaining((value) => {
        const next = Math.max(0, value - 1)
        if (next === 0) writeStoredExpiry(storageKey, null)
        return next
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [remaining, storageKey])

  const start = useCallback(
    (value = seconds) => {
      writeStoredExpiry(storageKey, expiryFor(storageKey, value))
      applyStoredExpiry()
    },
    [seconds, storageKey, applyStoredExpiry],
  )
  const reset = useCallback(() => {
    writeStoredExpiry(storageKey, null)
    setRemaining(0)
  }, [storageKey])
  /** Sync the countdown to a server-provided retry delay. */
  const sync = useCallback(
    (value: number) => {
      writeStoredExpiry(storageKey, expiryFor(storageKey, value))
      applyStoredExpiry()
    },
    [storageKey, applyStoredExpiry],
  )

  return { remaining, start, reset, sync, canResend: remaining === 0 }
}
