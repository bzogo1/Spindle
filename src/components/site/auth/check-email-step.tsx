"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"

import { useResendCooldown } from "@/components/auth/use-resend-cooldown"

type CheckEmailStepProps = {
  title: string
  /** Rendered as the body copy; receives the recipient email. */
  message: (email: string) => ReactNode
  email: string
  /** Resends the email; omit to hide the resend button. */
  onResend?: () => Promise<void> | void
  onBack: () => void
  backLabel?: string
}

/** "Check your email" success screen shared by sign-up and password reset. */
export function CheckEmailStep({
  title,
  message,
  email,
  onResend,
  onBack,
  backLabel = "Back to sign in",
}: CheckEmailStepProps) {
  const statusRef = useRef<HTMLDivElement>(null)
  const { remaining, start } = useResendCooldown()
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    statusRef.current?.focus()
  }, [])

  async function handleResend() {
    if (!onResend || remaining > 0 || resending) return
    setResending(true)
    try {
      await onResend()
      start()
      setResent(true)
    } finally {
      setResending(false)
    }
  }

  return (
    <div ref={statusRef} className="auth-state" role="status" aria-live="polite" tabIndex={-1}>
      <span className="auth-state-icon" aria-hidden="true">
        <MailCheck />
      </span>
      <h3 className="auth-state-title">{title}</h3>
      <p className="auth-state-text">{message(email)}</p>
      <div className="auth-actions">
        {onResend ? (
          <Button
            type="button"
            variant="outline"
            className="auth-secondary-btn"
            onClick={handleResend}
            disabled={remaining > 0 || resending}
            aria-busy={resending}
          >
            {resending ? (
              <>
                <span className="auth-spinner" aria-hidden="true" /> Sending…
              </>
            ) : remaining > 0 ? (
              `Resend in ${remaining}s`
            ) : (
              "Resend email"
            )}
          </Button>
        ) : null}
      </div>
      {resent ? <p className="auth-hint">A new email is on its way to {email}.</p> : null}
      <div className="auth-links">
        <button type="button" className="auth-link-button" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </div>
  )
}
