"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { getTokenState } from "@/lib/auth-recovery"
import { AuthApiError, verifyEmailToken, type AuthErrorCode } from "@/lib/auth/auth-client"

import { EmailLinkForm } from "./email-link-form"
import { notifyResendCooldown } from "./use-resend-cooldown"

/** sessionStorage scope keeping the verify-email cooldown separate from other auth flows. */
const VERIFY_EMAIL_COOLDOWN_KEY = "spindle:auth:resend-cooldown:verify-email"

type Phase = "verifying" | "verified" | "expired" | "used" | "invalid" | "resend" | "sent"

type ResendResponse = {
  ok?: boolean
  code?: string
  message?: string
  retryAfter?: number
}

/**
 * Requests a fresh verification email through the resend endpoint. On a 429
 * the server's `retryAfter` is pushed into the shared cooldown hook so the
 * resend button reflects the real wait instead of the local default.
 */
async function requestVerificationEmail(email: string): Promise<void> {
  let response: Response
  try {
    response = await fetch("/api/auth/verify-email/resend", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
  } catch {
    throw new AuthApiError("network", "Network error. Check your connection and try again.")
  }

  let payload: ResendResponse
  try {
    payload = (await response.json()) as ResendResponse
  } catch {
    throw new AuthApiError("unknown", "Unexpected response from the server.", response.status)
  }

  if (!response.ok || payload.ok === false) {
    const retryAfter = typeof payload.retryAfter === "number" ? payload.retryAfter : 0
    if (retryAfter > 0) notifyResendCooldown(retryAfter, VERIFY_EMAIL_COOLDOWN_KEY)
    const { ok: _ok, code: _code, message: _message, retryAfter: _retry, ...data } = payload
    throw new AuthApiError(
      (payload.code as AuthErrorCode | undefined) ?? "unknown",
      payload.message ?? "Something went wrong. Please try again.",
      response.status,
      data,
    )
  }

  // Successful resends also carry the server's cooldown window; sync the
  // countdown so the client never undercuts it.
  const cooldown = typeof payload.retryAfter === "number" ? payload.retryAfter : 0
  if (cooldown > 0) notifyResendCooldown(cooldown, VERIFY_EMAIL_COOLDOWN_KEY)
}

/** `/verify-email` states: verifying, verified, expired, invalid, and resend. */
export function VerifyEmailScreen() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const email = searchParams.get("email") ?? ""
  const tokenState = getTokenState(token)
  const [phase, setPhase] = useState<Phase>(() => (token ? "verifying" : "resend"))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousPhase = useRef<Phase>(phase)

  useEffect(() => {
    if (!token) {
      setPhase("resend")
      return
    }

    setPhase("verifying")
    let cancelled = false
    let fallbackTimer: number | null = null

    verifyEmailToken(token)
      .then(() => {
        if (!cancelled) setPhase("verified")
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof AuthApiError && error.code === "invalid_token") {
          const reason = error.data?.reason
          setPhase(reason === "expired" ? "expired" : reason === "used" ? "used" : "invalid")
          return
        }
        // Offline/demo fallback: classify recognisable token prefixes locally.
        fallbackTimer = window.setTimeout(() => {
          if (!cancelled) setPhase(tokenState === "valid" ? "verified" : tokenState)
        }, 600)
      })

    return () => {
      cancelled = true
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
    }
  }, [token, tokenState])

  useEffect(() => {
    if (previousPhase.current !== phase && phase !== "verifying") {
      headingRef.current?.focus()
    }
    previousPhase.current = phase
  }, [phase])

  if (phase === "verifying") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <span className="auth-spinner auth-spinner--lg" />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {t("auth.verify.verifyingTitle")}
        </h1>
        <p className="auth-desc">{t("auth.verify.verifyingDescription")}</p>
      </div>
    )
  }

  if (phase === "verified") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {t("auth.verify.verifiedTitle")}
        </h1>
        <p className="auth-desc">{t("auth.verify.verifiedDescription")}</p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/">{t("auth.verify.continueToSpindle")}</a>
          </Button>
        </div>
      </div>
    )
  }

  const fallbackPhase: Phase = !token ? "resend" : tokenState === "valid" ? "resend" : tokenState

  const content = {
    resend: {
      eyebrowKey: "auth.verify.eyebrow",
      titleKey: "auth.verifyEmail",
      descriptionKey: "auth.verify.description",
      badge: null as null | "warn" | "plain",
    },
    sent: {
      eyebrowKey: "auth.verify.sentEyebrow",
      titleKey: "auth.checkInbox",
      descriptionKey: "auth.verify.sentDescription",
      badge: null as null | "warn" | "plain",
    },
    expired: {
      eyebrowKey: null,
      titleKey: "auth.verify.expiredTitle",
      descriptionKey: "auth.verify.expiredDescription",
      badge: "plain" as const,
    },
    used: {
      eyebrowKey: null,
      titleKey: "auth.verify.usedTitle",
      descriptionKey: "auth.verify.usedDescription",
      badge: "plain" as const,
    },
    invalid: {
      eyebrowKey: null,
      titleKey: "auth.verify.invalidTitle",
      descriptionKey: "auth.verify.invalidDescription",
      badge: "warn" as const,
    },
  }[phase] ?? {
    eyebrowKey: "auth.verify.eyebrow",
    titleKey: "auth.verifyEmail",
    descriptionKey: "auth.verify.description",
    badge: null,
  }

  return (
    <>
      {content.eyebrowKey ? <span className="auth-eyebrow">{t(content.eyebrowKey)}</span> : null}
      {content.badge ? (
        <span className={content.badge === "warn" ? "auth-badge auth-badge--warn" : "auth-badge"}>
          {content.badge === "warn" ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )}
          {phase === "used" ? t("auth.link.used.label") : t("auth.link.expired.label")}
        </span>
      ) : null}
      <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
        {t(content.titleKey)}
      </h1>
      <p className="auth-desc">{t(content.descriptionKey)}</p>

      <EmailLinkForm
        idPrefix="verify"
        submitLabel={t("auth.verify.sendEmail")}
        sentMessage={(value) => t("auth.verify.sentMessage", { email: value })}
        initialEmail={email}
        cooldownKey={VERIFY_EMAIL_COOLDOWN_KEY}
        onRequest={requestVerificationEmail}
        onSentChange={(sent) => setPhase(sent ? "sent" : fallbackPhase)}
        backHref="/"
        backLabel={t("auth.backToSpindle")}
      />
    </>
  )
}
