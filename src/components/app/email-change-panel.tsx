"use client"

import { useEffect, useRef, useState } from "react"
import { MailCheck, RotateCcw, XCircle } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { ApiError, request } from "@/lib/api/client"

/**
 * Email change panel for account settings. Talks to `/api/auth/email-change`:
 * request sends a signed single-use link to the NEW address; confirm happens
 * on the emailed link (`GET .../confirm` redirects back here with
 * `?email-change=confirmed|failed`), resend/cancel hit their own endpoints.
 *
 * The panel defines its own response types (like `BackupCodesStatus`) so it
 * stays client-safe — `src/lib/email-change.ts` is server-only.
 */

type PendingView = {
  newEmail: string
  requestedAt: string
  expiresAt: string
}

type EmailChangeStatus = {
  email: string
  pending: PendingView | null
  resendCooldownSeconds: number
}

type StatusResponse = { emailChange?: EmailChangeStatus }

function statusFrom(body: StatusResponse): EmailChangeStatus {
  if (!body.emailChange) throw new Error("The email-change response was incomplete.")
  return body.emailChange
}

async function fetchStatus(signal?: AbortSignal): Promise<EmailChangeStatus> {
  return statusFrom(await request<StatusResponse>("", "/api/auth/email-change", { signal }))
}

function formatExpiry(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function EmailChangePanel({ currentEmail }: { currentEmail: string }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<EmailChangeStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [fieldError, setFieldError] = useState("")
  const [busy, setBusy] = useState<"request" | "resend" | "cancel" | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const handledRedirect = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoadError("")
    fetchStatus(controller.signal)
      .then((data) => {
        setStatus(data)
        setCooldownLeft((current) => Math.max(current, data.resendCooldownSeconds))
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setLoadError("We could not load your email settings. Try again.")
      })
    return () => controller.abort()
  }, [reloadKey])

  // Surface the confirm-redirect result once, then clean the URL.
  useEffect(() => {
    if (handledRedirect.current || typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get("email-change")
    if (!outcome) return
    handledRedirect.current = true
    if (outcome === "confirmed") {
      toast({
        title: "Email updated",
        description: "Your account email was changed successfully.",
        variant: "success",
      })
      setReloadKey((key) => key + 1)
    } else {
      const reason = params.get("reason")
      const message =
        reason === "email_unavailable"
          ? "That email address is already in use by another account."
          : reason === "expired"
            ? "The confirmation link expired or was replaced. Request a new one."
            : "The confirmation link wasn't valid. Request a new one."
      toast({
        title: "Email change failed",
        description: message,
        variant: "error",
      })
    }
    params.delete("email-change")
    params.delete("reason")
    const query = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [toast])

  // Countdown for the resend/request cooldown. The interval only needs to
  // exist while the count is positive; the functional update keeps it correct
  // even if renders interleave.
  useEffect(() => {
    if (cooldownLeft <= 0) return
    const timer = setInterval(() => {
      setCooldownLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownLeft])

  async function run(kind: "request" | "resend" | "cancel", action: () => Promise<unknown>) {
    setBusy(kind)
    try {
      await action()
      return true
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "Please wait a moment before trying again."
          : "Something went wrong. Please try again."
      toast({ title: "Email change failed", description: message, variant: "error" })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function submitRequest() {
    const target = newEmail.trim()
    if (!target) {
      setFieldError("Enter the new email address.")
      return
    }
    setFieldError("")
    const okRequest = await run("request", async () => {
      const body = await request<{
        pending?: PendingView
        retryAfter?: number
      }>("", "/api/auth/email-change/request", {
        method: "POST",
        body: { newEmail: target },
      })
      if (body.pending) {
        setStatus((current) =>
          current
            ? {
                ...current,
                pending: body.pending!,
                resendCooldownSeconds: body.retryAfter ?? current.resendCooldownSeconds,
              }
            : current,
        )
        setCooldownLeft(body.retryAfter ?? 60)
      }
      setNewEmail("")
    })
    if (okRequest) {
      toast({
        title: "Verification email sent",
        description: `Check ${target} for a confirmation link.`,
        variant: "success",
      })
      // No refetch: the request response already carries the pending view,
      // and a GET here could race a not-yet-visible pending record.
    }
  }

  async function resend() {
    const okResend = await run("resend", async () => {
      const body = await request<{
        pending?: PendingView
        retryAfter?: number
      }>("", "/api/auth/email-change/resend", { method: "POST" })
      setStatus((current) =>
        current && body.pending
          ? { ...current, pending: body.pending!, resendCooldownSeconds: body.retryAfter ?? 60 }
          : current,
      )
      setCooldownLeft(body.retryAfter ?? 60)
    })
    if (okResend) {
      toast({
        title: "Verification email resent",
        description: "A fresh confirmation link is on its way.",
        variant: "success",
      })
    }
  }

  async function cancel() {
    const okCancel = await run("cancel", () =>
      request("", "/api/auth/email-change/cancel", { method: "POST" }),
    )
    if (okCancel) {
      setStatus((current) => (current ? { ...current, pending: null } : current))
      toast({ title: "Email change cancelled", variant: "success" })
    }
  }

  const pending = status?.pending ?? null
  const effectiveEmail = status?.email ?? currentEmail
  const cooldownActive = cooldownLeft > 0

  return (
    <div className="app-field" data-testid="email-change-panel">
      <span className="app-field-label" id="account-email-change-label">
        Email address
      </span>
      <p className="app-field-hint" style={{ marginTop: 0 }}>
        Current email: <strong>{effectiveEmail}</strong>
      </p>

      {loadError ? <InlineError title={null} message={loadError} /> : null}

      {pending ? (
        <div role="status" aria-live="polite">
          <div className="app-pref-row">
            <div>
              <strong>Change pending</strong>
              <small>
                Verification sent to <strong>{pending.newEmail}</strong>. Confirm the link before{" "}
                {formatExpiry(pending.expiresAt) || "it expires"}.
              </small>
            </div>
            <span className="app-badge is-pending">Pending</span>
          </div>
          <div className="app-form-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resend}
              disabled={busy !== null || cooldownActive}
            >
              <RotateCcw aria-hidden="true" />
              {busy === "resend"
                ? "Sending…"
                : cooldownActive
                  ? `Resend in ${cooldownLeft}s`
                  : "Resend link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancel}
              disabled={busy !== null}
            >
              <XCircle aria-hidden="true" />
              {busy === "cancel" ? "Cancelling…" : "Cancel change"}
            </Button>
          </div>
        </div>
      ) : (
        // NOTE: rendered inside the profile <form> on the account screen, so
        // this is a div + explicit submit rather than a nested <form>.
        <div
          aria-labelledby="account-email-change-label"
          className="grid gap-2"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
              event.preventDefault()
              void submitRequest()
            }
          }}
        >
          <div className="app-field" style={{ marginBottom: 0 }}>
            <label htmlFor="account-email-new">New email address</label>
            <Input
              id="account-email-new"
              type="email"
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value)
                if (fieldError) setFieldError("")
              }}
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={fieldError ? true : undefined}
              disabled={busy !== null}
            />
            {fieldError ? <InlineError title={null} message={fieldError} /> : null}
            <p className="app-field-hint">
              We will email a confirmation link to the new address. Your email changes only after
              you confirm it.
            </p>
          </div>
          <div className="app-form-actions">
            <Button type="button" onClick={() => void submitRequest()} disabled={busy !== null}>
              <MailCheck aria-hidden="true" />
              {busy === "request" ? "Sending…" : "Send verification link"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
