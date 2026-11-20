"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { AuthApiError } from "@/lib/auth/auth-client"
import {
  getTokenState,
  requestAccountRecovery,
  verifyRecoveryToken,
  type RecoverySession,
  type TokenState,
} from "@/lib/auth-recovery"

import { EmailLinkForm } from "./email-link-form"
import { AccountRecoverySteps } from "./account-recovery-steps"

/** sessionStorage scope keeping the recovery cooldown separate from other auth flows. */
const ACCOUNT_RECOVERY_COOLDOWN_KEY = "spindle:auth:resend-cooldown:account-recovery"

type Phase =
  | { name: "request" }
  | { name: "verifying" }
  | { name: "verified"; session: RecoverySession }
  | { name: "link-error"; reason: "expired" | "used" | "invalid" }
  | { name: "done" }

function linkErrorReason(error: unknown, fallback: TokenState): "expired" | "used" | "invalid" {
  if (error instanceof AuthApiError && error.code === "invalid_token") {
    const reason = error.data?.reason
    if (reason === "expired" || reason === "used" || reason === "invalid") return reason
  }
  return fallback === "valid" ? "invalid" : fallback
}

/**
 * `/account-recovery` wizard: request an emailed recovery link, verify the
 * one-time token, then walk the guided secure-your-account steps. The
 * recovery session token lives only in React state — never in the URL,
 * cookies, or web storage.
 */
export function AccountRecoveryScreen() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const tokenState = getTokenState(token)
  const [phase, setPhase] = useState<Phase>(() =>
    token ? { name: "verifying" } : { name: "request" },
  )
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousPhase = useRef<Phase["name"]>(phase.name)

  useEffect(() => {
    if (!token) {
      setPhase({ name: "request" })
      return
    }

    let cancelled = false
    verifyRecoveryToken(token)
      .then((session) => {
        if (!cancelled) setPhase({ name: "verified", session })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof AuthApiError && error.code === "network") {
          // Offline: fall back to the same local token classification the
          // other auth screens use so the state is still explainable.
          setPhase({
            name: "link-error",
            reason: tokenState === "valid" ? "invalid" : tokenState,
          })
          return
        }
        setPhase({ name: "link-error", reason: linkErrorReason(error, tokenState) })
      })

    return () => {
      cancelled = true
    }
  }, [token, tokenState])

  useEffect(() => {
    if (previousPhase.current !== phase.name && phase.name !== "verifying") {
      headingRef.current?.focus()
    }
    previousPhase.current = phase.name
  }, [phase.name])

  function requestNewLink() {
    // Drop the consumed/failed token from the URL so a refresh lands on the
    // request form instead of re-verifying a dead link.
    router.replace("/account-recovery")
    setPhase({ name: "request" })
  }

  if (phase.name === "verifying") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <span className="auth-spinner auth-spinner--lg" />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {t("auth.accountRecovery.verifyingTitle")}
        </h1>
        <p className="auth-desc">{t("auth.accountRecovery.verifyingDescription")}</p>
      </div>
    )
  }

  if (phase.name === "verified") {
    return (
      <AccountRecoverySteps
        session={phase.session}
        onExpired={requestNewLink}
        onDone={() => setPhase({ name: "done" })}
      />
    )
  }

  if (phase.name === "done") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {t("auth.accountRecovery.done.title")}
        </h1>
        <p className="auth-desc">{t("auth.accountRecovery.done.description")}</p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/">{t("auth.signIn")}</a>
          </Button>
        </div>
      </div>
    )
  }

  if (phase.name === "link-error") {
    const reason = phase.reason
    const badge = reason === "invalid" ? "auth-badge auth-badge--warn" : "auth-badge"
    const BadgeIcon = reason === "invalid" ? AlertTriangle : Clock3
    return (
      <>
        <span className={badge}>
          <BadgeIcon aria-hidden="true" />
          {t(`auth.accountRecovery.link.${reason}.label`)}
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {t(`auth.accountRecovery.link.${reason}.title`)}
        </h1>
        <p className="auth-desc">{t(`auth.accountRecovery.link.${reason}.description`)}</p>
        <div className="auth-actions">
          <Button type="button" className="ui-btn-primary auth-submit" onClick={requestNewLink}>
            {t("auth.requestNewLink")}
          </Button>
          <a className="auth-link-button" href="/about#contact">
            {t("auth.contactSupport")}
          </a>
        </div>
      </>
    )
  }

  return (
    <>
      <span className="auth-eyebrow">{t("auth.recoveryEyebrow")}</span>
      <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
        {t("auth.accountRecovery.request.title")}
      </h1>
      <p className="auth-desc">{t("auth.accountRecovery.request.description")}</p>

      <EmailLinkForm
        idPrefix="account-recovery"
        submitLabel={t("auth.accountRecovery.request.submit")}
        sentTitle={t("auth.accountRecovery.request.sentTitle")}
        sentMessage={(email) => t("auth.accountRecovery.request.sentMessage", { email })}
        onRequest={(email) => requestAccountRecovery(email)}
        cooldownKey={ACCOUNT_RECOVERY_COOLDOWN_KEY}
        backHref="/"
        backLabel={t("auth.backToSpindle")}
      />
    </>
  )
}
