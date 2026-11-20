"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { AuthApiError, completeOAuthSignIn } from "@/lib/auth/auth-client"
import { Button } from "@/components/ui/button"

type Phase = "verifying" | "signed-in" | "invalid" | "missing"

/**
 * `/oauth/callback` — landing route for OAuth providers. Validates `state`
 * against the PKCE flow stored before the redirect, exchanges the code via
 * `/api/auth/oauth/callback`, then navigates to the stored return path.
 */
export function OAuthCallbackScreen() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const providerParam = searchParams.get("provider")
  const oauthError = searchParams.get("error")
  const [phase, setPhase] = useState<Phase>(code && state ? "verifying" : "missing")
  const [message, setMessage] = useState("")
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (oauthError) {
      ranRef.current = true
      setMessage(t("auth.oauth.providerDenied"))
      setPhase("invalid")
      return
    }
    if (!code || !state) return
    ranRef.current = true

    // The provider is recovered from the stored PKCE flow inside
    // completeOAuthSignIn; providerParam is only a consistency hint.
    completeOAuthSignIn({ provider: providerParam ?? undefined, code, state })
      .then(({ returnTo }) => {
        setPhase("signed-in")
        // Same sanitizer as beginOAuthSignIn: only in-app paths — "/" alone
        // is not enough because "//host" is protocol-relative and would
        // navigate off-site.
        const target = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"
        window.setTimeout(() => window.location.assign(target), 800)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof AuthApiError ? error.message : t("auth.error.generic"))
        setPhase("invalid")
      })
  }, [code, state, oauthError, providerParam, t])

  if (phase === "verifying") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <span className="auth-spinner auth-spinner--lg" />
        </span>
        <h1 className="auth-title">{t("auth.oauth.verifyingTitle")}</h1>
        <p className="auth-desc">{t("auth.oauth.verifyingDescription")}</p>
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
        <p className="auth-desc">{t("auth.oauth.signedInDescription")}</p>
      </div>
    )
  }

  return (
    <div className="auth-state" role="alert">
      <span className="auth-state-icon" aria-hidden="true">
        <AlertTriangle />
      </span>
      <h1 className="auth-title">
        {phase === "missing" ? t("auth.linkIncompleteTitle") : t("auth.oauth.invalidTitle")}
      </h1>
      <p className="auth-desc">
        {phase === "missing"
          ? t("auth.oauth.missingDescription")
          : (message ?? t("auth.oauth.invalidDescription"))}
      </p>
      <div className="auth-actions">
        <Button asChild className="ui-btn-primary auth-submit">
          <a href="/">{t("auth.backToSpindle")}</a>
        </Button>
      </div>
    </div>
  )
}
