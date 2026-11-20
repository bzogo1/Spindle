"use client"

import { useCallback, useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  DEFAULT_SECURITY_POLICIES,
  type SecurityPolicies,
  type SignInWindow,
} from "@/lib/auth/security-policies"

/**
 * "Sign-in security policies" panel for `/app/security/policies`: lets the
 * signed-in user configure their own login policies (2FA requirement,
 * session cap, allowed sign-in window, minimum password length) and save
 * them through `PUT /api/auth/policies`. Enforcement hooks live in the
 * sign-in/session routes — see `src/lib/auth/security-policies.ts` for
 * which fields are enforced vs advisory.
 */

const POLICIES_API = "/api/auth/policies"

interface PoliciesResponse {
  ok: boolean
  policies?: SecurityPolicies
  message?: string
}

/** Editable form state — numeric/window fields are strings so inputs can be empty. */
interface PolicyFormState {
  requireTwoFactor: boolean
  sessionMaxAgeHours: string
  windowEnabled: boolean
  windowStart: string
  windowEnd: string
  minPasswordLength: string
}

function toFormState(policies: SecurityPolicies): PolicyFormState {
  return {
    requireTwoFactor: policies.requireTwoFactor,
    sessionMaxAgeHours:
      policies.sessionMaxAgeHours === null ? "" : String(policies.sessionMaxAgeHours),
    windowEnabled: policies.allowedSignInWindow !== null,
    windowStart: policies.allowedSignInWindow?.start ?? "09:00",
    windowEnd: policies.allowedSignInWindow?.end ?? "17:00",
    minPasswordLength:
      policies.minPasswordLength === null ? "" : String(policies.minPasswordLength),
  }
}

function parseHours(value: string): number | null | "invalid" {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24 * 365) return "invalid"
  return parsed
}

function parsePasswordLength(value: string): number | null | "invalid" {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 8 || parsed > 128) return "invalid"
  return parsed
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function buildPolicies(form: PolicyFormState): SecurityPolicies | "invalid" {
  const sessionMaxAgeHours = parseHours(form.sessionMaxAgeHours)
  const minPasswordLength = parsePasswordLength(form.minPasswordLength)
  if (sessionMaxAgeHours === "invalid" || minPasswordLength === "invalid") return "invalid"

  let allowedSignInWindow: SignInWindow | null = null
  if (form.windowEnabled) {
    const start = form.windowStart.trim()
    const end = form.windowEnd.trim()
    if (!HHMM.test(start) || !HHMM.test(end) || start === end) return "invalid"
    allowedSignInWindow = { start, end }
  }

  return {
    requireTwoFactor: form.requireTwoFactor,
    sessionMaxAgeHours,
    allowedSignInWindow,
    minPasswordLength,
  }
}

export function SecurityPoliciesPanel() {
  const [saved, setSaved] = useState<SecurityPolicies | null>(null)
  const [form, setForm] = useState<PolicyFormState>(() => toFormState(DEFAULT_SECURITY_POLICIES))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(POLICIES_API, { cache: "no-store" })
      const data = (await response.json()) as PoliciesResponse
      if (!response.ok || !data.ok || !data.policies) {
        setError(data.message ?? "Could not load security policies.")
        return
      }
      setSaved(data.policies)
      setForm(toFormState(data.policies))
    } catch {
      setError("Could not load security policies. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const candidate = buildPolicies(form)
  // An invalid candidate still counts as dirty so Save stays clickable and
  // surfaces the validation error instead of silently disabling.
  const dirty = saved !== null && JSON.stringify(candidate) !== JSON.stringify(saved)

  async function save() {
    const policies = buildPolicies(form)
    if (policies === "invalid") {
      setError(
        "Check the policy values — hours must be whole numbers, times HH:MM, and password length at least 8.",
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(POLICIES_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policies),
      })
      const data = (await response.json()) as PoliciesResponse
      if (!response.ok || !data.ok || !data.policies) {
        setError(data.message ?? "Could not save security policies.")
        return
      }
      setSaved(data.policies)
      setForm(toFormState(data.policies))
      setNotice("Security policies saved.")
    } catch {
      setError("Could not save security policies. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const loading = saved === null && error === null

  function patch(patchForm: Partial<PolicyFormState>) {
    setNotice(null)
    setForm((current) => ({ ...current, ...patchForm }))
  }

  return (
    <section className="app-panel" aria-labelledby="security-policies-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="security-policies-heading">Sign-in security policies</h2>
          <p>
            Configure the sign-in rules your account applies. Enforcement on the sign-in routes is
            planned; policies are stored now.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty || loading}
            onClick={() => void save()}
          >
            <ShieldCheck aria-hidden="true" />
            {busy ? "Saving…" : "Save policies"}
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Security policies unavailable"
          message={error}
          action={
            saved === null ? (
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
          Loading security policies…
        </p>
      ) : (
        <div className="grid gap-5">
          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="policy-require-2fa" className="app-usage-meter-label">
                Require two-factor authentication
              </Label>
              <Switch
                id="policy-require-2fa"
                aria-label="Require two-factor authentication"
                checked={form.requireTwoFactor}
                disabled={busy}
                onCheckedChange={(checked) => patch({ requireTwoFactor: checked })}
              />
            </div>
            <p className="app-field-hint" id="policy-require-2fa-hint">
              Once enforced on the sign-in routes, attempts on accounts without TOTP are routed to
              two-factor enrollment instead of issuing a session.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="policy-session-hours" className="app-usage-meter-label">
                Maximum session age (hours)
              </Label>
              <Input
                id="policy-session-hours"
                className="w-28"
                type="number"
                inputMode="numeric"
                min={1}
                max={8760}
                placeholder="No limit"
                value={form.sessionMaxAgeHours}
                disabled={busy}
                onChange={(event) => patch({ sessionMaxAgeHours: event.target.value })}
                aria-describedby="policy-session-hours-hint"
              />
            </div>
            <p className="app-field-hint" id="policy-session-hours-hint">
              Leave empty for no policy cap. Longer “remember me” sessions will be shortened to this
              limit once enforcement is enabled.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="policy-window-enabled" className="app-usage-meter-label">
                Restrict sign-in hours
              </Label>
              <Switch
                id="policy-window-enabled"
                aria-label="Restrict sign-in hours"
                checked={form.windowEnabled}
                disabled={busy}
                onCheckedChange={(checked) => patch({ windowEnabled: checked })}
              />
            </div>
            {form.windowEnabled ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="policy-window-start" className="text-muted-foreground text-xs">
                    From (UTC)
                  </Label>
                  <Input
                    id="policy-window-start"
                    type="time"
                    className="w-32"
                    value={form.windowStart}
                    disabled={busy}
                    onChange={(event) => patch({ windowStart: event.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="policy-window-end" className="text-muted-foreground text-xs">
                    Until (UTC)
                  </Label>
                  <Input
                    id="policy-window-end"
                    type="time"
                    className="w-32"
                    value={form.windowEnd}
                    disabled={busy}
                    onChange={(event) => patch({ windowEnd: event.target.value })}
                  />
                </div>
              </div>
            ) : null}
            <p className="app-field-hint">
              Sign-ins are only accepted inside this window (overnight windows like 22:00–06:00 are
              supported). Advisory until enforced on the sign-in routes.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="policy-min-password" className="app-usage-meter-label">
                Minimum password length
              </Label>
              <Input
                id="policy-min-password"
                className="w-28"
                type="number"
                inputMode="numeric"
                min={8}
                max={128}
                placeholder="Default"
                value={form.minPasswordLength}
                disabled={busy}
                onChange={(event) => patch({ minPasswordLength: event.target.value })}
                aria-describedby="policy-min-password-hint"
              />
            </div>
            <p className="app-field-hint" id="policy-min-password-hint">
              Applies to new passwords at signup and password reset. Leave empty to use the default
              minimum of 8 characters.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
