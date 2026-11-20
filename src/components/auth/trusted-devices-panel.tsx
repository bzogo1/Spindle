"use client"

import { useCallback, useEffect, useState } from "react"
import { MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, request } from "@/lib/api/client"
import {
  getDeviceFingerprint,
  registerDeviceFingerprintWithServer,
} from "@/lib/device/fingerprint-client"

/**
 * "Trusted devices" panel for account settings: lists the signed-in user's
 * device-trust grants (fingerprints treated as recognized at sign-in), lets
 * them trust the current device, and revoke devices individually or all at
 * once. All state lives server-side behind `/api/auth/device-trust*`; this
 * component only fetches and posts.
 *
 * Unlike the TOTP trust panel (`two-factor-devices.tsx`), granting trust
 * here needs NO authenticator code: a device-trust grant only reduces
 * sign-in friction (see `DEVICE_TRUST_BENEFITS` in
 * `src/lib/auth/device-trust.ts`) and never bypasses the password step, so a
 * live session is sufficient proof of intent.
 *
 * The raw fingerprint digest is never sent to or received by the client —
 * the server binds trust to the fingerprint this session registered via
 * `/api/auth/fingerprint`. The panel echoes the client-side fingerprint hash
 * as a consistency check only.
 */

const TRUST_API = "/api/auth/device-trust"

export type TrustedDeviceView = {
  id: string
  label: string
  /** Masked digest, e.g. "fp1:9f86d0…f2a1" — never the raw hash. */
  fingerprint: string | null
  fingerprintVersion: string
  level: string
  grantedAt: string
  expiresAt: string
  lastSeenAt: string
}

type TrustResponse = {
  ok: boolean
  devices?: TrustedDeviceView[]
  currentDevice?: { trusted: boolean; deviceId: string | null }
  device?: TrustedDeviceView
  revoked?: number
  message?: string
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

/** Surfaces the server's error message when the request failed with one. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  return fallback
}

export function TrustedDevicesPanel() {
  const [devices, setDevices] = useState<TrustedDeviceView[] | null>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  const [trustOpen, setTrustOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [trustError, setTrustError] = useState<string | null>(null)

  const applyResponse = useCallback((data: TrustResponse) => {
    // `request` throws on non-2xx, so a resolved response is always a success
    // payload — there is no ok:false branch to handle here.
    if (data.devices) setDevices(data.devices)
    if (data.currentDevice) setCurrentDeviceId(data.currentDevice.deviceId)
    if (data.device) {
      // Grant response carries the upserted device; merge it into the list.
      setDevices((current) => {
        const list = current ?? []
        const index = list.findIndex((entry) => entry.id === data.device!.id)
        if (index === -1) return [data.device!, ...list]
        const next = [...list]
        next[index] = data.device!
        return next
      })
      setCurrentDeviceId(data.device.id)
    }
    setError(null)
    return true
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await request<TrustResponse>("", TRUST_API)
      applyResponse(data)
      setDevices((current) => current ?? [])
    } catch (failure) {
      setError(errorMessage(failure, "Could not load trusted devices."))
      setDevices([])
    } finally {
      setBusy(false)
    }
  }, [applyResponse])

  useEffect(() => {
    void load()
  }, [load])

  async function post(
    url: string,
    options: { method?: "POST" | "DELETE"; body?: unknown } = {},
  ): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const data = await request<TrustResponse>("", url, options)
      return applyResponse(data)
    } catch (failure) {
      setError(errorMessage(failure, "Could not update trusted devices."))
      return false
    } finally {
      setBusy(false)
    }
  }

  function openTrustForm() {
    setTrustOpen(true)
    setLabel("")
    setTrustError(null)
  }

  function closeTrustForm() {
    setTrustOpen(false)
    setLabel("")
    setTrustError(null)
  }

  async function submitTrust() {
    setBusy(true)
    setTrustError(null)
    setError(null)
    try {
      // Make sure this session has a registered fingerprint record so the
      // server can bind the grant to THIS device. Best-effort: the POST
      // fails cleanly with `fingerprint_required` if registration cannot
      // complete.
      await registerDeviceFingerprintWithServer()
      const fingerprint = await getDeviceFingerprint()
      const data = await request<TrustResponse>("", TRUST_API, {
        method: "POST",
        body: {
          ...(label.trim() ? { label: label.trim() } : {}),
          fingerprint: fingerprint.hash,
        },
      })
      applyResponse(data)
      setTrustOpen(false)
      setLabel("")
    } catch (failure) {
      setTrustError(errorMessage(failure, "Could not trust this device."))
    } finally {
      setBusy(false)
    }
  }

  function revoke(device: TrustedDeviceView) {
    void post(`${TRUST_API}/${device.id}`, { method: "DELETE" }).then((ok) => {
      if (ok) {
        setDevices((current) => current?.filter((entry) => entry.id !== device.id) ?? null)
        if (currentDeviceId === device.id) setCurrentDeviceId(null)
      }
    })
  }

  function revokeAll() {
    void post(TRUST_API, { method: "DELETE" }).then((ok) => {
      if (ok) {
        setDevices([])
        setCurrentDeviceId(null)
        setConfirmRevokeAll(false)
      }
    })
  }

  const loading = devices === null && error === null
  const currentDeviceTrusted = currentDeviceId !== null
  const canTrust = !currentDeviceTrusted

  return (
    <section className="app-panel" aria-labelledby="trusted-devices-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="trusted-devices-heading">Trusted devices</h2>
          <p>
            Devices you recognize get reduced sign-in friction — fewer security prompts and alerts.
            They still need your password, and you can revoke them here at any time.
          </p>
        </div>
        <div className="app-panel-head-actions">
          {canTrust && !trustOpen ? (
            <Button type="button" size="sm" disabled={busy} onClick={openTrustForm}>
              <ShieldCheck aria-hidden="true" />
              Trust this device
            </Button>
          ) : null}
          {(devices?.length ?? 0) > 0 && !trustOpen ? (
            confirmRevokeAll ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmRevokeAll(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={revokeAll}
                >
                  Confirm revoke all
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmRevokeAll(true)}
              >
                <Trash2 aria-hidden="true" />
                Revoke all
              </Button>
            )
          ) : null}
        </div>
      </div>

      {error ? (
        <InlineError
          title="Trusted devices unavailable"
          message={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {/* The list/empty states are suppressed while an error is shown so the
          two never render together after a failed load. */}
      {!error && loading ? (
        <p className="app-field-hint" role="status">
          Loading trusted devices…
        </p>
      ) : null}

      {!error && !loading && trustOpen ? (
        <div className="app-field" aria-live="polite">
          <Label htmlFor="trust-device-label">Device label (optional)</Label>
          <Input
            id="trust-device-label"
            maxLength={60}
            placeholder="Work laptop"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
          <p className="app-field-hint">
            Mark this device as trusted for 30 days. It will still need your password at sign-in.
          </p>
          {trustError ? (
            <p className="app-field-hint" role="alert">
              {trustError}
            </p>
          ) : null}
          <div className="app-form-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={closeTrustForm}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void submitTrust()}>
              {busy ? "Trusting…" : "Trust this device"}
            </Button>
          </div>
        </div>
      ) : null}

      {!error && !loading && !trustOpen && devices && devices.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone aria-hidden="true" />}
          title="No trusted devices"
          body={
            canTrust
              ? "Trust this device to get reduced sign-in friction the next time you sign in from it. It still needs your password."
              : "Trusted devices will appear here once you mark a device as safe to sign in from."
          }
        />
      ) : null}

      {!error && !loading && !trustOpen && devices && devices.length > 0 ? (
        <ul className="grid gap-3" aria-label="Trusted devices">
          {devices.map((device) => (
            <li key={device.id} className="app-panel-alt border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{device.label}</strong>
                    {device.id === currentDeviceId ? (
                      <Badge variant="secondary" size="sm">
                        This device
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {device.fingerprint ? `${device.fingerprint} · ` : ""}
                    Trusted until {formatTime(device.expiresAt)} · Last used{" "}
                    {formatTime(device.lastSeenAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => revoke(device)}
                  aria-label={`Revoke ${device.label}`}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
