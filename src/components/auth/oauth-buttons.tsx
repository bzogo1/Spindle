"use client"

import { useState } from "react"
import { KeyRound } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { AuthApiError, beginOAuthSignIn } from "@/lib/auth/auth-client"
import { Button } from "@/components/ui/button"
import { GithubIcon, GitlabIcon } from "@/components/ui/brand-icons"

const KNOWN_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
] as const

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

type OAuthButtonsProps = {
  /** Provider names returned by the server-side OAuth registry. */
  providers?: string[]
  /** Safe in-app path to return to after the provider callback. */
  returnTo?: string
}

/** Social sign-in buttons backed by the PKCE OAuth flow. */
export function OAuthButtons({ providers = [], returnTo }: OAuthButtonsProps) {
  const { t } = useLanguage()
  const [pendingProvider, setPendingProvider] = useState<string | null>(null)
  const [error, setError] = useState("")
  const configured = new Set(providers.map((provider) => provider.toLowerCase()))
  const knownIds = new Set<string>(KNOWN_PROVIDERS.map((provider) => provider.id))
  const extraProviders = providers
    .filter((provider) => !knownIds.has(provider.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))

  async function startOAuth(provider: string) {
    if (pendingProvider) return
    setError("")
    setPendingProvider(provider)
    try {
      await beginOAuthSignIn({ provider, returnTo })
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : t("auth.error.connection"))
    } finally {
      setPendingProvider(null)
    }
  }

  return (
    <div className="auth-oauth" aria-label={t("auth.oauth.providersLabel")}>
      {KNOWN_PROVIDERS.map((provider) => {
        const isConfigured = configured.has(provider.id)
        return (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="auth-oauth-btn"
            disabled={!isConfigured || pendingProvider !== null}
            title={
              isConfigured
                ? t("auth.oauth.continueWith", { provider: provider.label })
                : t("auth.oauth.notConfigured", { provider: provider.label })
            }
            onClick={() => void startOAuth(provider.id)}
          >
            {provider.id === "google" ? (
              <GoogleIcon />
            ) : provider.id === "gitlab" ? (
              <GitlabIcon aria-hidden="true" />
            ) : (
              <GithubIcon aria-hidden="true" />
            )}
            {t("auth.oauth.continueWith", { provider: provider.label })}
            {isConfigured ? null : <span className="auth-oauth-badge">{t("auth.oauth.soon")}</span>}
          </Button>
        )
      })}

      {extraProviders.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          className="auth-oauth-btn"
          disabled={pendingProvider !== null}
          title={t("auth.oauth.continueWith", { provider: providerLabel(provider) })}
          onClick={() => void startOAuth(provider)}
        >
          <KeyRound aria-hidden="true" />
          {t("auth.oauth.continueWith", { provider: providerLabel(provider) })}
        </Button>
      ))}

      {error ? (
        <p className="auth-form-alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
