"use client"

import { useId, useRef, useState, type FormEvent } from "react"
import { CheckCircle2Icon, MessageCircleIcon } from "lucide-react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TextareaField } from "@/components/ui/textarea"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_LIMITS,
  type FeedbackCategory,
} from "@/lib/feedback-constants"
import { HONEYPOT_FIELD } from "@/lib/site-form-constants"

type Status = "idle" | "submitting" | "success" | "error"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(values: {
  category: FeedbackCategory
  message: string
  email: string
}): Record<string, string> {
  const errors: Record<string, string> = {}
  const message = values.message.trim()
  if (message.length < FEEDBACK_LIMITS.messageMin) {
    errors.message = `Tell us a little more — at least ${FEEDBACK_LIMITS.messageMin} characters.`
  } else if (message.length > FEEDBACK_LIMITS.messageMax) {
    errors.message = "Message is too long."
  }
  const email = values.email.trim()
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address."
  }
  return errors
}

/**
 * Floating "Send feedback" widget. The trigger opens an accessible dialog
 * (Radix: focus trap, Escape-to-close, aria wiring) with a small form that
 * posts to `/api/feedback`. Client-side validation mirrors the server schema;
 * the server remains the source of truth.
 */
export function FeedbackWidget({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const id = useId()
  const categoryId = `${id}-category`
  const messageId = `${id}-message`
  const emailId = `${id}-email`

  const [open, setOpen] = useState(defaultOpen)
  const [category, setCategory] = useState<FeedbackCategory>("general")
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState("")
  const [honeypot, setHoneypot] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const submittingRef = useRef(false)

  const loading = status === "submitting"

  function resetForm() {
    setCategory("general")
    setMessage("")
    setEmail("")
    setHoneypot("")
    setErrors({})
    setFormError("")
    setStatus("idle")
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Reopening after a successful send starts a fresh form.
    if (next && status === "success") resetForm()
  }

  function clearFieldError(field: string) {
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || status === "success") return

    const nextErrors = validate({ category, message, email })
    setErrors(nextErrors)
    setFormError("")
    if (Object.keys(nextErrors).length > 0) return

    submittingRef.current = true
    setStatus("submitting")
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          email: email.trim(),
          [HONEYPOT_FIELD]: honeypot,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
        errors?: Record<string, string>
      } | null

      if (response.ok && data?.ok) {
        setStatus("success")
        return
      }

      if (data?.errors) {
        setErrors((current) => ({ ...current, ...data.errors }))
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

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
        aria-label="Send feedback"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MessageCircleIcon aria-hidden="true" />
        Feedback
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {status === "success" ? (
            <div className="grid gap-4" role="status">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2Icon className="text-chart-2 size-5" aria-hidden="true" />
                  Thanks for the feedback
                </DialogTitle>
                <DialogDescription>
                  We read every message — it helps us decide what to build next.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Send another
                </Button>
                <DialogClose asChild>
                  <Button type="button">Done</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Send feedback</DialogTitle>
                <DialogDescription>
                  Report a bug, share an idea, or tell us anything else on your mind.
                </DialogDescription>
              </DialogHeader>

              <form className="grid gap-4" onSubmit={handleSubmit} aria-busy={loading} noValidate>
                {formError ? (
                  <p className="text-destructive text-sm" role="alert">
                    {formError}
                  </p>
                ) : null}

                <div className="grid gap-2">
                  <Label htmlFor={categoryId}>Category</Label>
                  <select
                    id={categoryId}
                    name="category"
                    required
                    value={category}
                    onChange={(event) => {
                      setCategory(event.target.value as FeedbackCategory)
                      clearFieldError("category")
                    }}
                    disabled={loading}
                    aria-invalid={errors.category ? true : undefined}
                    aria-describedby={errors.category ? `${categoryId}-error` : undefined}
                    className="app-select"
                  >
                    {FEEDBACK_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {FEEDBACK_CATEGORY_LABELS[value]}
                      </option>
                    ))}
                  </select>
                  {errors.category ? (
                    <p className="text-destructive text-sm" id={`${categoryId}-error`} role="alert">
                      {errors.category}
                    </p>
                  ) : null}
                </div>

                <TextareaField
                  id={messageId}
                  label="Message"
                  hint={`At least ${FEEDBACK_LIMITS.messageMin} characters.`}
                  error={errors.message}
                  rows={5}
                  maxLength={FEEDBACK_LIMITS.messageMax}
                  showCount
                  required
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value)
                    clearFieldError("message")
                  }}
                  disabled={loading}
                />

                <div className="grid gap-2">
                  <Label htmlFor={emailId}>
                    Email <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id={emailId}
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      clearFieldError("email")
                    }}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? `${emailId}-error` : undefined}
                    disabled={loading}
                  />
                  {errors.email ? (
                    <p className="text-destructive text-sm" id={`${emailId}-error`} role="alert">
                      {errors.email}
                    </p>
                  ) : null}
                </div>

                {/* Honeypot: hidden from humans, tempting to bots. Keep it empty. */}
                <div
                  className="absolute top-0 -left-[9999px] h-0 w-0 overflow-hidden"
                  aria-hidden="true"
                >
                  <label htmlFor={`${id}-website`}>Website</label>
                  <input
                    id={`${id}-website`}
                    name={HONEYPOT_FIELD}
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                  />
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline" disabled={loading}>
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Sending…" : "Submit"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
