"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getTokenState } from "@/lib/auth-recovery"

import { EmailLinkForm } from "./email-link-form"

type Phase = "verifying" | "verified" | "expired" | "used" | "invalid" | "resend" | "sent"

/** `/verify-email` states: verifying, verified, expired, invalid, and resend. */
export function VerifyEmailScreen() {
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
    const timer = window.setTimeout(() => {
      setPhase(tokenState === "valid" ? "verified" : tokenState)
    }, 600)

    return () => window.clearTimeout(timer)
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
          Verifying your email
        </h1>
        <p className="auth-desc">Hold on while we confirm this link. This only takes a moment.</p>
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
          Email verified
        </h1>
        <p className="auth-desc">
          Your address is confirmed. You can close this tab and get back to your workspace.
        </p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/">Continue to Spindle</a>
          </Button>
        </div>
      </div>
    )
  }

  const fallbackPhase: Phase = !token ? "resend" : tokenState === "valid" ? "resend" : tokenState

  const content = {
    resend: {
      eyebrow: "Account security",
      title: "Verify your email",
      description: "Enter your work email and we'll send a fresh verification link.",
      badge: null as null | "warn" | "plain",
    },
    sent: {
      eyebrow: "Link sent",
      title: "Check your inbox",
      description: "Open the link we just sent to finish verifying your address.",
      badge: null as null | "warn" | "plain",
    },
    expired: {
      eyebrow: null,
      title: "This verification link has expired",
      description:
        "Verification links expire quickly to keep accounts safe. Send yourself a fresh one below.",
      badge: "plain" as const,
    },
    used: {
      eyebrow: null,
      title: "This verification link has already been used",
      description:
        "If your email is already verified, you can sign in from the homepage. Otherwise, send yourself a new link.",
      badge: "plain" as const,
    },
    invalid: {
      eyebrow: null,
      title: "This verification link isn't valid",
      description:
        "The link is incomplete or may have been copied incorrectly. Send a new verification email to continue.",
      badge: "warn" as const,
    },
  }[phase] ?? {
    eyebrow: "Account security",
    title: "Verify your email",
    description: "Enter your work email and we'll send a fresh verification link.",
    badge: null,
  }

  return (
    <>
      {content.eyebrow ? <span className="auth-eyebrow">{content.eyebrow}</span> : null}
      {content.badge ? (
        <span className={content.badge === "warn" ? "auth-badge auth-badge--warn" : "auth-badge"}>
          {content.badge === "warn" ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )}
          {phase === "used" ? "Link already used" : "Link expired"}
        </span>
      ) : null}
      <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
        {content.title}
      </h1>
      <p className="auth-desc">{content.description}</p>

      <EmailLinkForm
        idPrefix="verify"
        submitLabel="Send verification email"
        sentMessage={(value) => (
          <>
            A fresh verification link is on its way to <strong>{value}</strong>.
          </>
        )}
        initialEmail={email}
        onSentChange={(sent) => setPhase(sent ? "sent" : fallbackPhase)}
        backHref="/"
        backLabel="Back to Spindle"
      />
    </>
  )
}
