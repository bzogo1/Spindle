"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Plus, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, request } from "@/lib/api/client"
import { registerPasskey, webauthnSupported } from "@/lib/webauthn/client"
import type { CredentialView } from "@/lib/webauthn/types"

/**
 * "Passkeys" panel for `/app/security`: registers discoverable
 * (resident-key) credentials — passkeys — against the signed-in account,
 * lists them alongside (but separate from) security keys, and supports
 * rename/revoke through the same `/api/auth/webauthn/*` endpoints.
 *
 * Registration runs the resident-key ceremony via `registerPasskey()`:
 * `POST register/begin {passkey:true}` → `navigator.credentials.create()` →
 * `POST register/complete`. The server marks the stored credential
 * `kind: "passkey"`, which is how this panel filters its list — security
 * keys and passkeys share ONE credential store (multi-device: the same
 * credential works from every device the passkey syncs to, e.g. iCloud
 * Keychain / Google Password Manager).
 *
 * Browsers without WebAuthn get an explicit unsupported state.
 */

const CREDENTIALS_API = "/api/auth/webauthn/credentials"

type Envelope = {
  ok: boolean
  credentials?: CredentialView[]
  credential?: CredentialView
  message?: string
}

function isPasskey(credential: CredentialView): boolean {
  // `kind` is absent only on payloads predating the field; those were all
  // registered as security keys, so they never count as passkeys.
  return credential.kind === "passkey"
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function PasskeysPanel() {
  const [supported] = useState(() => webauthnSupported())
  const [passkeys, setPasskeys] = useState<CredentialView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [label, setLabel] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await request<Envelope>("", CREDENTIALS_API)
      setPasskeys((data.credentials ?? []).filter(isPasskey))
    } catch (failure) {
      setError(errorMessage(failure, "Could not load passkeys."))
      setPasskeys([])
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (supported) void load()
  }, [load, supported])

  async function register() {
    setBusy(true)
    setError(null)
    try {
      const created = await registerPasskey(label)
      setPasskeys((current) => [created, ...(current ?? [])])
      setLabel("")
      setRegistering(false)
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "NotAllowedError") {
        setError("The passkey prompt was dismissed or timed out.")
      } else {
        setError(errorMessage(failure, "Could not register the passkey."))
      }
    } finally {
      setBusy(false)
    }
  }

  async function rename(passkey: CredentialView) {
    const next = renameValue.trim()
    if (!next) {
      setRenamingId(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await request<Envelope>("", `${CREDENTIALS_API}/${passkey.id}`, {
        method: "PATCH",
        body: { label: next },
      })
      if (data.credential) {
        setPasskeys(
          (current) =>
            current?.map((entry) => (entry.id === passkey.id ? data.credential! : entry)) ?? null,
        )
      }
      setRenamingId(null)
      setRenameValue("")
    } catch (failure) {
      setError(errorMessage(failure, "Could not rename the passkey."))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(passkey: CredentialView) {
    setBusy(true)
    setError(null)
    try {
      await request<Envelope>("", `${CREDENTIALS_API}/${passkey.id}`, { method: "DELETE" })
      setPasskeys((current) => current?.filter((entry) => entry.id !== passkey.id) ?? null)
      setConfirmRevokeId(null)
    } catch (failure) {
      setError(errorMessage(failure, "Could not revoke the passkey."))
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <section className="app-panel" aria-labelledby="passkeys-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="passkeys-heading">Passkeys</h2>
            <p>
              Sign in with a passkey — a discoverable credential stored on this device or synced to
              your password manager — instead of a password.
            </p>
          </div>
        </div>
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          title="WebAuthn is not supported here"
          body="This browser does not support passkeys. Try a current version of Chrome, Safari, Firefox, or Edge."
        />
      </section>
    )
  }

  const loading = passkeys === null && error === null

  return (
    <section className="app-panel" aria-labelledby="passkeys-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="passkeys-heading">Passkeys</h2>
          <p>
            Register a passkey for username-less sign-in. Passkeys sync across your devices (iCloud
            Keychain, Google Password Manager, and similar) — the same passkey works everywhere it
            is available. Security keys are managed separately below.
          </p>
        </div>
        <div className="app-panel-head-actions">
          {!registering ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setRegistering(true)
                setLabel("")
                setError(null)
              }}
            >
              <Plus aria-hidden="true" />
              Add passkey
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <InlineError
          title="Passkeys unavailable"
          message={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {!error && loading ? (
        <p className="app-field-hint" role="status">
          Loading passkeys…
        </p>
      ) : null}

      {!error && !loading && registering ? (
        <div className="app-field" aria-live="polite">
          <Label htmlFor="passkey-label">Name this passkey (optional)</Label>
          <Input
            id="passkey-label"
            maxLength={60}
            placeholder="e.g. iPhone, Work laptop"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
          <p className="app-field-hint">
            Your browser will ask you to confirm with your device — fingerprint, face, PIN, or a
            synced passkey provider. The credential is stored on the device or in your password
            manager and syncs to your other devices.
          </p>
          <div className="app-form-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setRegistering(false)
                setLabel("")
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void register()}>
              {busy ? "Waiting for passkey…" : "Register passkey"}
            </Button>
          </div>
        </div>
      ) : null}

      {!error && !loading && !registering && passkeys && passkeys.length === 0 ? (
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          title="No passkeys"
          body="Add a passkey to sign in without a password or username. Passkeys created on this device may sync to your other devices automatically."
        />
      ) : null}

      {!error && !loading && !registering && passkeys && passkeys.length > 0 ? (
        <ul className="grid gap-3" aria-label="Passkeys">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="app-panel-alt border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  {renamingId === passkey.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Rename ${passkey.label}`}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        maxLength={60}
                        disabled={busy}
                        className="h-8 w-48"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !renameValue.trim()}
                        onClick={() => void rename(passkey)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setRenamingId(null)
                          setRenameValue("")
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{passkey.label}</strong>
                        <Badge variant="secondary" size="sm">
                          Passkey
                        </Badge>
                        {passkey.transports.includes("internal") ? (
                          <Badge variant="secondary" size="sm">
                            This device
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Added {formatTime(passkey.createdAt)} · Last used{" "}
                        {formatTime(passkey.lastUsedAt)}
                        {passkey.transports.length > 0 ? ` · ${passkey.transports.join(", ")}` : ""}
                      </p>
                    </>
                  )}
                </div>
                {renamingId !== passkey.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(passkey.id)
                        setRenameValue(passkey.label)
                      }}
                    >
                      Rename
                    </Button>
                    {confirmRevokeId === passkey.id ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmRevokeId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void revoke(passkey)}
                        >
                          Confirm revoke
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmRevokeId(passkey.id)}
                        aria-label={`Revoke ${passkey.label}`}
                      >
                        <Trash2 aria-hidden="true" />
                        Revoke
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
