"use client"

import { useCallback, useEffect, useState } from "react"

import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth-recovery"

/** Counts down a resend cooldown so repeated emails cannot be triggered at once. */
export function useResendCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [remaining])

  const start = useCallback(() => setRemaining(seconds), [seconds])
  const reset = useCallback(() => setRemaining(0), [])

  return { remaining, start, reset, canResend: remaining === 0 }
}
