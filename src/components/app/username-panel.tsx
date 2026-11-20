"use client"

import { useEffect, useRef, useState } from "react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { request } from "@/lib/api/client"
import {
  normalizeUsername,
  parseUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@/lib/username"

interface UsernameCheckResponse {
  available?: boolean
  username?: string
  error?: string
}

interface UsernameUpdateResponse {
  handle?: string | null
}

const AVAILABILITY_DEBOUNCE_MS = 300

type Availability =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; username: string }
  | { status: "unavailable"; message: string }

/**
 * Editable @handle field for the profile page.
 *
 * Shows the current handle (or a prompt to claim one), validates input with
 * the shared `parseUsername` rules, live-checks availability through
 * `GET /api/username?handle=…` (debounced), and saves through
 * `PUT /api/username`. `onSaved` lets the parent refresh its profile copy.
 */
export function UsernamePanel({
  handle,
  onSaved,
}: {
  handle: string | null
  onSaved?: (handle: string | null) => void
}) {
  const { toast } = useToast()
  const [value, setValue] = useState(handle ?? "")
  const [error, setError] = useState("")
  const [availability, setAvailability] = useState<Availability>({ status: "idle" })
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState("")
  const checkSeq = useRef(0)
  // Set right after a successful save so the prop-resync effect recognizes
  // the echo of our own write and keeps the "saved" note visible.
  const savedEcho = useRef<{ handle: string | null } | null>(null)

  // Resync when the loaded profile changes (e.g. after a refetch).
  useEffect(() => {
    setValue(handle ?? "")
    setError("")
    setAvailability({ status: "idle" })
    if (savedEcho.current && savedEcho.current.handle === (handle ?? null)) {
      savedEcho.current = null
    } else {
      setSavedNote("")
    }
  }, [handle])

  const normalized = normalizeUsername(value)
  const parsed = normalized ? parseUsername(normalized) : null
  const dirty = normalized !== (handle ?? "")

  // Debounced live availability check. Invalid input short-circuits before
  // any request; the sequence counter discards stale responses.
  useEffect(() => {
    if (!parsed?.ok || !dirty) {
      setAvailability({ status: "idle" })
      return
    }
    const seq = ++checkSeq.current
    setAvailability({ status: "checking" })
    const timer = setTimeout(async () => {
      try {
        const body = await request<UsernameCheckResponse>(
          "",
          `/api/username?handle=${encodeURIComponent(parsed.username)}`,
        )
        if (checkSeq.current !== seq) return
        if (body.available) {
          setAvailability({ status: "available", username: body.username ?? parsed.username })
        } else {
          setAvailability({
            status: "unavailable",
            message: body.error ?? "That username is already taken.",
          })
        }
      } catch {
        if (checkSeq.current !== seq) return
        setAvailability({ status: "idle" })
      }
    }, AVAILABILITY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [parsed?.ok ? parsed.username : "", dirty])

  async function submit() {
    const result = parseUsername(value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.username === (handle ?? "")) {
      setError("")
      return
    }

    setSaving(true)
    setError("")
    try {
      const body = await request<UsernameUpdateResponse>("", "/api/username", {
        method: "PUT",
        body: { handle: result.username },
      })
      const next = body.handle ?? null
      setValue(next ?? "")
      savedEcho.current = { handle: next }
      setSavedNote("Username saved.")
      setAvailability({ status: "idle" })
      onSaved?.(next)
      toast({
        title: "Username saved",
        description: next ? `Your handle is now @${next}.` : "Your handle was removed.",
        variant: "success",
      })
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message ? cause.message : "Something went wrong."
      setError(message)
      toast({
        title: "Couldn't save username",
        description: "Something went wrong. Please try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    setError("")
    try {
      await request<UsernameUpdateResponse>("", "/api/username", {
        method: "PUT",
        body: { handle: null },
      })
      setValue("")
      savedEcho.current = { handle: null }
      setSavedNote("Username removed.")
      setAvailability({ status: "idle" })
      onSaved?.(null)
      toast({
        title: "Username removed",
        description: "Your handle is no longer reserved.",
        variant: "success",
      })
    } catch {
      setError("Something went wrong. Please try again.")
      toast({
        title: "Couldn't remove username",
        description: "Something went wrong. Please try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  const availabilityText =
    availability.status === "checking"
      ? "Checking availability…"
      : availability.status === "available"
        ? `@${availability.username} is available.`
        : availability.status === "unavailable"
          ? availability.message
          : ""

  return (
    <div className="app-field">
      <label htmlFor="profile-username">Username</label>
      <div className="app-field-hint" style={{ marginBottom: 6 }}>
        {handle ? (
          <span>
            Current handle: <strong>@{handle}</strong>
          </span>
        ) : (
          "No username yet — claim one so teammates can find you."
        )}
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-muted-foreground">
          @
        </span>
        <Input
          id="profile-username"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setSavedNote("")
            if (error) setError("")
          }}
          placeholder="your_handle"
          maxLength={USERNAME_MAX_LENGTH + 4}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error || availability.status === "unavailable" ? true : undefined}
          aria-describedby={
            error ? "profile-username-hint profile-username-error" : "profile-username-hint"
          }
          onKeyDown={(event) => {
            // Enter saves the handle instead of submitting the outer profile form.
            if (event.key === "Enter") {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </div>
      <p className="app-field-hint" id="profile-username-hint">
        {USERNAME_MIN_LENGTH}–{USERNAME_MAX_LENGTH} characters: lowercase letters, numbers, and
        underscores.
        {availabilityText ? ` ${availabilityText}` : ""}
      </p>
      {error ? <InlineError id="profile-username-error" title={null} message={error} /> : null}
      <div className="app-form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={submit}
          disabled={saving || (!dirty && !error)}
        >
          {saving ? "Saving…" : handle ? "Change username" : "Claim username"}
        </Button>
        {handle ? (
          <Button type="button" variant="ghost" onClick={remove} disabled={saving}>
            Remove username
          </Button>
        ) : null}
        {savedNote ? (
          <p className="app-saved-note" role="status">
            {savedNote}
          </p>
        ) : null}
      </div>
    </div>
  )
}
