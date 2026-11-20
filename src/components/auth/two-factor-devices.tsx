"use client"

import { useCallback, useEffect, useState } from "react"
import { MonitorSmartphone, ShieldCheck, Smartphone, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, request } from "@/lib/api/client"

/**
 * "Two-factor devices" panel for `/app/security`: lists the signed-in user's
 * trusted devices (fingerprints allowed to skip the TOTP challenge), lets
 * them trust the current device, and revoke devices individually or all at
 * once. All state lives server-side behind `/api/auth/2fa/devices*`; this
 * component only fetches and posts.
 *
 * Trusting a device requires a FRESH 6-digit authenticator code — the API
 * verifies it via `verifyUserTotp` because sessions issued through
 * passwordless/OAuth never pass through the TOTP challenge. The panel
 * collects that code inline before calling POST .../trust. The raw
 * fingerprint digest is never sent to or received by the client; the server
 * binds trust to the fingerprint this session registered via
 * /api/auth/fingerprint.
 */

const DEVICES_API = "/api/auth/2fa/devices"

export type TrustedDeviceView = {
  id: string
  label: string
  fingerprintVersion: string
  createdAt: string
  lastUsedAt: string
}

type DevicesResponse = {
  ok: boolean
  totpEnabled?: boolean
  devices?: TrustedDeviceView[]
  currentDevice?: { trusted: boolean; deviceId: string | null }
  device?: TrustedDeviceView
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

export function TwoFactorDevicesPanel() {
  const [devices, setDevices] = useState<TrustedDeviceView[] | null>(null)
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  const [trustOpen, setTrustOpen] = useState(false)
  const [totpCode, setTotpCode] = useState("")
  const [trustError, setTrustError] = useState<string | null>(null)

  const applyResponse = useCallback((data: DevicesResponse) => {
    // `request` throws on non-2xx, so a resolved response is always a success
    // payload — there is no ok:false branch to handle here.
    if (data.devices) setDevices(data.devices)
    if (data.totpEnabled !== undefined) setTotpEnabled(data.totpEnabled)
    if (data.currentDevice) setCurrentDeviceId(data.currentDevice.deviceId)
    if (data.device) {
      // Trust response carries the upserted device; merge it into the list.
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
      const data = await request<DevicesResponse>("", DEVICES_API)
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
      const data = await request<DevicesResponse>("", url, options)
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
    setTotpCode("")
    setTrustError(null)
  }

  function closeTrustForm() {
    setTrustOpen(false)
    setTotpCode("")
    setTrustError(null)
  }

  async function submitTrust() {
    const code = totpCode.replace(/\s/g, "")
    if (!/^\d{6}$/.test(code)) {
      setTrustError("Enter the 6-digit code from your authenticator.")
      return
    }
    setBusy(true)
    setTrustError(null)
    setError(null)
    try {
      const data = await request<DevicesResponse>("", `${DEVICES_API}/trust`, {
        method: "POST",
        body: { totpCode: code },
      })
      applyResponse(data)
      setTrustOpen(false)
      setTotpCode("")
    } catch (failure) {
      setTrustError(errorMessage(failure, "Could not trust this device."))
    } finally {
      setBusy(false)
    }
  }

  function revoke(device: TrustedDeviceView) {
    void post(`${DEVICES_API}/${device.id}`, { method: "DELETE" }).then((ok) => {
      if (ok) {
        setDevices((current) => current?.filter((entry) => entry.id !== device.id) ?? null)
        if (currentDeviceId === device.id) setCurrentDeviceId(null)
      }
    })
  }

  function revokeAll() {
    void post(`${DEVICES_API}/revoke-all`, { method: "POST", body: {} }).then((ok) => {
      if (ok) {
        setDevices([])
        setCurrentDeviceId(null)
        setConfirmRevokeAll(false)
      }
    })
  }

  const loading = devices === null && error === null
  const currentDeviceTrusted = currentDeviceId !== null
  const canTrust = totpEnabled === true && !currentDeviceTrusted

  return (
    <section className="app-panel" aria-labelledby="two-factor-devices-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="two-factor-devices-heading">Two-factor devices</h2>
          <p>
            Devices you trust can skip the authenticator-code step at sign-in. They still need your
            password, and you can revoke them here at any time.
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
          <Label htmlFor="trust-device-totp">Authenticator code</Label>
          <Input
            id="trust-device-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            placeholder="123456"
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
            disabled={busy}
          />
          <p className="app-field-hint">
            Enter the 6-digit code from your authenticator app to confirm this device.
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
            <Button
              type="button"
              size="sm"
              disabled={busy || totpCode.replace(/\s/g, "").length !== 6}
              onClick={() => void submitTrust()}
            >
              {busy ? "Verifying…" : "Trust this device"}
            </Button>
          </div>
        </div>
      ) : null}

      {!error && !loading && !trustOpen && totpEnabled === false ? (
        <EmptyState
          icon={<Smartphone aria-hidden="true" />}
          title="Two-factor authentication is off"
          body="Enable two-factor authentication in account settings to trust devices and skip the authenticator step at sign-in."
        />
      ) : null}

      {!error &&
      !loading &&
      !trustOpen &&
      totpEnabled !== false &&
      devices &&
      devices.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone aria-hidden="true" />}
          title="No trusted devices"
          body={
            canTrust
              ? "Trust this device to skip the authenticator step the next time you sign in from it. You'll confirm with a fresh code from your authenticator."
              : "Trusted devices will appear here once you mark a device as safe for two-factor sign-in."
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
                    Added {formatTime(device.createdAt)} · Last used {formatTime(device.lastUsedAt)}
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
