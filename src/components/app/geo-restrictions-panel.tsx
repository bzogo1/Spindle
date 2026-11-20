"use client"

import { useCallback, useEffect, useState } from "react"
import { Globe } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  DEFAULT_GEO_RESTRICTIONS,
  type GeoRestrictionsPolicy,
  type ObservedCountry,
} from "@/lib/auth/geo-restrictions"

/**
 * "Geographic login restrictions" panel for `/app/security/policies`:
 * lets the signed-in user configure where sign-ins are allowed from
 * (off / allowlist / blocklist of ISO country codes, optional "block
 * unknown"), saving through `PUT /api/auth/geo`. Enforcement is planned —
 * `evaluateGeoRestriction` in `src/lib/auth/geo-restrictions.ts` is the
 * sign-in integration point; until it is wired the policy is stored but
 * does not block sign-ins.
 */

const GEO_API = "/api/auth/geo"

interface GeoResponse {
  ok: boolean
  policy?: GeoRestrictionsPolicy
  observedCountries?: ObservedCountry[]
  message?: string
}

/** Editable form state — countries are a comma-separated text field. */
interface GeoFormState {
  mode: GeoRestrictionsPolicy["mode"]
  countriesText: string
  blockUnknown: boolean
}

function toFormState(policy: GeoRestrictionsPolicy): GeoFormState {
  return {
    mode: policy.mode,
    countriesText: policy.countryCodes.join(", "),
    blockUnknown: policy.blockUnknown,
  }
}

/**
 * Parses the comma/space-separated country text into normalized codes.
 * Returns `"invalid"` when any token is not a two-letter code.
 */
function parseCountries(text: string): string[] | "invalid" {
  const tokens = text
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  const codes: string[] = []
  for (const token of tokens) {
    if (!/^[A-Za-z]{2}$/.test(token)) return "invalid"
    const code = token.toUpperCase()
    if (!codes.includes(code)) codes.push(code)
  }
  return codes.sort()
}

function buildPolicy(form: GeoFormState): GeoRestrictionsPolicy | "invalid" {
  const countryCodes = parseCountries(form.countriesText)
  if (countryCodes === "invalid") return "invalid"
  if (form.mode !== "off" && countryCodes.length === 0) return "invalid"
  return { mode: form.mode, countryCodes, blockUnknown: form.blockUnknown }
}

const MODE_OPTIONS = [
  { value: "off", label: "Off — no geographic restriction" },
  { value: "allowlist", label: "Allowlist — only listed countries" },
  { value: "blocklist", label: "Blocklist — deny listed countries" },
] as const

function observedLine(entry: ObservedCountry): string {
  const country = entry.country === "unknown" ? "Unknown location" : entry.country
  const count = entry.count === 1 ? "1 sign-in" : `${entry.count} sign-ins`
  const lastSeen = new Date(entry.lastSeenAt).toLocaleDateString()
  return `${country} — ${count}, last seen ${lastSeen}`
}

export function GeoRestrictionsPanel() {
  const [saved, setSaved] = useState<GeoRestrictionsPolicy | null>(null)
  const [observed, setObserved] = useState<ObservedCountry[]>([])
  const [form, setForm] = useState<GeoFormState>(() => toFormState(DEFAULT_GEO_RESTRICTIONS))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(GEO_API, { cache: "no-store" })
      const data = (await response.json()) as GeoResponse
      if (!response.ok || !data.ok || !data.policy) {
        setError(data.message ?? "Could not load geographic restrictions.")
        return
      }
      setSaved(data.policy)
      setObserved(data.observedCountries ?? [])
      setForm(toFormState(data.policy))
    } catch {
      setError("Could not load geographic restrictions. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const candidate = buildPolicy(form)
  const dirty = saved !== null && JSON.stringify(candidate) !== JSON.stringify(saved)

  async function save() {
    const policy = buildPolicy(form)
    if (policy === "invalid") {
      setError(
        "Check the geographic restrictions — mode allowlist/blocklist needs at least one two-letter country code (e.g. US, DE).",
      )
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(GEO_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      })
      const data = (await response.json()) as GeoResponse
      if (!response.ok || !data.ok || !data.policy) {
        setError(data.message ?? "Could not save geographic restrictions.")
        return
      }
      setSaved(data.policy)
      setObserved(data.observedCountries ?? [])
      setForm(toFormState(data.policy))
      setNotice("Geographic restrictions saved.")
    } catch {
      setError("Could not save geographic restrictions. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const loading = saved === null && error === null
  const countriesDisabled = busy || form.mode === "off"

  function patch(patchForm: Partial<GeoFormState>) {
    setNotice(null)
    setForm((current) => ({ ...current, ...patchForm }))
  }

  return (
    <section className="app-panel" aria-labelledby="geo-restrictions-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="geo-restrictions-heading">Geographic login restrictions</h2>
          <p>
            Restrict which countries your account can sign in from. Country is detected from
            platform headers (Cloudflare, Vercel, App Engine); enforcement on the sign-in routes is
            planned.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || !dirty || loading}
            onClick={() => void save()}
          >
            <Globe aria-hidden="true" />
            {busy ? "Saving…" : "Save restrictions"}
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Geographic restrictions unavailable"
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
          Loading geographic restrictions…
        </p>
      ) : (
        <div className="grid gap-5">
          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="geo-mode" className="app-usage-meter-label">
                Restriction mode
              </Label>
              <Select
                id="geo-mode"
                aria-label="Restriction mode"
                options={[...MODE_OPTIONS]}
                value={form.mode}
                disabled={busy}
                onChange={(value) =>
                  patch({
                    mode: (typeof value === "string"
                      ? value
                      : "off") as GeoRestrictionsPolicy["mode"],
                  })
                }
              />
            </div>
            <p className="app-field-hint">
              Off disables geographic checks. Allowlist permits only the listed countries; blocklist
              denies the listed countries.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="geo-countries" className="app-usage-meter-label">
                Country codes
              </Label>
            </div>
            <Input
              id="geo-countries"
              value={form.countriesText}
              disabled={countriesDisabled}
              placeholder="US, DE, UA"
              onChange={(event) => patch({ countriesText: event.target.value })}
              aria-describedby="geo-countries-hint"
            />
            <p className="app-field-hint" id="geo-countries-hint">
              ISO 3166-1 alpha-2 codes separated by commas (e.g. US, DE, UA). Required for allowlist
              and blocklist modes.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <Label htmlFor="geo-block-unknown" className="app-usage-meter-label">
                Block sign-ins from unknown locations
              </Label>
              <Switch
                id="geo-block-unknown"
                aria-label="Block sign-ins from unknown locations"
                checked={form.blockUnknown}
                disabled={busy || form.mode === "off"}
                onCheckedChange={(checked) => patch({ blockUnknown: checked })}
              />
            </div>
            <p className="app-field-hint">
              When the country cannot be determined (no geo headers, private networks), deny the
              sign-in instead of allowing it. Leave off to allow unknown locations — safer for users
              on VPNs and proxies.
            </p>
          </div>

          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <span className="app-usage-meter-label">Observed sign-in countries</span>
            </div>
            {observed.length === 0 ? (
              <p className="app-field-hint">
                No countries observed yet — countries are recorded once sign-in enforcement and
                reporting are wired.
              </p>
            ) : (
              <ul className="grid gap-1">
                {observed.map((entry) => (
                  <li key={entry.country} className="app-field-hint">
                    {observedLine(entry)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="app-field-hint">
            Honest status: geographic enforcement is planned, not active. The policy is stored now;
            the check endpoint at <code>/api/auth/geo/check</code> reports what would happen for
            your current request, and sign-in routes will enforce it once wired.
          </p>
        </div>
      )}
    </section>
  )
}
