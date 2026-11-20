"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { MailCheck } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { AuthApiError } from "@/lib/auth/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { notifyResendCooldown, useResendCooldown } from "./use-resend-cooldown"

type EmailLinkFormProps = {
  idPrefix: string
  submitLabel: string
  sentTitle?: string
  sentTitleLevel?: 2 | 3
  sentMessage: (email: string) => ReactNode
  /**
   * Real request hook: called with the trimmed email on submit and resend.
   * When provided, the "sent" state only renders after it resolves; errors
   * surface inline. When omitted the form keeps its previous demo behaviour.
   */
  onRequest?: (email: string) => Promise<void> | void
  onSentChange?: (sent: boolean) => void
  onBack?: () => void
  backHref?: string
  backLabel?: string
  initialEmail?: string
  autoFocusEmail?: boolean
  /**
   * sessionStorage scope for the resend cooldown. Each flow should pass a
   * distinct key so cooldowns never leak between unrelated forms; omitted
   * falls back to the shared default key inside the hook.
   */
  cooldownKey?: string
  footer?: ReactNode
}

/** Email capture → "check your inbox" confirmation with a resend cooldown. */
export function EmailLinkForm({
  idPrefix,
  submitLabel,
  sentTitle,
  sentTitleLevel = 2,
  sentMessage,
  onRequest,
  onSentChange,
  onBack,
  backHref,
  backLabel,
  initialEmail = "",
  autoFocusEmail = false,
  cooldownKey,
  footer,
}: EmailLinkFormProps) {
  const { t } = useLanguage()
  const resolvedBackLabel = backLabel ?? t("auth.backToSignIn")
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [resendNotice, setResendNotice] = useState("")
  const [requestError, setRequestError] = useState("")
  const [requesting, setRequesting] = useState(false)
  const { remaining, start, reset } = useResendCooldown({ storageKey: cooldownKey })
  const statusRef = useRef<HTMLDivElement>(null)
  const SentTitle = sentTitleLevel === 3 ? "h3" : "h2"

  useEffect(() => {
    if (sent) statusRef.current?.focus()
  }, [sent])

  async function requestLink(target: string) {
    setRequestError("")
    if (!onRequest) return true
    setRequesting(true)
    try {
      await onRequest(target)
      return true
    } catch (error) {
      // A server 429 carries `retryAfter`; push it into this form's cooldown
      // scope so the button reflects the real wait instead of the local
      // default (and cannot undercut the server window).
      if (error instanceof AuthApiError && error.status === 429 && cooldownKey) {
        const retryAfter = error.data?.retryAfter
        if (typeof retryAfter === "number" && retryAfter > 0) {
          notifyResendCooldown(retryAfter, cooldownKey)
        }
      }
      setRequestError(error instanceof Error ? error.message : t("auth.error.generic"))
      return false
    } finally {
      setRequesting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Enforcement must not rely on the disabled attribute alone: a cooldown
    // pushed in after render (e.g. server retryAfter) also blocks here.
    if (remaining > 0 || requesting) return
    const target = email.trim()
    if (!(await requestLink(target))) return
    setResendNotice("")
    setSent(true)
    start()
    onSentChange?.(true)
  }

  async function handleResend() {
    if (remaining > 0 || requesting) return
    const target = email.trim()
    if (!(await requestLink(target))) return
    start()
    setResendNotice(t("auth.emailLink.resendSent", { email }))
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
            disabled={remaining > 0 || requesting}
            aria-busy={requesting}
          >
            {requesting ? (
              <>
                <span className="auth-spinner" aria-hidden="true" /> {t("auth.emailLink.sending")}
              </>
            ) : remaining > 0 ? (
              t("auth.emailLink.resendIn", { seconds: remaining })
            ) : (
              t("auth.emailLink.resend")
            )}
          </Button>
        </div>
        {resendNotice ? <p className="auth-hint">{resendNotice}</p> : null}
        {requestError ? (
          <p className="auth-form-alert" role="alert">
            {requestError}
          </p>
        ) : null}
        <div className="auth-links">
          <button type="button" className="auth-link-button" onClick={handleDifferentEmail}>
            {t("auth.emailLink.differentEmail")}
          </button>
          {onBack ? (
            <button type="button" className="auth-link-button" onClick={onBack}>
              {resolvedBackLabel}
            </button>
          ) : backHref ? (
            <a className="auth-link-button" href={backHref}>
              {resolvedBackLabel}
            </a>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="ui-field">
        <Label htmlFor={`${idPrefix}-email`}>{t("auth.workEmail")}</Label>
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

      {requestError ? (
        <p className="auth-form-alert" role="alert">
          {requestError}
        </p>
      ) : null}

      {/* A failed request can leave an active cooldown (e.g. a server 429);
          the submit stays disabled until it elapses, same as resend. */}
      <Button
        type="submit"
        className="ui-btn-primary auth-submit"
        disabled={requesting || remaining > 0}
        aria-busy={requesting}
      >
        {requesting ? (
          <>
            <span className="auth-spinner" aria-hidden="true" /> {t("auth.emailLink.sending")}
          </>
        ) : remaining > 0 ? (
          t("auth.emailLink.resendIn", { seconds: remaining })
        ) : (
          submitLabel
        )}
      </Button>

      {onBack || backHref ? (
        <div className="auth-links">
          {onBack ? (
            <button type="button" className="auth-link-button" onClick={onBack}>
              {resolvedBackLabel}
            </button>
          ) : (
            <a className="auth-link-button" href={backHref}>
              {resolvedBackLabel}
            </a>
          )}
        </div>
      ) : null}

      {footer}
    </form>
  )
}
