"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect, useRef, useState } from "react"

/** Next forwards a server error digest so it can be matched against server logs. */
function digestOf(error: unknown) {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest
    return typeof digest === "string" ? digest : ""
  }

  return ""
}

/**
 * Reports the boundary error to Sentry once per error instance and returns a
 * reference that support can look up. It deliberately never exposes the error
 * message or stack.
 */
export function useErrorReference(error: unknown) {
  const reported = useRef<unknown>(null)
  const [reference, setReference] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (reported.current === error) return
    reported.current = error

    const eventId = Sentry.captureException(error)
    setReference(eventId || digestOf(error))
  }, [error])

  async function copyReference() {
    if (!reference || !navigator.clipboard) return

    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return { reference, copied, copyReference }
}
