"use client"

import { useId, useRef, useState, type FormEvent } from "react"
import { CheckCircle2, MessageSquarePlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { useToast } from "@/components/ui/toast"

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
 * Page-scoped feedback dialog. Reuses the same `/api/feedback` endpoint,
 * categories, and honeypot as the floating FeedbackWidget, but lives in the
 * page toolbar and tags submissions with the current path via a `page` field
 * (the server schema strips unknown keys, so it is forward-compatible).
 */
export function PageFeedbackDialog({
  open,
  onOpenChange,
  pageTitle,
  pagePath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageTitle: string
  pagePath: string
}) {
  const id = useId()
  const categoryId = `${id}-category`
  const messageId = `${id}-message`
  const emailId = `${id}-email`
  const { toast } = useToast()

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
    onOpenChange(next)
    // Closing after a successful send resets so the next open is a fresh form.
    if (!next && status === "success") resetForm()
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
          page: pagePath,
          pageTitle,
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
        toast({ variant: "success", title: "Thanks — your feedback was sent." })
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status === "success" ? (
          <div className="grid gap-4" role="status">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="text-chart-2 size-5" aria-hidden="true" />
                Thanks for the feedback
              </DialogTitle>
              <DialogDescription>
                Your note about “{pageTitle}” was sent to the team.
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
              <DialogTitle className="flex items-center gap-2">
                <MessageSquarePlus className="size-4" aria-hidden="true" />
                Feedback on {pageTitle}
              </DialogTitle>
              <DialogDescription>
                Report a bug or share an idea about this page.
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
                required
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value)
                  clearFieldError("message")
                }}
                disabled={loading}
                error={errors.message}
                rows={4}
                maxLength={FEEDBACK_LIMITS.messageMax}
              />

              <div className="grid gap-2">
                <Label htmlFor={emailId}>Email (optional)</Label>
                <Input
                  id={emailId}
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    clearFieldError("email")
                  }}
                  disabled={loading}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? `${emailId}-error` : undefined}
                />
                {errors.email ? (
                  <p className="text-destructive text-sm" id={`${emailId}-error`} role="alert">
                    {errors.email}
                  </p>
                ) : null}
              </div>

              {/* Honeypot — hidden from users, bots fill it in. */}
              <input
                type="text"
                name={HONEYPOT_FIELD}
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Sending…" : "Send feedback"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Small toolbar button that opens the page feedback dialog. */
export function PageFeedbackButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onOpen}
      aria-label="Send feedback about this page"
    >
      <MessageSquarePlus aria-hidden="true" />
      Feedback
    </Button>
  )
}
