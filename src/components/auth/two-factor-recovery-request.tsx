"use client"

import { useState } from "react"
import { LifeBuoy, MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError, request } from "@/lib/api/client"

/**
 * "Lost your authenticator?" panel for the account security (2FA) section.
 *
 * POSTs `/api/auth/2fa/recovery/request`, which emails a single-use recovery
 * link. Confirming the link starts a 72-hour cooldown during which 2FA stays
 * on and the recovery can still be cancelled — the panel points at the
 * status view for that.
 */

type RequestState = "idle" | "sending" | "sent" | "throttled"

export type RecoveryRequestResponse = {
  state?: string
  emailSent?: boolean
  /** True when the API accepted the request but the email failed to send. */
  sendFailed?: boolean
  retryAfterSeconds?: number
}

export function TwoFactorRecoveryRequest({ onRequested }: { onRequested?: () => void }) {
  const [state, setState] = useState<RequestState>("idle")
  const [error, setError] = useState("")
  const [retryAfter, setRetryAfter] = useState(0)

  async function send() {
    setState("sending")
    setError("")
    try {
      const data = await request<RecoveryRequestResponse>("", "/api/auth/2fa/recovery/request", {
        method: "POST",
        body: {},
      })
      if (data.sendFailed) {
        // Distinct from a throttle: nothing was emailed, so offer a retry
        // rather than a "check your inbox" or "wait" message. The pending
        // recovery still exists, so let the parent refresh status.
        onRequested?.()
        setState("idle")
        setError("The recovery email couldn't be sent. Please try again.")
        return
      }
      if (data.emailSent === false && data.retryAfterSeconds) {
        setRetryAfter(data.retryAfterSeconds)
        setState("throttled")
      } else {
        setState("sent")
      }
      onRequested?.()
    } catch (err) {
      setState("idle")
      setError(err instanceof ApiError ? err.message : "Couldn't send the recovery email.")
    }
  }

  if (state === "sent") {
    return (
      <div className="app-field" aria-live="polite">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">
          <MailCheck aria-hidden="true" /> We emailed you a single-use recovery link. Open it to
          start the recovery — two-factor stays on for a 72-hour cooldown before it is disabled, and
          you can cancel at any time.
        </p>
      </div>
    )
  }

  return (
    <div className="app-field">
      <span className="app-field-label">Lost your authenticator?</span>
      <p className="app-field-hint">
        <LifeBuoy aria-hidden="true" /> If you no longer have your authenticator device, we can
        disable two-factor authentication after verifying your email. The disable only happens after
        a 72-hour cooldown so an unauthorized request can be caught and cancelled.
      </p>

      {state === "throttled" ? (
        <p className="app-field-hint" role="status">
          A recovery email was already sent — check your inbox, or try again in {retryAfter}{" "}
          seconds.
        </p>
      ) : null}
      {error ? (
        <p className="app-field-hint" role="alert">
          {error}
        </p>
      ) : null}

      <div className="app-form-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => void send()}
          disabled={state === "sending"}
        >
          {state === "sending" ? "Sending…" : "Email me a recovery link"}
        </Button>
      </div>
    </div>
  )
}
