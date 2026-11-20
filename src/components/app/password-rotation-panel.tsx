"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { PasswordRotationPolicy, PasswordRotationStatus } from "@/lib/password-rotation"

/**
 * "Password rotation" panel for `/app/security/policies`: lets the
 * signed-in user configure how long passwords may live and how many
 * previous passwords are blocked from reuse, saving through
 * `PUT /api/auth/password/rotation`. Enforcement lives in the sign-in and
 * credential-write routes — see `src/lib/password-rotation.ts` for the
 * integration points.
 */

const ROTATION_API = "/api/auth/password/rotation"

// Local copy of DEFAULT_PASSWORD_ROTATION_POLICY — the lib module imports
// node:crypto (via @/lib/auth/password) and must stay server-only, so the client
// panel cannot import its values. Keep in sync with the lib default.
const DEFAULT_POLICY: PasswordRotationPolicy = {
  maxPasswordAgeDays: 0,
  passwordHistoryCount: 0,
}

interface RotationResponse {
  ok: boolean
  policy?: PasswordRotationPolicy
  status?: PasswordRotationStatus
  message?: string
}

const MAX_AGE_OPTIONS = [
  { value: "0", label: "Never expires" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "365 days" },
] as const

const HISTORY_OPTIONS = [
  { value: "0", label: "No history (reuse allowed)" },
  { value: "1", label: "Last 1 password" },
  { value: "3", label: "Last 3 passwords" },
  { value: "5", label: "Last 5 passwords" },
  { value: "10", label: "Last 10 passwords" },
] as const

function statusLine(status: PasswordRotationStatus | null): string {
  if (!status) return ""
  if (status.policy.maxPasswordAgeDays === 0) {
    return "No rotation policy — passwords do not expire."
  }
  if (status.passwordChangedAt === null) {
    // Enforcement is planned, not wired: with no recorded change date we
    // cannot say a change is required — say so honestly.
    return "Password age is not tracked yet — no change is currently required. The last-changed date is recorded once password-change flows are wired."
  }
  if (status.changeRequired) {
    return "Password is past the maximum age — a change will be required once rotation enforcement is enabled."
  }
  const lastChanged = new Date(status.passwordChangedAt).toLocaleDateString()
  const expiry =
    status.daysRemaining === null
      ? ""
      : status.daysRemaining <= 0
        ? "expires today"
        : `expires in ${status.daysRemaining} day${status.daysRemaining === 1 ? "" : "s"}`
  return `Password last changed ${lastChanged} — ${expiry} once enforcement is enabled.`
}

export function PasswordRotationPanel() {
  const [policy, setPolicy] = useState<PasswordRotationPolicy | null>(null)
  const [status, setStatus] = useState<PasswordRotationStatus | null>(null)
  const [form, setForm] = useState<PasswordRotationPolicy>(DEFAULT_POLICY)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyResponse = useCallback((data: RotationResponse) => {
    if (data.policy) {
      setPolicy(data.policy)
      setForm(data.policy)
    }
    if (data.status) setStatus(data.status)
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(ROTATION_API, { cache: "no-store" })
      const data = (await response.json()) as RotationResponse
      if (!response.ok || !data.ok || !data.policy || !data.status) {
        setError(data.message ?? "Could not load password rotation settings.")
        return
      }
      applyResponse(data)
    } catch {
      setError("Could not load password rotation settings. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }, [applyResponse])

  useEffect(() => {
    void load()
  }, [load])

  const dirty =
    policy !== null &&
    (form.maxPasswordAgeDays !== policy.maxPasswordAgeDays ||
      form.passwordHistoryCount !== policy.passwordHistoryCount)

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(ROTATION_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = (await response.json()) as RotationResponse
      if (!response.ok || !data.ok || !data.policy) {
        setError(data.message ?? "Could not save password rotation settings.")
        return
      }
      applyResponse(data)
      setNotice("Password rotation settings saved.")
    } catch {
      setError("Could not save password rotation settings. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const loading = policy === null && error === null

  return (
    <section className="app-panel" aria-labelledby="password-rotation-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="password-rotation-heading">Password rotation</h2>
          <p>
            Require periodic password changes and block reuse of recent passwords. Settings are
            stored now; enforcement on the sign-in and password-change routes is planned.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty || loading}
            onClick={() => void save()}
          >
            <KeyRound aria-hidden="true" />
            {busy ? "Saving…" : "Save rotation"}
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Password rotation unavailable"
          message={error}
          action={
            policy === null ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            ) : undefined
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
          Loading password rotation settings…
        </p>
      ) : (
        <div className="grid gap-5">
          <p className="app-field-hint" role="status" data-testid="rotation-status">
            {statusLine(status)}
          </p>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="rotation-max-age" className="app-usage-meter-label">
                Maximum password age
              </Label>
              <select
                id="rotation-max-age"
                className="w-40"
                value={String(form.maxPasswordAgeDays)}
                disabled={busy}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maxPasswordAgeDays: Number(event.target.value),
                  }))
                }
                aria-describedby="rotation-max-age-hint"
              >
                {MAX_AGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="app-field-hint" id="rotation-max-age-hint">
              Once enforced, passwords older than this limit require a change at sign-in. Choose
              “Never expires” to disable rotation.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="rotation-history" className="app-usage-meter-label">
                Prevent password reuse
              </Label>
              <select
                id="rotation-history"
                className="w-48"
                value={String(form.passwordHistoryCount)}
                disabled={busy}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    passwordHistoryCount: Number(event.target.value),
                  }))
                }
                aria-describedby="rotation-history-hint"
              >
                {HISTORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="app-field-hint" id="rotation-history-hint">
              Once enforced, new passwords matching any of the most recent passwords are rejected at
              credential-write time. History starts recording after this setting is saved and a
              password change is recorded.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
