"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import type { Locale } from "@/lib/i18n/locale"
import {
  AuthApiError,
  requestPasswordlessLink,
  verifyPasswordlessLink,
} from "@/lib/auth/auth-client"
import {
  DEFAULT_MAGIC_LINK_TTL_MINUTES,
  formatMagicLinkExpiry,
  sanitizeMagicLinkNextPath,
} from "@/lib/auth/magic-link-config"
import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"
import { Button } from "@/components/ui/button"

import { EmailLinkForm } from "./email-link-form"

/** sessionStorage scope keeping the magic-link resend cooldown separate from other auth flows. */
const MAGIC_LINK_COOLDOWN_KEY = "spindle:auth:resend-cooldown:magic-link"

type Phase = "verifying" | "signed-in" | "invalid" | "missing" | "expired" | "used"

/**
 * Locale-aware "15 minutes"-style duration for the `{expiry}` interpolation
 * param. English uses the shared {@link formatMagicLinkExpiry} phrase
 * ("1 minute" / "15 minutes"); Ukrainian abbreviates to "хв" which has no
 * plural forms. Both render the same rounded value.
 */
function expiryLabel(minutes: number, locale: Locale): string {
  if (locale === "uk") {
    const rounded = Math.round(minutes * 10) / 10
    return `${rounded} хв`
  }
  return formatMagicLinkExpiry(minutes)
}

type MagicLinkScreenProps = {
  /**
   * Configured magic-link lifetime in minutes (from
   * `MAGIC_LINK_TTL_MINUTES`, resolved server-side in page.tsx). Used for
   * the "expires in N minutes" hint and the expired-state copy.
   */
  expiresInMinutes?: number
}

/** `/magic-link?token=…` — consumes a passwordless sign-in token. */
export function MagicLinkScreen({
  expiresInMinutes = DEFAULT_MAGIC_LINK_TTL_MINUTES,
}: MagicLinkScreenProps = {}) {
  const { t, locale } = useLanguage()
  const expiry = expiryLabel(expiresInMinutes, locale)
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  // Sanitized in-app path carried by the emailed link; anything unsafe falls
  // back to the dashboard (see sanitizeMagicLinkNextPath for the edge cases
  // the plain "/" prefix check misses).
  const safeNext = sanitizeMagicLinkNextPath(searchParams.get("next"))
  const redirectTarget = safeNext ?? APP_DASHBOARD_PATH
  const [phase, setPhase] = useState<Phase>(token ? "verifying" : "missing")
  const [message, setMessage] = useState("")
  const ranRef = useRef(false)

  useEffect(() => {
    if (!token || ranRef.current) return
    ranRef.current = true
    verifyPasswordlessLink(token)
      .then(() => {
        setPhase("signed-in")
        // Honor the sanitized `next` return path; full navigation so
        // server-rendered pages see fresh cookies.
        window.setTimeout(() => window.location.assign(redirectTarget), 1200)
      })
      .catch((error: unknown) => {
        if (error instanceof AuthApiError && error.code === "invalid_token") {
          // The verify route reports `reason` ("expired" | "used" |
          // "invalid") so we can offer a targeted resend flow.
          const reason = error.data?.reason
          setPhase(reason === "expired" ? "expired" : reason === "used" ? "used" : "invalid")
          if (reason !== "expired" && reason !== "used") {
            setMessage(error.message)
          }
          return
        }
        setMessage(error instanceof AuthApiError ? error.message : t("auth.error.generic"))
        setPhase("invalid")
      })
  }, [token, redirectTarget, t])

  if (phase === "verifying") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <span className="auth-spinner auth-spinner--lg" />
        </span>
        <h1 className="auth-title">{t("auth.magicLink.verifyingTitle")}</h1>
        <p className="auth-desc">{t("auth.magicLink.verifyingDescription")}</p>
        <p className="auth-hint">{t("auth.magicLink.expiresHint", { expiry })}</p>
      </div>
    )
  }

  if (phase === "signed-in") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <h1 className="auth-title">{t("auth.signedInTitle")}</h1>
        <p className="auth-desc">{t("auth.magicLink.signedInDescription")}</p>
        {/* Escape hatch in case the delayed auto-redirect is blocked or the
            user wants to move on immediately. */}
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href={redirectTarget}>{t("auth.magicLink.continueNow")}</a>
          </Button>
        </div>
      </div>
    )
  }

  // Every failure state that a fresh link can fix — expired, already used,
  // invalid, or a link that arrived without a token — offers the same resend
  // form, preserving the sanitized `next` target.
  const resendForm = (
    <EmailLinkForm
      idPrefix="magic-link-resend"
      cooldownKey={MAGIC_LINK_COOLDOWN_KEY}
      submitLabel={t("auth.magicLink.resendLabel")}
      sentMessage={(email) => t("auth.magicLink.resendSent", { email })}
      onRequest={(email) =>
        requestPasswordlessLink({
          email,
          purpose: "signin",
          next: safeNext ?? undefined,
        })
      }
      autoFocusEmail
      backHref="/"
      backLabel={t("auth.backToSpindle")}
    />
  )

  if (phase === "expired" || phase === "used") {
    return (
      <>
        <span className="auth-badge">
          <Clock3 aria-hidden="true" />
          {phase === "used" ? t("auth.link.used.label") : t("auth.link.expired.label")}
        </span>
        <h1 className="auth-title">
          {phase === "used" ? t("auth.magicLink.usedTitle") : t("auth.magicLink.expiredTitle")}
        </h1>
        <p className="auth-desc">
          {phase === "used"
            ? t("auth.magicLink.usedDescription")
            : t("auth.magicLink.expiredDescription", { expiry })}
        </p>
        {resendForm}
      </>
    )
  }

  if (phase === "missing") {
    return (
      <>
        <h1 className="auth-title">{t("auth.linkIncompleteTitle")}</h1>
        <p className="auth-desc">{t("auth.magicLink.missingDescription")}</p>
        {resendForm}
      </>
    )
  }

  return (
    <>
      <span className="auth-badge auth-badge--warn">
        <AlertTriangle aria-hidden="true" />
        {t("auth.link.invalid.label")}
      </span>
      <h1 className="auth-title">{t("auth.magicLink.invalidTitle")}</h1>
      <p className="auth-desc">{t("auth.magicLink.invalidDescription")}</p>
      {message ? (
        <p className="auth-form-alert" role="alert">
          {message}
        </p>
      ) : null}
      {resendForm}
    </>
  )
}
