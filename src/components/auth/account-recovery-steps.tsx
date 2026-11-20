"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { CheckCircle2, CircleDashed } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { AuthApiError } from "@/lib/auth/auth-client"
import {
  completeAccountRecovery,
  getRecoveryStatus,
  markRecoveryEmailVerified,
  resetRecoveryPassword,
  type RecoverySession,
  type RecoveryStatus,
} from "@/lib/auth-recovery"
import { PASSWORD_MIN_LENGTH } from "@/components/site/auth/validation"

import { PasswordField } from "./password-field"

type StepId = "password" | "email" | "finish"

type Props = {
  session: RecoverySession
  /** Called when the recovery session token is no longer accepted. */
  onExpired: () => void
  /** Called after the recovery is completed server-side. */
  onDone: () => void
}

function isSessionError(error: unknown): boolean {
  return error instanceof AuthApiError && error.code === "invalid_token"
}

function formatEventType(type: string): string {
  return type.replace(/[._]/g, " ")
}

/**
 * Verified-phase wizard for account recovery: set a new password, confirm
 * the email, review recent security activity, then complete — which revokes
 * every session server-side.
 */
export function AccountRecoverySteps({ session, onExpired, onDone }: Props) {
  const { t } = useLanguage()
  const [status, setStatus] = useState<RecoveryStatus | null>(null)
  const [statusError, setStatusError] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordDone, setPasswordDone] = useState(false)
  const [emailDone, setEmailDone] = useState(false)
  const [busy, setBusy] = useState<StepId | null>(null)
  /** Inline error inside the password form. */
  const [error, setError] = useState("")
  /** Error from the email/finish step actions, shown below the list. */
  const [actionError, setActionError] = useState("")
  const headingRef = useRef<HTMLHeadingElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    getRecoveryStatus(session.sessionToken)
      .then((result) => {
        if (cancelled) return
        setStatus(result)
        setPasswordDone(Boolean(result.actions.passwordResetAt))
        setEmailDone(Boolean(result.actions.emailVerifiedAt))
        if (result.phase === "completed") onDone()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isSessionError(err)) {
          onExpired()
          return
        }
        setStatusError(t("auth.error.connection"))
      })
    return () => {
      cancelled = true
    }
    // Only re-run when the session token changes; onExpired/onDone are stable
    // callbacks owned by the parent screen.
  }, [session.sessionToken])

  function stepState(id: StepId, done: boolean): "done" | "todo" {
    return done ? "done" : "todo"
  }

  async function runStep(id: StepId, action: () => Promise<void>, onSuccess: () => void) {
    setActionError("")
    setBusy(id)
    try {
      await action()
      onSuccess()
    } catch (err) {
      if (isSessionError(err)) {
        onExpired()
        return
      }
      setActionError(err instanceof AuthApiError ? err.message : t("auth.error.connection"))
    } finally {
      setBusy(null)
    }
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
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
    void runStep(
      "password",
      () => resetRecoveryPassword({ sessionToken: session.sessionToken, password }),
      () => setPasswordDone(true),
    )
  }

  const securityEvents = status?.events ?? []

  return (
    <>
      <span className="auth-eyebrow">{t("auth.recoveryEyebrow")}</span>
      <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
        {t("auth.accountRecovery.steps.title")}
      </h1>
      <p className="auth-desc">
        {t("auth.accountRecovery.steps.description", { email: session.email })}
      </p>

      {statusError ? (
        <p className="auth-form-alert" role="alert">
          {statusError}{" "}
          <button
            type="button"
            className="auth-link-button"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
          </button>
        </p>
      ) : null}

      <ol className="auth-recovery-steps">
        {/* Step 1 — new password */}
        <li className="auth-recovery-step">
          <div className="auth-recovery-step-head">
            <span className="auth-recovery-step-icon" aria-hidden="true">
              {stepState("password", passwordDone) === "done" ? <CheckCircle2 /> : <CircleDashed />}
            </span>
            <div>
              <h2 className="auth-recovery-step-title">
                {t("auth.accountRecovery.step.password.title")}
              </h2>
              <p className="auth-hint">{t("auth.accountRecovery.step.password.description")}</p>
            </div>
          </div>
          {passwordDone ? (
            <p className="auth-hint" role="status">
              {t("auth.passwordUpdated")}
            </p>
          ) : (
            <form
              className="auth-form"
              onSubmit={handlePasswordSubmit}
              aria-busy={busy === "password"}
            >
              <PasswordField
                id="recovery-new-password"
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
                id="recovery-confirm-password"
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
              <Button
                type="submit"
                variant="outline"
                className="auth-secondary-btn"
                disabled={busy !== null}
              >
                {busy === "password" ? (
                  <>
                    <span className="auth-spinner" aria-hidden="true" />{" "}
                    {t("auth.updatingPassword")}
                  </>
                ) : (
                  t("auth.updatePassword")
                )}
              </Button>
            </form>
          )}
        </li>

        {/* Step 2 — confirm email */}
        <li className="auth-recovery-step">
          <div className="auth-recovery-step-head">
            <span className="auth-recovery-step-icon" aria-hidden="true">
              {stepState("email", emailDone) === "done" ? <CheckCircle2 /> : <CircleDashed />}
            </span>
            <div>
              <h2 className="auth-recovery-step-title">
                {t("auth.accountRecovery.step.email.title")}
              </h2>
              <p className="auth-hint">{t("auth.accountRecovery.step.email.description")}</p>
            </div>
          </div>
          {emailDone ? (
            <p className="auth-hint" role="status">
              {t("auth.accountRecovery.emailVerified")}
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="auth-secondary-btn"
              disabled={busy !== null}
              onClick={() =>
                void runStep(
                  "email",
                  () => markRecoveryEmailVerified(session.sessionToken),
                  () => setEmailDone(true),
                )
              }
            >
              {busy === "email" ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" /> {t("common.loading")}
                </>
              ) : (
                t("auth.accountRecovery.confirmEmail")
              )}
            </Button>
          )}
        </li>

        {/* Step 3 — review security activity */}
        <li className="auth-recovery-step">
          <div className="auth-recovery-step-head">
            <span className="auth-recovery-step-icon" aria-hidden="true">
              <CircleDashed />
            </span>
            <div>
              <h2 className="auth-recovery-step-title">
                {t("auth.accountRecovery.step.security.title")}
              </h2>
              <p className="auth-hint">{t("auth.accountRecovery.step.security.description")}</p>
            </div>
          </div>
          {securityEvents.length === 0 ? (
            <p className="auth-hint">{t("auth.accountRecovery.securityEventsEmpty")}</p>
          ) : (
            <>
              <h3 className="auth-recovery-events-title">
                {t("auth.accountRecovery.securityEventsTitle")}
              </h3>
              <ul className="auth-recovery-events">
                {securityEvents.map((event, index) => (
                  <li key={`${event.timestamp}-${index}`} className="auth-recovery-event">
                    <span className="auth-recovery-event-type">{formatEventType(event.type)}</span>
                    <time dateTime={event.timestamp}>
                      {new Date(event.timestamp).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            </>
          )}
        </li>

        {/* Step 4 — finish */}
        <li className="auth-recovery-step">
          <div className="auth-recovery-step-head">
            <span className="auth-recovery-step-icon" aria-hidden="true">
              <CircleDashed />
            </span>
            <div>
              <h2 className="auth-recovery-step-title">
                {t("auth.accountRecovery.step.finish.title")}
              </h2>
              <p className="auth-hint">{t("auth.accountRecovery.step.finish.description")}</p>
            </div>
          </div>
          <Button
            type="button"
            className="ui-btn-primary auth-submit"
            disabled={busy !== null}
            onClick={() =>
              void runStep("finish", () => completeAccountRecovery(session.sessionToken), onDone)
            }
          >
            {busy === "finish" ? (
              <>
                <span className="auth-spinner" aria-hidden="true" />{" "}
                {t("auth.accountRecovery.finishing")}
              </>
            ) : (
              t("auth.accountRecovery.finish")
            )}
          </Button>
        </li>
      </ol>

      {actionError ? (
        <p className="auth-form-alert" role="alert">
          {actionError}
        </p>
      ) : null}

      <p className="auth-hint">
        {t("auth.accountRecovery.sessionHint", {
          minutes: Math.max(
            1,
            Math.round((Date.parse(session.sessionExpiresAt) - Date.now()) / 60000),
          ),
        })}
      </p>
    </>
  )
}
