"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock3, MailOpen } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * `/invite?token=…` — the accept page for workspace invitation emails.
 *
 * On mount it probes `GET /api/invitations/accept` for the token's state and
 * renders one of: pending (invite details + accept button), used, revoked,
 * expired, or invalid. Accepting POSTs the same token; the route consumes
 * the invite single-use and sets the session cookie, after which the user
 * continues into the app.
 */

type InviteStatus = "pending" | "used" | "revoked" | "expired" | "invalid"

type InvitationDetails = {
  email: string
  role: string
  inviterName: string
  workspaceName: string
  expiresAt: string
}

type Phase = InviteStatus | "loading" | "accepting" | "accepted" | "error"

const TERMINAL_COPY: Record<
  Exclude<InviteStatus, "pending">,
  { title: string; description: string }
> = {
  used: {
    title: "This invitation has already been accepted",
    description:
      "The link is single-use. If this was you, sign in to reach your workspace — otherwise ask the sender for a new invite.",
  },
  revoked: {
    title: "This invitation was revoked",
    description:
      "The workspace withdrew this invitation. Ask the person who invited you to send a new one.",
  },
  expired: {
    title: "This invitation has expired",
    description:
      "Invitation links expire after 7 days. Ask the person who invited you to resend it.",
  },
  invalid: {
    title: "This invitation link isn't valid",
    description:
      "The link is incomplete or may have been copied incorrectly. Check the email for the full link, or ask for a new invitation.",
  },
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

export function AcceptInviteScreen() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [phase, setPhase] = useState<Phase>("loading")
  const [invite, setInvite] = useState<InvitationDetails | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousPhase = useRef<Phase>(phase)

  useEffect(() => {
    if (!token) {
      setPhase("invalid")
      return
    }
    let cancelled = false
    setPhase("loading")
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          status?: InviteStatus
          invitation?: InvitationDetails
        } | null
        if (cancelled) return
        const status = body?.status ?? "invalid"
        setInvite(body?.invitation ?? null)
        setPhase(status === "pending" ? "pending" : status)
      })
      .catch(() => {
        if (!cancelled) setPhase("error")
      })
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (previousPhase.current !== phase && phase !== "loading" && phase !== "accepting") {
      headingRef.current?.focus()
    }
    previousPhase.current = phase
  }, [phase])

  async function accept() {
    if (!token || phase !== "pending") return
    setPhase("accepting")
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = (await response.json().catch(() => null)) as {
        code?: string
        status?: string
      } | null
      if (response.ok && body?.status === "accepted") {
        setPhase("accepted")
        return
      }
      // The invite may have been consumed/revoked between the status probe
      // and the accept — mirror the terminal states the GET would report.
      if (body?.code === "invite_used") setPhase("used")
      else if (body?.code === "invite_revoked") setPhase("revoked")
      else if (body?.code === "invite_expired") setPhase("expired")
      else setPhase("error")
    } catch {
      setPhase("error")
    }
  }

  if (phase === "loading" || phase === "accepting") {
    const accepting = phase === "accepting"
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <span className="auth-spinner auth-spinner--lg" />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          {accepting ? "Joining the workspace" : "Checking your invitation"}
        </h1>
        <p className="auth-desc">
          {accepting
            ? "Hold on while we add you to the workspace."
            : "Hold on while we check this invitation link."}
        </p>
      </div>
    )
  }

  if (phase === "accepted") {
    return (
      <div className="auth-state" role="status" aria-live="polite">
        <span className="auth-state-icon" aria-hidden="true">
          <CheckCircle2 />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          You're in
        </h1>
        <p className="auth-desc">
          {invite
            ? `You've joined ${invite.workspaceName} on Spindle as ${roleLabel(invite.role).toLowerCase()}.`
            : "Your workspace invitation was accepted."}
        </p>
        <div className="auth-actions">
          <Button asChild className="ui-btn-primary auth-submit">
            <a href="/dashboard">Open your workspace</a>
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "pending" && invite) {
    return (
      <>
        <span className="auth-eyebrow">Workspace invitation</span>
        <span className="auth-state-icon" aria-hidden="true">
          <MailOpen />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          Join {invite.workspaceName}
        </h1>
        <p className="auth-desc">
          <strong>{invite.inviterName}</strong> invited <strong>{invite.email}</strong> to join the{" "}
          {invite.workspaceName} workspace as {roleLabel(invite.role).toLowerCase()}.
        </p>
        <div className="auth-actions">
          <Button type="button" className="ui-btn-primary auth-submit" onClick={accept}>
            Accept invitation
          </Button>
        </div>
        <p className="auth-desc text-muted-foreground">
          Accepting signs you in with this invitation link — no password needed.
        </p>
      </>
    )
  }

  if (phase === "error") {
    return (
      <div className="auth-state" role="alert">
        <span className="auth-state-icon" aria-hidden="true">
          <AlertTriangle />
        </span>
        <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
          Something went wrong
        </h1>
        <p className="auth-desc">
          We couldn't check this invitation. Check your connection and try again.
        </p>
        <div className="auth-actions">
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const copy = TERMINAL_COPY[phase as Exclude<InviteStatus, "pending">] ?? TERMINAL_COPY.invalid
  return (
    <div className="auth-state" role="status" aria-live="polite">
      <span className="auth-state-icon" aria-hidden="true">
        {phase === "expired" ? <Clock3 /> : <AlertTriangle />}
      </span>
      {phase === "expired" ? (
        <span className="auth-badge">
          <Clock3 aria-hidden="true" />
          Link expired
        </span>
      ) : null}
      <h1 className="auth-title" ref={headingRef} tabIndex={-1}>
        {copy.title}
      </h1>
      <p className="auth-desc">{copy.description}</p>
      <div className="auth-actions">
        <Button asChild variant="outline">
          <a href="/">Back to Spindle</a>
        </Button>
      </div>
    </div>
  )
}
