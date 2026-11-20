"use client"

import { useEffect, useRef, useState } from "react"

type Status = "loading" | "ready" | "already" | "success" | "invalid" | "error"

type ApiStatus = {
  ok?: boolean
  email?: string
  scope?: string
  subscribed?: boolean
  message?: string
}

function scopeLabel(scope: string | undefined): string {
  if (scope === "all") return "all Spindle emails"
  if (scope === "marketing" || scope === "newsletter") return "Spindle marketing emails"
  if (scope) return `Spindle ${scope} emails`
  return "these emails"
}

/**
 * Confirmation UI for /unsubscribe. On mount it GETs the token's status
 * (read-only — safe for link scanners), then POSTs only when the visitor
 * clicks the confirm button. Already-unsubscribed addresses get a calm
 * "you're done" state instead of an error.
 *
 * Two deliberate details:
 *  - Until the component mounts it renders a static card, not the "checking"
 *    loader. Server-rendered HTML (and noscript visitors, where effects never
 *    run) therefore never shows a perpetual loading state.
 *  - A failed POST keeps the confirm button on screen with an inline error —
 *    the visitor can retry without reloading. Only a failed status GET (or a
 *    400 from POST) drops into the error/invalid states, which offer their
 *    own retry path.
 */
export function UnsubscribeForm({ token, email }: { token?: string; email?: string }) {
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<Status>(token ? "loading" : "invalid")
  const [resolvedEmail, setResolvedEmail] = useState(email ?? "")
  const [scope, setScope] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const submittingRef = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !token) return
    let cancelled = false

    async function load() {
      try {
        const params = new URLSearchParams({ token: token! })
        if (email) params.set("email", email)
        const response = await fetch(`/api/email/unsubscribe?${params.toString()}`)
        const data = (await response.json().catch(() => null)) as ApiStatus | null
        if (cancelled) return
        if (!response.ok || !data?.ok) {
          setMessage(data?.message ?? "This unsubscribe link is invalid or has expired.")
          setStatus("invalid")
          return
        }
        setResolvedEmail(data.email ?? email ?? "")
        setScope(data.scope)
        setStatus(data.subscribed === false ? "already" : "ready")
      } catch {
        if (!cancelled) {
          setMessage("Something went wrong. Check your connection and try again.")
          setStatus("error")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [mounted, token, email, reloadKey])

  function handleRetryStatus() {
    setError("")
    setMessage("")
    setStatus("loading")
    setReloadKey((key) => key + 1)
  }

  async function handleConfirm() {
    if (!token || submittingRef.current || status !== "ready") return
    submittingRef.current = true
    setError("")
    try {
      const response = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: resolvedEmail || undefined }),
      })
      const data = (await response.json().catch(() => null)) as ApiStatus | null
      if (response.ok && data?.ok) {
        setStatus("success")
        setMessage(data.message ?? "")
        return
      }
      if (response.status === 400) {
        // The link itself is bad — retrying the same token won't help.
        setMessage(data?.message ?? "This unsubscribe link is invalid or has expired.")
        setStatus("invalid")
        return
      }
      // Transient failure (429/5xx/network-ish): stay on the confirm screen so
      // the visitor can retry without reloading.
      setError(data?.message ?? "Something went wrong. Please try again.")
    } catch {
      setError("Something went wrong. Check your connection and try again.")
    } finally {
      submittingRef.current = false
    }
  }

  // Pre-mount (and therefore SSR / noscript): a static card with an honest
  // fallback instead of a loader that would never resolve without JS. With no
  // token at all we can already show the invalid-link state — no need to wait
  // for mount.
  if (!mounted && token) {
    return (
      <div className="contact-card">
        <h2 className="section-title">Email preferences</h2>
        <p className="section-desc">
          {email ? (
            <>
              Manage emails to <strong>{email}</strong>.{" "}
            </>
          ) : (
            "Manage your email preferences. "
          )}
          This page needs JavaScript to confirm — without it, email{" "}
          <a href="mailto:hello@spindle.example">hello@spindle.example</a> and we&apos;ll remove you
          from our list.
        </p>
      </div>
    )
  }

  if (status === "loading") {
    return (
      <p className="form-hint" role="status">
        Checking your unsubscribe link…
      </p>
    )
  }

  if (status === "invalid" || (!token && status !== "success")) {
    return (
      <div className="contact-card" role="alert">
        <h2 className="section-title">Link problem</h2>
        <p className="section-desc">
          {message ||
            "This unsubscribe link is missing or incomplete. Open the link from a recent Spindle email, or email hello@spindle.example and we&apos;ll remove you."}
        </p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="contact-card" role="alert">
        <h2 className="section-title">Something went wrong</h2>
        <p className="section-desc">{message}</p>
        <button type="button" className="btn btn--primary" onClick={handleRetryStatus}>
          Try again
        </button>
      </div>
    )
  }

  const heading =
    status === "success"
      ? "You're unsubscribed."
      : status === "already"
        ? "Already unsubscribed."
        : "Confirm unsubscribe."

  return (
    <div className="contact-card">
      <h2 className="section-title">{heading}</h2>
      <p className="section-desc">
        {status === "success" ? (
          <>
            {resolvedEmail ? <strong>{resolvedEmail}</strong> : "This address"} will no longer
            receive {scopeLabel(scope)}.{message ? ` ${message}` : ""}
          </>
        ) : status === "already" ? (
          <>
            <strong>{resolvedEmail || "This address"}</strong> is already unsubscribed from{" "}
            {scopeLabel(scope)} — nothing else to do.
          </>
        ) : (
          <>
            Stop emails to <strong>{resolvedEmail || "this address"}</strong> about{" "}
            {scopeLabel(scope)}? This takes effect immediately.
          </>
        )}
      </p>

      {status === "ready" && error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {status === "ready" ? (
        <button type="button" className="btn btn--primary" onClick={handleConfirm}>
          Unsubscribe
        </button>
      ) : null}

      {status === "success" || status === "already" ? (
        <p className="form-hint">Changed your mind? Subscribe again from the footer form.</p>
      ) : null}
    </div>
  )
}
