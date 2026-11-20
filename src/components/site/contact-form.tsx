"use client"

import { useRef, useState, type FormEvent } from "react"

import {
  CONTACT_LIMITS,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  HONEYPOT_FIELD,
} from "@/lib/site-form-constants"
import { SPAM_TIMESTAMP_FIELD } from "@/lib/contact-spam"

type Status = "idle" | "submitting" | "success" | "error"

type FieldName = "name" | "email" | "topic" | "reference" | "subject" | "message"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** DOM id per field, used for error-summary focus management. */
const FIELD_IDS: Record<FieldName, string> = {
  name: "contact-name",
  email: "contact-email",
  topic: "contact-topic",
  reference: "contact-reference",
  subject: "contact-subject",
  message: "contact-message",
}

/** Field order decides which invalid control receives focus first. */
const FIELD_ORDER: FieldName[] = ["name", "email", "topic", "reference", "subject", "message"]

function validate(values: Record<FieldName, string>): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {}
  const name = values.name.trim()
  if (!name) errors.name = "Name is required."
  else if (name.length > CONTACT_LIMITS.nameMax) errors.name = "Name is too long."

  const email = values.email.trim()
  if (!email) errors.email = "Email is required."
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address."

  if (!(CONTACT_TOPICS as readonly string[]).includes(values.topic)) {
    errors.topic = "Please choose a topic."
  }

  const reference = values.reference.trim()
  if (reference.length > CONTACT_LIMITS.referenceMax) {
    errors.reference = "Reference is too long."
  }

  const subject = values.subject.trim()
  if (!subject) errors.subject = "Subject is required."
  else if (subject.length > CONTACT_LIMITS.subjectMax) errors.subject = "Subject is too long."

  const message = values.message.trim()
  if (message.length < CONTACT_LIMITS.messageMin) {
    errors.message = `Tell us a little more — at least ${CONTACT_LIMITS.messageMin} characters.`
  } else if (message.length > CONTACT_LIMITS.messageMax) {
    errors.message = "Message is too long."
  }
  return errors
}

/** Grow the textarea to fit its content (capped by maxLength on input). */
function autosizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto"
  // jsdom reports scrollHeight 0; only apply a real measurement.
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
}

/**
 * Contact form posting to /api/contact. Client-side validation mirrors the
 * server schema; the server remains the source of truth.
 */
export function ContactForm() {
  const [values, setValues] = useState<Record<FieldName, string>>({
    name: "",
    email: "",
    topic: "",
    reference: "",
    subject: "",
    message: "",
  })
  const [honeypot, setHoneypot] = useState("")
  // Hidden render timestamp for the server-side time-trap check. Refreshed
  // whenever the form resets so a stale page load cannot trip the max-age rule.
  const [renderedAt, setRenderedAt] = useState(() => new Date().toISOString())
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [reference, setReference] = useState("")
  const submittingRef = useRef(false)

  const loading = status === "submitting"

  function setField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function focusField(field: FieldName) {
    document.getElementById(FIELD_IDS[field])?.focus()
  }

  function focusFirstInvalid(nextErrors: Partial<Record<FieldName, string>>) {
    const first = FIELD_ORDER.find((field) => nextErrors[field])
    if (first) focusField(first)
  }

  function resetForm() {
    setValues({ name: "", email: "", topic: "", reference: "", subject: "", message: "" })
    setHoneypot("")
    setRenderedAt(new Date().toISOString())
    setErrors({})
    setFormError("")
    setReference("")
    setStatus("idle")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || status === "success") return

    const nextErrors = validate(values)
    setErrors(nextErrors)
    setFormError("")
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(nextErrors)
      return
    }

    submittingRef.current = true
    setStatus("submitting")
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          topic: values.topic,
          reference: values.reference.trim(),
          subject: values.subject.trim(),
          message: values.message.trim(),
          [HONEYPOT_FIELD]: honeypot,
          [SPAM_TIMESTAMP_FIELD]: renderedAt,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
        reference?: string
        errors?: Record<string, string>
      } | null

      if (response.ok && data?.ok) {
        setStatus("success")
        setReference(data.reference ?? "")
        setValues({ name: "", email: "", topic: "", reference: "", subject: "", message: "" })
        setHoneypot("")
        setRenderedAt(new Date().toISOString())
        return
      }

      if (data?.errors) {
        // Server errors replace client errors entirely: the server just
        // re-validated the whole payload, so keeping stale client-side keys
        // (e.g. a field the user already fixed) would resurrect phantom errors.
        const serverErrors = data.errors as Partial<Record<FieldName, string>>
        setErrors(serverErrors)
        focusFirstInvalid(serverErrors)
      }
      setFormError(data?.message ?? "Something went wrong. Please try again.")
      setStatus("error")
    } catch {
      setFormError("Something went wrong. Check your connection and try again.")
      setStatus("error")
    } finally {
      submittingRef.current = false
    }
  }

  if (status === "success") {
    return (
      <div className="form-success" role="status">
        <strong>Message sent.</strong>
        <p>Thanks for reaching out — we&apos;ll get back to you soon.</p>
        {reference ? (
          <p className="form-hint">
            Your reference is <code className="form-reference">{reference}</code> — quote it if you
            follow up.
          </p>
        ) : null}
        <button type="button" className="btn form-submit" onClick={resetForm}>
          Send another message
        </button>
      </div>
    )
  }

  // Error keys in display order: known fields first (focusable links), then
  // any non-field keys the server may return ("form", honeypot, …) as plain
  // text so the count and the list always match.
  const errorKeys = [
    ...FIELD_ORDER.filter((field) => errors[field]),
    ...Object.keys(errors).filter((key) => !(FIELD_ORDER as readonly string[]).includes(key)),
  ]
  const errorCount = errorKeys.length

  return (
    <form className="contact-form" onSubmit={handleSubmit} aria-busy={loading} noValidate>
      {formError ? (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      ) : null}

      {errorCount > 0 ? (
        <div className="form-alert form-alert--summary" role="alert">
          <p>
            {errorCount === 1
              ? "There is 1 problem with your message:"
              : `There are ${errorCount} problems with your message:`}
          </p>
          <ul>
            {errorKeys.map((key) => {
              const message = (errors as Record<string, string>)[key]
              const elementId = (FIELD_IDS as Record<string, string>)[key]
              return (
                <li key={key}>
                  {elementId ? (
                    <a
                      href={`#${elementId}`}
                      onClick={(event) => {
                        event.preventDefault()
                        document.getElementById(elementId)?.focus()
                      }}
                    >
                      {message}
                    </a>
                  ) : (
                    message
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="contact-name">
            Name
          </label>
          <input
            id="contact-name"
            className="form-input"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={CONTACT_LIMITS.nameMax}
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            disabled={loading}
          />
          {errors.name ? (
            <p className="form-error" id="contact-name-error" role="alert">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="contact-email">
            Email
          </label>
          <input
            id="contact-email"
            className="form-input"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={320}
            value={values.email}
            onChange={(event) => setField("email", event.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            disabled={loading}
          />
          {errors.email ? (
            <p className="form-error" id="contact-email-error" role="alert">
              {errors.email}
            </p>
          ) : null}
        </div>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="contact-topic">
            Topic
          </label>
          <select
            id="contact-topic"
            className="form-input"
            name="topic"
            required
            value={values.topic}
            onChange={(event) => setField("topic", event.target.value)}
            aria-invalid={errors.topic ? true : undefined}
            aria-describedby={errors.topic ? "contact-topic-error" : undefined}
            disabled={loading}
          >
            <option value="" disabled>
              Select a topic…
            </option>
            {CONTACT_TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {CONTACT_TOPIC_LABELS[topic]}
              </option>
            ))}
          </select>
          {errors.topic ? (
            <p className="form-error" id="contact-topic-error" role="alert">
              {errors.topic}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="contact-reference">
            Order or account reference <span className="form-label-optional">(optional)</span>
          </label>
          <input
            id="contact-reference"
            className="form-input"
            name="reference"
            type="text"
            autoComplete="off"
            maxLength={CONTACT_LIMITS.referenceMax}
            value={values.reference}
            onChange={(event) => setField("reference", event.target.value)}
            aria-invalid={errors.reference ? true : undefined}
            aria-describedby={
              errors.reference
                ? "contact-reference-error contact-reference-hint"
                : "contact-reference-hint"
            }
            disabled={loading}
          />
          <p className="form-hint" id="contact-reference-hint">
            An order, invoice, or account number helps us find your record.
          </p>
          {errors.reference ? (
            <p className="form-error" id="contact-reference-error" role="alert">
              {errors.reference}
            </p>
          ) : null}
        </div>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="contact-subject">
          Subject
        </label>
        <input
          id="contact-subject"
          className="form-input"
          name="subject"
          type="text"
          required
          maxLength={CONTACT_LIMITS.subjectMax}
          value={values.subject}
          onChange={(event) => setField("subject", event.target.value)}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={
            errors.subject ? "contact-subject-error contact-subject-hint" : "contact-subject-hint"
          }
          disabled={loading}
        />
        <p className="form-hint" id="contact-subject-hint">
          One line that sums it up.{" "}
          <span className="form-count">
            {values.subject.length}/{CONTACT_LIMITS.subjectMax}
          </span>
        </p>
        {errors.subject ? (
          <p className="form-error" id="contact-subject-error" role="alert">
            {errors.subject}
          </p>
        ) : null}
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          className="form-input form-textarea"
          name="message"
          rows={5}
          required
          maxLength={CONTACT_LIMITS.messageMax}
          value={values.message}
          onChange={(event) => {
            setField("message", event.target.value)
            autosizeTextarea(event.target)
          }}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={
            errors.message ? "contact-message-error contact-message-hint" : "contact-message-hint"
          }
          disabled={loading}
        />
        <p className="form-hint" id="contact-message-hint">
          A few sentences is plenty — at least {CONTACT_LIMITS.messageMin} characters.{" "}
          <span className="form-count">
            {values.message.length}/{CONTACT_LIMITS.messageMax}
          </span>
        </p>
        {errors.message ? (
          <p className="form-error" id="contact-message-error" role="alert">
            {errors.message}
          </p>
        ) : null}
      </div>

      {/* Render timestamp for the server-side time-trap; invisible to users. */}
      <input type="hidden" name={SPAM_TIMESTAMP_FIELD} value={renderedAt} readOnly />

      {/* Honeypot: hidden from humans, tempting to bots. Keep it empty. */}
      <div className="form-honeypot" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>

      <button type="submit" className="btn btn--primary form-submit" disabled={loading}>
        {loading ? "Sending…" : "Send message"}
      </button>
    </form>
  )
}
