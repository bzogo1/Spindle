"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import { useLanguage } from "@/components/i18n/language-provider"
import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { TextField } from "./field"
import {
  authSignIn,
  toMockSession,
  verifyTotpSignIn,
  MockAuthError,
  type MockSession,
} from "./mock-auth"
import { useAuthForm } from "./use-auth-form"
import {
  acceptSession,
  AuthApiError,
  requestPasswordlessLink,
  type ClientSession,
} from "@/lib/auth/auth-client"
import { signInWithPasskey, webauthnSupported } from "@/lib/webauthn/client"
import { Input } from "@/components/ui/input"
import { VALIDATION_PARAMS, validateEmail, validateSignInPassword } from "./validation"

type SignInValues = {
  email: string
  password: string
  remember: boolean
}

const FIELD_ORDER = ["email", "password"] as const

function validate(values: SignInValues) {
  return {
    email: validateEmail(values.email),
    password: validateSignInPassword(values.password),
  }
}

type SignInFormProps = {
  onSuccess: (session: MockSession, clientSession?: ClientSession | null) => void
  onForgotPassword: () => void
  /** In-app path the magic link should return to after sign-in. */
  next?: string
}

/** The API answers repeated-failure lockouts with 429 + `account_locked` + `retryAfter`. */
function isAccountLockedError(error: unknown): error is AuthApiError {
  return error instanceof AuthApiError && (error.code as string) === "account_locked"
}

function lockoutRetryAfterSeconds(error: AuthApiError): number {
  const value = error.data.retryAfter
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 60
}

/** Compact countdown label: "45s", "4m 20s", "1h 5m". */
function formatLockoutDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

/** Email + password sign-in, with a TOTP challenge step when 2FA is enabled. */
export function SignInForm({ onSuccess, onForgotPassword, next }: SignInFormProps) {
  const { t } = useLanguage()
  const { values, errors, formError, setFormError, setField, handleBlur, validateAll, fieldRef } =
    useAuthForm<SignInValues>({ email: "", password: "", remember: true }, validate, [
      ...FIELD_ORDER,
    ])
  const [loading, setLoading] = useState(false)
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [totpRemember, setTotpRemember] = useState(true)
  const [totpError, setTotpError] = useState("")
  const [magicLinkState, setMagicLinkState] = useState<"idle" | "sending" | "sent">("idle")
  // Passwordless WebAuthn sign-in (passkeys + security keys): hidden
  // entirely on unsupported browsers. One ceremony covers both — anonymous
  // auth/begin returns discoverable-credential options, so any registered
  // passkey or resident security key can answer without a username.
  const [securityKeySupported] = useState(() => webauthnSupported())
  const [securityKeyBusy, setSecurityKeyBusy] = useState(false)
  // Account lockout countdown (epoch ms when the server-side lock lifts).
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [lockoutNow, setLockoutNow] = useState(() => Date.now())
  const submittingRef = useRef(false)

  useEffect(() => {
    if (lockoutUntil === null) return
    const tick = () => {
      const at = Date.now()
      setLockoutNow(at)
      if (at >= lockoutUntil) setLockoutUntil(null)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [lockoutUntil])

  const lockoutSeconds =
    lockoutUntil === null ? 0 : Math.max(0, Math.ceil((lockoutUntil - lockoutNow) / 1000))
  const isLocked = lockoutSeconds > 0

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || isLocked || !validateAll()) return

    submittingRef.current = true
    setLoading(true)
    try {
      const result = await authSignIn({
        email: values.email.trim(),
        password: values.password,
        remember: values.remember,
      })
      if ("totpChallenge" in result) {
        setTotpChallenge(result.totpChallenge)
        setTotpRemember(values.remember)
        setTotpCode("")
        setTotpError("")
        return
      }
      onSuccess(result.session, result.clientSession)
    } catch (error) {
      if (error instanceof MockAuthError && error.code === "invalid_credentials") {
        setFormError(t("auth.error.invalidCredentials"))
      } else if (isAccountLockedError(error)) {
        // Lockout is distinct from bad credentials: show a countdown and
        // disable submission until the server-side lock expires.
        setLockoutUntil(Date.now() + lockoutRetryAfterSeconds(error) * 1000)
        setLockoutNow(Date.now())
        setFormError("")
      } else if (error instanceof AuthApiError) {
        setFormError(error.message)
      } else {
        setFormError(t("auth.error.connection"))
      }
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  /**
   * Passwordless sign-in via `/api/auth/webauthn/auth/*`: the browser runs
   * `navigator.credentials.get()` (discoverable-credential options — the
   * passkey flow) and the complete route sets the auth cookies. A dismissed
   * prompt (NotAllowedError) is a silent cancel; real failures surface
   * through the same form-error slot as password sign-in.
   */
  async function handleSecurityKeySignIn() {
    if (submittingRef.current || securityKeyBusy || isLocked) return
    submittingRef.current = true
    setSecurityKeyBusy(true)
    setFormError("")
    try {
      const session = await signInWithPasskey()
      // Adopt the session into the auth client so `getCurrentSession()` is
      // populated for the post-sign-in navigation in completeAuthSession.
      acceptSession(session)
      onSuccess(toMockSession(session), session)
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        // User cancelled the security-key prompt — stay silent.
      } else {
        setFormError(error instanceof AuthApiError ? error.message : t("auth.error.connection"))
      }
    } finally {
      submittingRef.current = false
      setSecurityKeyBusy(false)
    }
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!totpChallenge || submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    setTotpError("")
    try {
      const result = await verifyTotpSignIn({
        challenge: totpChallenge,
        code: totpCode,
        remember: totpRemember,
      })
      onSuccess(result.session, result.clientSession)
    } catch (error) {
      setTotpError(error instanceof AuthApiError ? error.message : t("auth.error.connection"))
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (totpChallenge) {
    return (
      <form
        className="auth-form"
        onSubmit={handleTotpSubmit}
        aria-busy={loading}
        aria-label={t("auth.twoFactor")}
        noValidate
      >
        {totpError ? (
          <p className="auth-form-alert" role="alert">
            {totpError}
          </p>
        ) : null}
        <p className="auth-hint">{t("auth.twoFactorHint")}</p>
        <div className="ui-field">
          <Label htmlFor="auth-totp-code">{t("auth.authCode")}</Label>
          <Input
            id="auth-totp-code"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="ui-auth-row">
          <div className="ui-check-row">
            <Checkbox
              id="auth-totp-remember"
              aria-label={t("auth.keepSignedIn")}
              checked={totpRemember}
              onCheckedChange={(checked) => setTotpRemember(checked === true)}
            />
            <Label htmlFor="auth-totp-remember">{t("auth.keepSignedIn")}</Label>
          </div>
        </div>
        <Button type="submit" className="ui-btn-primary auth-submit" disabled={loading}>
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> {t("auth.verifying")}
            </>
          ) : (
            t("auth.verify")
          )}
        </Button>
        <div className="auth-links">
          <button
            type="button"
            className="auth-link-button"
            onClick={() => {
              setTotpChallenge(null)
              setTotpError("")
            }}
          >
            {t("auth.backToSignIn")}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit}
      aria-busy={loading}
      aria-label={t("auth.signIn")}
      noValidate
    >
      {isLocked ? (
        <p className="auth-form-alert" role="alert">
          {t("auth.error.accountLocked", {
            time: formatLockoutDuration(lockoutSeconds),
          })}
        </p>
      ) : formError ? (
        <p className="auth-form-alert" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="auth-fields" disabled={loading}>
        <TextField
          id="auth-email"
          label={t("auth.workEmail")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@lab.edu"
          value={values.email}
          onChange={(value) => {
            setField("email", value)
            // Lockout is keyed to the submitted email server-side; a
            // different address is a different lock bucket, so drop the
            // stale countdown and let the user try it.
            if (lockoutUntil !== null) {
              setLockoutUntil(null)
              setFormError("")
            }
          }}
          onBlur={handleBlur("email")}
          error={errors.email ? t(errors.email, VALIDATION_PARAMS) : undefined}
          autoFocus
          inputRef={fieldRef("email")}
        />
        <PasswordField
          id="auth-password"
          label={t("auth.password")}
          value={values.password}
          onChange={(value) => setField("password", value)}
          onBlur={handleBlur("password")}
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password ? t(errors.password, VALIDATION_PARAMS) : undefined}
          inputRef={fieldRef("password")}
        />
        <div className="ui-auth-row">
          <div className="ui-check-row">
            <Checkbox
              id="auth-remember"
              aria-label={t("auth.keepSignedIn")}
              checked={values.remember}
              onCheckedChange={(checked) => setField("remember", checked === true)}
            />
            <Label htmlFor="auth-remember">{t("auth.keepSignedIn")}</Label>
          </div>
          <button type="button" className="auth-link-button" onClick={onForgotPassword}>
            {t("auth.forgotPassword")}
          </button>
        </div>

        <Button type="submit" className="ui-btn-primary auth-submit" disabled={loading || isLocked}>
          {loading ? (
            <>
              <span className="auth-spinner" aria-hidden="true" /> {t("auth.signingIn")}
            </>
          ) : (
            t("auth.signIn")
          )}
        </Button>

        <div className="auth-links">
          <button
            type="button"
            className="auth-link-button"
            disabled={magicLinkState === "sending" || isLocked}
            onClick={async () => {
              const email = values.email.trim()
              if (validate({ ...values, email }).email) {
                setFormError(t("auth.error.emailForLink"))
                return
              }
              setMagicLinkState("sending")
              setFormError("")
              try {
                await requestPasswordlessLink({ email, purpose: "signin", next })
                setMagicLinkState("sent")
              } catch (error) {
                setMagicLinkState("idle")
                setFormError(
                  error instanceof AuthApiError ? error.message : t("auth.error.connection"),
                )
              }
            }}
          >
            {magicLinkState === "sending" ? (
              <>
                <span className="auth-spinner" aria-hidden="true" /> {t("auth.sendingLink")}
              </>
            ) : magicLinkState === "sent" ? (
              t("auth.signInLinkSent")
            ) : (
              t("auth.emailSignInLink")
            )}
          </button>
          {securityKeySupported ? (
            <button
              type="button"
              className="auth-link-button"
              disabled={securityKeyBusy || loading || isLocked}
              title={t("auth.securityKeyHint")}
              onClick={() => void handleSecurityKeySignIn()}
            >
              {securityKeyBusy ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />{" "}
                  {t("auth.securityKeyWorking")}
                </>
              ) : (
                t("auth.securityKeySignIn")
              )}
            </button>
          ) : null}
        </div>
      </fieldset>
    </form>
  )
}
