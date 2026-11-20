"use client"

import { useState, type FormEvent } from "react"
import { CheckCircle2, ShieldAlert } from "lucide-react"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * `/emergency-access` — unauthenticated break-glass redemption.
 *
 * The user enters their account email and a single-use emergency code. A
 * successful redemption NEVER creates a sign-in session: the server returns a
 * short-lived restricted access token (kept in React state only — never in
 * the URL, cookies, or web storage) that authorises exactly three actions:
 * set a new password (mandatory), mark the email verified (optional), and
 * finish — which revokes every session and burns the token.
 *
 * This file is a client component so the whole flow lives in one place; the
 * page therefore has no `metadata` export (follow-up: split into a server
 * page + client screen if SEO metadata is wanted).
 */

type Phase =
  | { name: "redeem" }
  | { name: "secure"; accessToken: string; email: string; accessExpiresAt: string }
  | { name: "done" }

type ApiFailure = { code?: string; message?: string; reason?: string }

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Network error. Check your connection and try again.")
  }
  let payload: Record<string, unknown>
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    throw new Error("Unexpected response from the server.")
  }
  if (!response.ok || payload.ok === false) {
    const failure = payload as ApiFailure
    const error = new Error(
      typeof failure.message === "string" && failure.message
        ? failure.message
        : "Something went wrong. Please try again.",
    )
    ;(error as Error & { code?: string; reason?: string }).code = failure.code
    ;(error as Error & { code?: string; reason?: string }).reason = failure.reason
    throw error
  }
  return payload
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

export default function EmergencyAccessPage() {
  const [phase, setPhase] = useState<Phase>({ name: "redeem" })
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordDone, setPasswordDone] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sessionExpired, setSessionExpired] = useState(false)

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setSessionExpired(false)
    if (!email.trim() || !code.trim()) {
      setError("Enter your account email and an emergency code.")
      return
    }
    setBusy(true)
    try {
      const payload = await post("/api/auth/emergency-codes/redeem", {
        email: email.trim(),
        code: code.trim(),
      })
      setPhase({
        name: "secure",
        accessToken: String(payload.accessToken ?? ""),
        email: String(payload.email ?? email.trim()),
        accessExpiresAt: String(payload.accessExpiresAt ?? ""),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code could not be redeemed.")
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    setPhase({ name: "redeem" })
    setPassword("")
    setConfirmPassword("")
    setPasswordDone(false)
    setEmailVerified(false)
    setError("")
    setSessionExpired(false)
  }

  async function secureAction(action: () => Promise<void>, fallback: string) {
    setError("")
    setSessionExpired(false)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      if (errorCode(err) === "invalid_token") {
        setSessionExpired(true)
        setError("This recovery session has expired. Start again with a new code.")
      } else {
        setError(err instanceof Error ? err.message : fallback)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase.name !== "secure") return
    if (password.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    await secureAction(async () => {
      await post("/api/auth/emergency-codes/access/password", {
        accessToken: phase.accessToken,
        password,
      })
      setPassword("")
      setConfirmPassword("")
      setPasswordDone(true)
    }, "Couldn't update your password. Please try again.")
  }

  async function confirmEmail() {
    if (phase.name !== "secure") return
    await secureAction(async () => {
      await post("/api/auth/emergency-codes/access/email-verified", {
        accessToken: phase.accessToken,
      })
      setEmailVerified(true)
    }, "Couldn't verify your email. You can finish anyway.")
  }

  async function finish() {
    if (phase.name !== "secure") return
    await secureAction(async () => {
      await post("/api/auth/emergency-codes/access/complete", {
        accessToken: phase.accessToken,
      })
      setPhase({ name: "done" })
    }, "Couldn't finish recovery. Please try again.")
  }

  return (
    <AuthShell
      footer={
        <>
          Remembered your password? <a href="/">Back to Spindle</a>
        </>
      }
    >
      {phase.name === "redeem" ? (
        <>
          <span className="auth-eyebrow">Emergency access</span>
          <h1 className="auth-title">Recover with an emergency code</h1>
          <p className="auth-desc">
            Last resort only — for when you cannot use your password, two-factor codes, or email
            recovery. Enter the email on your account and one unused emergency code. You will be
            required to set a new password; every device is signed out.
          </p>
          <form className="auth-form" onSubmit={redeem} aria-busy={busy}>
            <div className="app-field">
              <label htmlFor="emergency-email">Account email</label>
              <Input
                id="emergency-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="app-field">
              <label htmlFor="emergency-code">Emergency code</label>
              <Input
                id="emergency-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                required
              />
            </div>
            {error ? (
              <p className="auth-form-alert" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="ui-btn-primary auth-submit" disabled={busy}>
              {busy ? "Checking…" : "Use emergency code"}
            </Button>
          </form>
          <p className="auth-hint">
            Codes are single-use and expire. Using one burns the rest of your set and signs out
            every device on the account.
          </p>
        </>
      ) : null}

      {phase.name === "secure" ? (
        <>
          <span className="auth-eyebrow">Emergency access</span>
          <h1 className="auth-title">Secure your account</h1>
          <p className="auth-desc">
            Code accepted for <strong>{phase.email}</strong>. Set a new password to finish — this is
            required before recovery can complete.
          </p>

          {passwordDone ? (
            <p className="auth-hint" role="status">
              Password updated.
            </p>
          ) : (
            <form className="auth-form" onSubmit={submitPassword} aria-busy={busy}>
              <div className="app-field">
                <label htmlFor="emergency-new-password">New password</label>
                <Input
                  id="emergency-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="app-field">
                <label htmlFor="emergency-confirm-password">Confirm new password</label>
                <Input
                  id="emergency-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                className="auth-secondary-btn"
                disabled={busy}
              >
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}

          <div className="auth-actions" style={{ marginTop: 16 }}>
            {emailVerified ? (
              <p className="auth-hint" role="status">
                Email confirmed.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="auth-secondary-btn"
                disabled={busy}
                onClick={() => void confirmEmail()}
              >
                Confirm my email
              </Button>
            )}
            <Button
              type="button"
              className="ui-btn-primary auth-submit"
              disabled={busy || !passwordDone}
              onClick={() => void finish()}
            >
              {busy ? "Finishing…" : "Finish recovery"}
            </Button>
          </div>
          {!passwordDone ? (
            <p className="auth-hint">
              <ShieldAlert aria-hidden="true" /> You must set a new password before finishing.
            </p>
          ) : null}
          {error ? (
            <p className="auth-form-alert" role="alert">
              {error}{" "}
              {sessionExpired ? (
                <button type="button" className="auth-link-button" onClick={startOver}>
                  Start over
                </button>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}

      {phase.name === "done" ? (
        <div className="auth-state" role="status" aria-live="polite">
          <span className="auth-state-icon" aria-hidden="true">
            <CheckCircle2 />
          </span>
          <h1 className="auth-title">Account secured</h1>
          <p className="auth-desc">
            Your password was updated, every session was signed out, and your emergency codes were
            revoked. Sign in with your new password, then generate a fresh set of emergency codes in
            account settings.
          </p>
          <div className="auth-actions">
            <Button asChild className="ui-btn-primary auth-submit">
              <a href="/">Go to sign in</a>
            </Button>
          </div>
        </div>
      ) : null}
    </AuthShell>
  )
}
