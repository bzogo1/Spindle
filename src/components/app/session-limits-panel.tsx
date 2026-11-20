"use client"

import { useCallback, useEffect, useState } from "react"
import { MonitorSmartphone } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  UNLIMITED_SESSION_LIMIT,
} from "@/lib/auth/session-limits"

/**
 * "Concurrent session limit" panel for `/app/security/session-limits`: shows
 * how many active sessions the account currently holds and lets the user cap
 * the number (0 = unlimited). Saved via `PUT /api/auth/session-limits`; the
 * backend enforces the cap inside its session-mint funnel, evicting the
 * oldest session(s) when a new sign-in would exceed the limit.
 */

const LIMITS_API = "/api/auth/session-limits"

interface SessionLimitsResponse {
  ok: boolean
  limit?: number
  unlimited?: boolean
  activeCount?: number
  sessions?: { id: string; createdAt: string; expiresAt: string }[]
  message?: string
}

export function SessionLimitsPanel() {
  const [saved, setSaved] = useState<number | null>(null)
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [form, setForm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(LIMITS_API, { cache: "no-store" })
      const data = (await response.json()) as SessionLimitsResponse
      if (!response.ok || !data.ok || data.limit === undefined) {
        setError(data.message ?? "Could not load session limits.")
        return
      }
      setSaved(data.limit)
      setActiveCount(data.activeCount ?? 0)
      setForm(String(data.limit))
    } catch {
      setError("Could not load session limits. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const parsed = Number(form.trim())
  const candidateValid =
    form.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= UNLIMITED_SESSION_LIMIT &&
    parsed <= MAX_SESSION_LIMIT
  const dirty = saved !== null && form.trim() !== String(saved)

  async function save() {
    if (!candidateValid) {
      setError(`Enter a whole number between 0 (unlimited) and ${MAX_SESSION_LIMIT}.`)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(LIMITS_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: parsed }),
      })
      const data = (await response.json()) as SessionLimitsResponse
      if (!response.ok || !data.ok || data.limit === undefined) {
        setError(data.message ?? "Could not save session limit.")
        return
      }
      setSaved(data.limit)
      setActiveCount(data.activeCount ?? null)
      setForm(String(data.limit))
      setNotice(
        data.limit === UNLIMITED_SESSION_LIMIT
          ? "Unlimited concurrent sessions saved."
          : `Session limit saved: ${data.limit} concurrent session${data.limit === 1 ? "" : "s"}.`,
      )
    } catch {
      setError("Could not save session limit. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const loading = saved === null && error === null
  const unlimited = saved === UNLIMITED_SESSION_LIMIT

  return (
    <section className="app-panel" aria-labelledby="session-limits-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="session-limits-heading">Concurrent session limit</h2>
          <p>
            Cap how many devices can stay signed in to your account at once. When a new sign-in
            would exceed the limit, the oldest session is signed out automatically. Leave at 0 for
            no limit.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty || loading || !candidateValid}
            onClick={() => void save()}
          >
            <MonitorSmartphone aria-hidden="true" />
            {busy ? "Saving…" : "Save limit"}
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Session limits unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              {saved === null ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              ) : null}
            </span>
          }
        />
      ) : null}

      {notice ? (
        <p className="app-field-hint" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="app-field-hint" role="status">
          Loading session limits…
        </p>
      ) : (
        <div className="grid gap-5">
          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <span className="app-usage-meter-label">Active sessions</span>
              <span className="text-muted-foreground text-sm">
                {activeCount ?? 0}
                {unlimited ? "" : ` of ${saved ?? DEFAULT_SESSION_LIMIT}`}
              </span>
            </div>
            <p className="app-field-hint">
              {unlimited
                ? "No cap — every sign-in keeps its own session."
                : saved === 1
                  ? "Only one device can stay signed in; signing in elsewhere signs this one out."
                  : `Up to ${saved} devices can stay signed in at once.`}
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="session-limit-input" className="app-usage-meter-label">
                Maximum concurrent sessions
              </Label>
              <Input
                id="session-limit-input"
                className="w-28"
                type="number"
                inputMode="numeric"
                min={UNLIMITED_SESSION_LIMIT}
                max={MAX_SESSION_LIMIT}
                value={form}
                disabled={busy}
                onChange={(event) => {
                  setNotice(null)
                  setForm(event.target.value)
                }}
                aria-describedby="session-limit-hint"
              />
            </div>
            <p className="app-field-hint" id="session-limit-hint">
              Whole number 0–{MAX_SESSION_LIMIT}. 0 means unlimited; the default when never
              configured is {DEFAULT_SESSION_LIMIT}.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
