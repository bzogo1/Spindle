"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { HONEYPOT_FIELD } from "@/lib/site-form-constants"
import type { NpsSource } from "@/lib/nps"
import { cn } from "@/lib/utils"

/**
 * NPS survey widget: a 0–10 "how likely are you to recommend us" scale plus an
 * optional follow-up comment, posted to /api/nps.
 *
 * `variant="floating"` renders a dismissible card (intended for fixed
 * placement by a host); `variant="page"` renders the same survey inline for
 * the standalone /app/nps page. Both remember dismissal/response in
 * localStorage so a user is never nagged twice — the page variant still shows
 * the survey when revisited, since reaching it is itself an explicit ask.
 *
 * The comment limit mirrors NPS_COMMENT_MAX in `@/lib/nps`; the server is the
 * source of truth and re-validates everything. `source` is type-only imported
 * so zod stays out of the client bundle.
 *
 * ENTRY POINTS: `variant="page"` is rendered by /app/nps. `variant="floating"`
 * is exported for a host (app shell / site layout) to mount — no nav or layout
 * file is owned by this feature, so wiring the mount point and any link to
 * /app/nps is left to the integrating change.
 */

const COMMENT_MAX = 2000
const STORAGE_KEY = "spindle.nps.v1"
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

type Variant = "floating" | "page"
type Phase = "picking" | "comment" | "success"

type StoredState = {
  status: "dismissed" | "submitted"
  score?: number
  at: string
}

function readStoredState(): StoredState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredState>
    if (parsed.status !== "dismissed" && parsed.status !== "submitted") return null
    return parsed as StoredState
  } catch {
    return null
  }
}

function writeStoredState(state: StoredState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private mode / quota errors: the survey still works for this session.
  }
}

export function NpsSurvey({
  variant = "floating",
  source = "widget",
}: {
  variant?: Variant
  source?: NpsSource
}) {
  const id = useId()
  const [phase, setPhase] = useState<Phase>("picking")
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const [honeypot, setHoneypot] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  // Session-only hide: lets the user dismiss the success card without
  // downgrading the stored "submitted" record to "dismissed".
  const [closed, setClosed] = useState(false)
  // null = storage not yet read; floating waits for it to avoid a flash.
  const [stored, setStored] = useState<StoredState | null | "loading">("loading")
  const scoreRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    setStored(readStoredState())
  }, [])

  const isPage = variant === "page"
  // The floating card stays hidden until storage is read, and stays hidden
  // forever once the user dismissed or submitted — except for the in-session
  // success message right after a submit. The page variant always renders:
  // reaching it is an explicit ask, and repeat answers are allowed.
  const hidden =
    !isPage && (closed || stored === "loading" || (stored !== null && phase !== "success"))

  function persist(status: StoredState["status"], selected?: number | null) {
    const next: StoredState = {
      status,
      score: selected ?? undefined,
      at: new Date().toISOString(),
    }
    writeStoredState(next)
    setStored(next)
  }

  function dismiss() {
    setClosed(true)
    // After a successful submit the stored record stays "submitted" — closing
    // the thanks card must not erase the fact that feedback was sent.
    persist(phase === "success" ? "submitted" : "dismissed", score)
  }

  function selectScore(next: number) {
    setScore(next)
    setError("")
    setPhase("comment")
  }

  function handleScoreKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { key } = event
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) {
      return
    }
    event.preventDefault()
    const current = score ?? -1
    let next: number
    if (key === "Home") {
      next = 0
    } else if (key === "End") {
      next = SCORES.length - 1
    } else {
      const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1
      // With nothing selected yet, treat the cursor as just off either end so
      // the first arrow press lands on 0 (right/down) or 10 (left/up).
      const base = current < 0 ? (delta > 0 ? -1 : SCORES.length) : current
      next = Math.min(SCORES.length - 1, Math.max(0, base + delta))
    }
    scoreRefs.current[next]?.focus()
    selectScore(next)
  }

  async function handleSubmit() {
    if (score === null || submitting) return
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score,
          comment: comment.trim() || undefined,
          source,
          [HONEYPOT_FIELD]: honeypot,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean
        message?: string
      } | null

      if (response.ok && data?.ok) {
        setPhase("success")
        persist("submitted", score)
        return
      }

      setError(data?.message ?? "Something went wrong. Please try again.")
    } catch {
      setError("Something went wrong. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!isPage && hidden) return null

  const containerClass = isPage
    ? "mx-auto w-full max-w-xl rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
    : "fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-lg border bg-card p-4 text-card-foreground shadow-lg"

  return (
    <section className={containerClass} aria-label="Product feedback survey" data-variant={variant}>
      {!isPage && (
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 absolute top-2 right-2 rounded-md p-1 transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label="Dismiss survey"
          onClick={dismiss}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}

      {phase === "success" ? (
        <p className="pr-6 text-sm" role="status">
          Thanks for the feedback — it helps us improve.
        </p>
      ) : (
        <>
          <h2 className="pr-6 text-sm font-semibold">
            How likely are you to recommend Spindle to a colleague?
          </h2>
          <p className="text-muted-foreground mt-1 text-xs" id={`${id}-scale-hint`}>
            0 = not at all likely, 10 = extremely likely
          </p>

          <div
            role="group"
            aria-label="Score from 0 to 10"
            aria-describedby={`${id}-scale-hint`}
            className="mt-3 flex items-center justify-between gap-1"
            onKeyDown={handleScoreKeyDown}
          >
            {SCORES.map((value, index) => (
              <button
                key={value}
                ref={(el) => {
                  scoreRefs.current[index] = el
                }}
                type="button"
                aria-pressed={score === value}
                aria-label={`${value} out of 10`}
                disabled={submitting}
                onClick={() => selectScore(value)}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  "disabled:pointer-events-none disabled:opacity-50",
                  score === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          {phase === "comment" && score !== null && (
            <div className="mt-4">
              <label htmlFor={`${id}-comment`} className="text-xs font-medium">
                Anything we should know? <span className="text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id={`${id}-comment`}
                className="mt-1.5"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value)
                  if (error) setError("")
                }}
                placeholder="Tell us what went well or what we could improve."
                maxLength={COMMENT_MAX}
                showCount
                rows={3}
                disabled={submitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              {error && (
                <p className="text-destructive mt-1.5 text-xs" id={`${id}-error`} role="alert">
                  {error}
                </p>
              )}
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

              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhase("picking")
                    setScore(null)
                  }}
                  disabled={submitting}
                >
                  Back
                </Button>
                <Button type="button" size="sm" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Sending…" : "Send feedback"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
