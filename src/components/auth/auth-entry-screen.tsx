"use client"

import { useState } from "react"

import { useLanguage } from "@/components/i18n/language-provider"
import { SignInForm } from "@/components/site/auth/sign-in-form"
import { CreateWorkspaceForm } from "@/components/site/auth/create-workspace-form"
import type { MockSession } from "@/components/site/auth/mock-auth"
import { APP_ROOT_PATH } from "@/lib/auth/mock-session"

import { completeAuthSession } from "./complete-auth"
import { OAuthButtons } from "./oauth-buttons"

type AuthEntryScreenProps = {
  mode: "sign-in" | "sign-up"
  /** Sanitized in-app path to return to after auth completes. */
  next?: string
  /** OAuth provider names configured on the server. */
  providers?: string[]
}

/** Client-side entry form for the standalone sign-in and sign-up pages. */
export function AuthEntryScreen({ mode, next, providers = [] }: AuthEntryScreenProps) {
  const { t } = useLanguage()
  const [actionError, setActionError] = useState("")
  const returnTo = next ?? APP_ROOT_PATH

  function handleSuccess(session: MockSession) {
    if (completeAuthSession(session, returnTo)) return
    setActionError(t("auth.error.finishSignIn"))
  }

  return (
    <div className="grid gap-5">
      {actionError ? (
        <p className="auth-form-alert" role="alert">
          {actionError}
        </p>
      ) : null}

      <OAuthButtons providers={providers} returnTo={returnTo} />

      <div className="auth-divider">
        <span>{t("auth.orContinueWithEmail")}</span>
      </div>

      {mode === "sign-in" ? (
        <SignInForm
          onSuccess={handleSuccess}
          onForgotPassword={() => window.location.assign("/reset-password")}
          next={next}
        />
      ) : (
        <CreateWorkspaceForm onSuccess={handleSuccess} />
      )}
    </div>
  )
}
