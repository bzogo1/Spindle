"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getTokenState } from "@/lib/auth-recovery"

import { PasswordField } from "./password-field"

const unusableLinkCopy = {
  expired: {
    label: "Link expired",
    title: "This reset link has expired",
    description:
      "Password reset links expire quickly to keep accounts safe. Request a fresh link and we'll email it to you.",
  },
  used: {
    label: "Link already used",
    title: "This reset link has already been used",
    description:
      "If you already changed your password, sign in with the new one. Otherwise, request another link.",
  },
  invalid: {
    label: "Invalid link",
    title: "This reset link isn't valid",
    description:
      "The link is incomplete or may have been copied incorrectly. Request a new link to continue.",
  },
} as const

type Phase = "form" | "submitting" | "success"

/** New-password form for `/reset-password/[token]`, including unusable-link states. */
export function ResetPasswordForm({ token }: { token: string }) {
  const tokenState = getTokenState(token)
  const [phase, setPhase] = useState<Phase>("form")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    if (password.length < 8) {
      setError("Use at least 8 characters.")
      passwordRef.current?.focus()
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      confirmRef.current?.focus()
      return
    }

    setPhase("submitting")
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setPhase("success")
    }, 450)
  }

  if (tokenState !== "valid") {
    const copy = unusableLinkCopy[tokenState]
    return (
      <>
        <span className={tokenState === "invalid" ? "auth-badge auth-badge--warn" : "auth-badge"}>
          {tokenState === "invalid" ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )}
          {copy.label}
        </span>
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-desc">{copy.description}</p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/reset-password">Request a new link</a>
          </Button>
          <a className="auth-link-button" href="/about#contact">
            Contact support
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
          Password updated
        </h1>
        <p className="auth-desc">
          Your password has been changed. Sign in with your new password to get back to your
          workspace.
        </p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/">Sign in</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <span className="auth-eyebrow">Account recovery</span>
      <h1 className="auth-title">Choose a new password</h1>
      <p className="auth-desc">
        Pick a strong password for your Spindle account, then sign in with it.
      </p>

      <form className="auth-form" onSubmit={handleSubmit} aria-busy={phase === "submitting"}>
        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            setError("")
          }}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          hint="At least 8 characters."
          inputRef={passwordRef}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          onChange={(value) => {
            setConfirmPassword(value)
            setError("")
          }}
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          error={error || undefined}
          inputRef={confirmRef}
        />

        <Button
          type="submit"
          className="ui-btn-primary auth-submit"
          disabled={phase === "submitting"}
        >
          {phase === "submitting" ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              Updating password…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </form>
    </>
  )
}
