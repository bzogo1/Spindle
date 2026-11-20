"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { getTokenState } from "@/lib/auth-recovery"
import { AuthApiError, confirmPasswordReset } from "@/lib/auth/auth-client"
import { PASSWORD_MIN_LENGTH } from "@/components/site/auth/validation"

import { PasswordField } from "./password-field"
import { CaptchaWidget } from "./captcha-widget"

type UnusableLinkState = "expired" | "used" | "invalid"
type Phase = "form" | "submitting" | "success"

/** New-password form for `/reset-password/[token]`, including unusable-link states. */
export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useLanguage()
  const tokenState = getTokenState(token)
  const [phase, setPhase] = useState<Phase>("form")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaStatus, setCaptchaStatus] = useState<"solving" | "verified" | "error">("solving")
  // Bumped to remount the widget (fresh challenge) when the server rejects a
  // captcha token — tokens are single-use, so a burned/expired one needs a
  // brand-new solve rather than a resubmit.
  const [captchaEpoch, setCaptchaEpoch] = useState(0)
  const [error, setError] = useState("")
  const timerRef = useRef<number | null>(null)
  const successRef = useRef<HTMLHeadingElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (phase === "success") successRef.current?.focus()
  }, [phase])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t("auth.validation.passwordTooShort", { min: PASSWORD_MIN_LENGTH }))
      passwordRef.current?.focus()
      return
    }

    if (password !== confirmPassword) {
      setError(t("auth.validation.passwordsDontMatch"))
      confirmRef.current?.focus()
      return
    }

    setPhase("submitting")
    try {
      await confirmPasswordReset({ token, password, captchaToken: captchaToken ?? undefined })
      setPhase("success")
    } catch (error) {
      setPhase("form")
      setError(error instanceof AuthApiError ? error.message : t("auth.error.connection"))
      if (error instanceof AuthApiError && error.code === "captcha_failed") {
        setCaptchaEpoch((epoch) => epoch + 1)
      }
      passwordRef.current?.focus()
    }
  }

  if (tokenState !== "valid") {
    const state = tokenState as UnusableLinkState
    return (
      <>
        <span className={tokenState === "invalid" ? "auth-badge auth-badge--warn" : "auth-badge"}>
          {tokenState === "invalid" ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )}
          {t(`auth.link.${state}.label`)}
        </span>
        <h1 className="auth-title">{t(`auth.link.${state}.title`)}</h1>
        <p className="auth-desc">{t(`auth.link.${state}.description`)}</p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/reset-password">{t("auth.requestNewLink")}</a>
          </Button>
          <a className="auth-link-button" href="/about#contact">
            {t("auth.contactSupport")}
          </a>
        </div>
      </>
    )
  }

  if (phase === "success") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <h1 className="auth-title" ref={successRef} tabIndex={-1}>
          {t("auth.passwordUpdated")}
        </h1>
        <p className="auth-desc">{t("auth.passwordUpdatedDesc")}</p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/">{t("auth.signIn")}</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <span className="auth-eyebrow">{t("auth.recoveryEyebrow")}</span>
      <h1 className="auth-title">{t("auth.chooseNewPassword")}</h1>
      <p className="auth-desc">{t("auth.chooseNewPasswordDesc")}</p>

      <form className="auth-form" onSubmit={handleSubmit} aria-busy={phase === "submitting"}>
        <PasswordField
          id="new-password"
          label={t("auth.newPassword")}
          value={password}
          onChange={(value) => {
            setPassword(value)
            setError("")
          }}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={PASSWORD_MIN_LENGTH}
          hint={t("auth.passwordMinHint", { min: PASSWORD_MIN_LENGTH })}
          inputRef={passwordRef}
        />
        <PasswordField
          id="confirm-password"
          label={t("auth.confirmNewPassword")}
          value={confirmPassword}
          onChange={(value) => {
            setConfirmPassword(value)
            setError("")
          }}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={PASSWORD_MIN_LENGTH}
          error={error || undefined}
          inputRef={confirmRef}
        />

        <CaptchaWidget
          key={captchaEpoch}
          onToken={setCaptchaToken}
          onStatusChange={setCaptchaStatus}
        />

        <Button
          type="submit"
          className="ui-btn-primary auth-submit"
          disabled={phase === "submitting" || captchaStatus !== "verified"}
        >
          {phase === "submitting" ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              {t("auth.updatingPassword")}
            </>
          ) : (
            t("auth.updatePassword")
          )}
        </Button>
      </form>
    </>
  )
}
