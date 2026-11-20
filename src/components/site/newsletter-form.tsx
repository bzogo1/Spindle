"use client"

import { useRef, useState, type FormEvent } from "react"

import { HONEYPOT_FIELD, NEWSLETTER_SOURCE } from "@/lib/site-form-constants"

type Status = "idle" | "submitting" | "success" | "error"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Footer newsletter signup posting to /api/newsletter. Confirmation copy is
 * honest either way: with Resend configured the subscriber gets a real
 * welcome email; without it the address is logged for manual follow-up.
 * There is no double opt-in yet, so the success copy does not promise a
 * confirmation email — it only confirms the subscription was recorded.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState("")
  const [error, setError] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const submittingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || status === "success") return

    const trimmed = email.trim()
    if (!trimmed) {
      setError("Enter your email address.")
      return
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError("Enter a valid email address.")
      return
    }
    if (!consent) {
      setError("Please agree to the Privacy Policy to subscribe.")
      return
    }

    setError("")
    submittingRef.current = true
    setStatus("submitting")
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          source: NEWSLETTER_SOURCE,
          consent,
          [HONEYPOT_FIELD]: honeypot,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
      } | null

      if (response.ok && data?.ok) {
        setStatus("success")
        setEmail("")
        setConsent(false)
        setHoneypot("")
        return
      }

      setError(data?.message ?? "Something went wrong. Please try again.")
      setStatus("error")
    } catch {
      setError("Something went wrong. Check your connection and try again.")
      setStatus("error")
    } finally {
      submittingRef.current = false
    }
  }

  if (status === "success") {
    return (
      <p className="newsletter-success" role="status">
        You&apos;re subscribed — we&apos;ll only email when something ships.
      </p>
    )
  }

  const loading = status === "submitting"

  return (
    <form className="newsletter-form" onSubmit={handleSubmit} aria-busy={loading}>
      <label className="form-label" htmlFor="newsletter-email">
        Product updates
      </label>
      <div className="newsletter-row">
        <input
          id="newsletter-email"
          className="form-input newsletter-input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@lab.edu"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            if (error) setError("")
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "newsletter-email-error" : "newsletter-email-hint"}
          disabled={loading}
        />
        <button type="submit" className="btn btn--primary newsletter-submit" disabled={loading}>
          {loading ? "…" : "Subscribe"}
        </button>
      </div>
      <div className="newsletter-consent">
        <input
          id="newsletter-consent"
          name="consent"
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked)
            if (error) setError("")
          }}
          disabled={loading}
        />
        <label htmlFor="newsletter-consent">
          I agree to receive product updates and have read the <a href="/privacy">Privacy Policy</a>
          .
        </label>
      </div>
      {/* Honeypot: hidden from humans, tempting to bots. Keep it empty. */}
      <div className="form-honeypot" aria-hidden="true">
        <label htmlFor="newsletter-website">Website</label>
        <input
          id="newsletter-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>
      {error ? (
        <p className="form-error" id="newsletter-email-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="form-hint" id="newsletter-email-hint">
          Occasional updates. Unsubscribe anytime.
        </p>
      )}
    </form>
  )
}
