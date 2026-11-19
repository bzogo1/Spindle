"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { useResendCooldown } from "./use-resend-cooldown"

type EmailLinkFormProps = {
  idPrefix: string
  submitLabel: string
  sentTitle?: string
  sentTitleLevel?: 2 | 3
  sentMessage: (email: string) => ReactNode
  onSentChange?: (sent: boolean) => void
  onBack?: () => void
  backHref?: string
  backLabel?: string
  initialEmail?: string
  autoFocusEmail?: boolean
  footer?: ReactNode
}

/** Email capture → "check your inbox" confirmation with a resend cooldown. */
export function EmailLinkForm({
  idPrefix,
  submitLabel,
  sentTitle,
  sentTitleLevel = 2,
  sentMessage,
  onSentChange,
  onBack,
  backHref,
  backLabel = "Back to sign in",
  initialEmail = "",
  autoFocusEmail = false,
  footer,
}: EmailLinkFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [resendNotice, setResendNotice] = useState("")
  const { remaining, start, reset } = useResendCooldown()
  const statusRef = useRef<HTMLDivElement>(null)
  const SentTitle = sentTitleLevel === 3 ? "h3" : "h2"

  useEffect(() => {
    if (sent) statusRef.current?.focus()
  }, [sent])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResendNotice("")
    setSent(true)
    start()
    onSentChange?.(true)
  }

  function handleResend() {
    start()
    setResendNotice(`A new link is on its way to ${email}.`)
  }

  function handleDifferentEmail() {
    reset()
    setResendNotice("")
    setSent(false)
    onSentChange?.(false)
  }

  if (sent) {
    return (
      <div ref={statusRef} className="auth-state" role="status" aria-live="polite" tabIndex={-1}>
        <span className="auth-state-icon" aria-hidden="true">
          <MailCheck />
        </span>
        {sentTitle ? <SentTitle className="auth-state-title">{sentTitle}</SentTitle> : null}
        <p className="auth-state-text">{sentMessage(email)}</p>
        <div className="auth-actions">
          <Button
            type="button"
            variant="outline"
            className="auth-secondary-btn"
            onClick={handleResend}
            disabled={remaining > 0}
          >
            {remaining > 0 ? `Resend in ${remaining}s` : "Resend email"}
          </Button>
        </div>
        {resendNotice ? <p className="auth-hint">{resendNotice}</p> : null}
        <div className="auth-links">
          <button type="button" className="auth-link-button" onClick={handleDifferentEmail}>
            Use a different email
          </button>
          {onBack ? (
            <button type="button" className="auth-link-button" onClick={onBack}>
              {backLabel}
            </button>
          ) : backHref ? (
            <a className="auth-link-button" href={backHref}>
              {backLabel}
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="ui-field">
        <Label htmlFor={`${idPrefix}-email`}>Work email</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@lab.edu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoFocus={autoFocusEmail}
          required
        />
      </div>

      <Button type="submit" className="ui-btn-primary auth-submit">
        {submitLabel}
      </Button>

      {onBack || backHref ? (
        <div className="auth-links">
          {onBack ? (
            <button type="button" className="auth-link-button" onClick={onBack}>
              {backLabel}
            </button>
          ) : (
            <a className="auth-link-button" href={backHref}>
              {backLabel}
            </a>
          )}
        </div>
      ) : null}

      {footer}
    </form>
  )
}
