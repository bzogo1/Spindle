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
import { registerSecurityKey, webauthnSupported } from "@/lib/webauthn/client"

/**
 * "Security keys" panel for `/app/security`: registers FIDO2/WebAuthn
 * credentials (security keys, Touch ID, Windows Hello, passkeys) against the
 * signed-in account, lists them, renames them, and revokes them.
 *
 * All state lives server-side behind `/api/auth/webauthn/*`; this component
 * only orchestrates the browser ceremony:
 *   register: registerSecurityKey() in @/lib/webauthn/client runs
 *             POST register/begin → navigator.credentials.create() →
 *             POST register/complete
 * The server stores only the public half (COSE key) — private keys never
 * leave the authenticator.
 *
 * Browsers without WebAuthn (`window.PublicKeyCredential`) get an explicit
 * unsupported state instead of a broken button.
 */

const CREDENTIALS_API = "/api/auth/webauthn/credentials"

export type SecurityKeyView = {
  id: string
  label: string
  /** "security-key" | "passkey"; absent on payloads predating the field. */
  kind?: string
  transports: string[]
  createdAt: string
  lastUsedAt: string
}

type BeginResponse = {
  ok: boolean
  challengeId?: string
  options?: Record<string, unknown>
  credentials?: SecurityKeyView[]
  credential?: SecurityKeyView
  message?: string
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

export function SecurityKeysPanel() {
  const [supported] = useState(() => webauthnSupported())
  const [keys, setKeys] = useState<SecurityKeyView[] | null>(null)
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
      const data = await request<BeginResponse>("", CREDENTIALS_API)
      // Passkeys (kind === "passkey") are managed by the Passkeys panel —
      // both share the credential store, so filter to avoid double-listing.
      setKeys((data.credentials ?? []).filter((entry) => entry.kind !== "passkey"))
    } catch (failure) {
      setError(errorMessage(failure, "Could not load security keys."))
      setKeys([])
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
      await registerSecurityKey(label)
      setLabel("")
      setRegistering(false)
      await load()
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "NotAllowedError") {
        setError("The security key prompt was dismissed or timed out.")
      } else {
        setError(errorMessage(failure, "Could not register the security key."))
      }
    } finally {
      setBusy(false)
    }
  }

  async function rename(key: SecurityKeyView) {
    const next = renameValue.trim()
    if (!next) {
      setRenamingId(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await request<BeginResponse>("", `${CREDENTIALS_API}/${key.id}`, {
        method: "PATCH",
        body: { label: next },
      })
      if (data.credential) {
        setKeys(
          (current) =>
            current?.map((entry) => (entry.id === key.id ? data.credential! : entry)) ?? null,
        )
      }
      setRenamingId(null)
      setRenameValue("")
    } catch (failure) {
      setError(errorMessage(failure, "Could not rename the security key."))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(key: SecurityKeyView) {
    setBusy(true)
    setError(null)
    try {
      await request<BeginResponse>("", `${CREDENTIALS_API}/${key.id}`, { method: "DELETE" })
      setKeys((current) => current?.filter((entry) => entry.id !== key.id) ?? null)
      setConfirmRevokeId(null)
    } catch (failure) {
      setError(errorMessage(failure, "Could not revoke the security key."))
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <section className="app-panel" aria-labelledby="security-keys-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="security-keys-heading">Security keys</h2>
            <p>
              Sign in with a FIDO2 security key, passkey, or platform authenticator instead of a
              password.
            </p>
          </div>
        </div>
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          title="WebAuthn is not supported here"
          body="This browser does not support security keys. Try a current version of Chrome, Safari, Firefox, or Edge."
        />
      </section>
    )
  }

  const loading = keys === null && error === null

  return (
    <section className="app-panel" aria-labelledby="security-keys-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="security-keys-heading">Security keys</h2>
          <p>
            Register a FIDO2 security key or platform authenticator (Touch ID, Windows Hello) for
            passwordless sign-in. Passkeys are managed in the Passkeys panel above. Private keys
            never leave the device. Keys that aren&apos;t discoverable can&apos;t be offered on the
            signed-out sign-in page — they only work in ceremonies bound to an active session, so
            keep a password or passkey as a fallback.
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
              Add security key
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <InlineError
          title="Security keys unavailable"
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
          Loading security keys…
        </p>
      ) : null}

      {!error && !loading && registering ? (
        <div className="app-field" aria-live="polite">
          <Label htmlFor="security-key-label">Name this key (optional)</Label>
          <Input
            id="security-key-label"
            maxLength={60}
            placeholder="e.g. YubiKey 5C"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
          <p className="app-field-hint">
            Your browser will ask you to touch the security key or confirm with your platform
            authenticator.
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
              {busy ? "Waiting for key…" : "Register key"}
            </Button>
          </div>
        </div>
      ) : null}

      {!error && !loading && !registering && keys && keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound aria-hidden="true" />}
          title="No security keys"
          body="Add a security key to sign in without a password — see the Passkeys panel above for discoverable credentials that sync across devices."
        />
      ) : null}

      {!error && !loading && !registering && keys && keys.length > 0 ? (
        <ul className="grid gap-3" aria-label="Security keys">
          {keys.map((key) => (
            <li key={key.id} className="app-panel-alt border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  {renamingId === key.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Rename ${key.label}`}
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
                        onClick={() => void rename(key)}
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
                        <strong className="text-sm">{key.label}</strong>
                        {key.transports.includes("internal") ? (
                          <Badge variant="secondary" size="sm">
                            This device
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Added {formatTime(key.createdAt)} · Last used {formatTime(key.lastUsedAt)}
                        {key.transports.length > 0 ? ` · ${key.transports.join(", ")}` : ""}
                      </p>
                    </>
                  )}
                </div>
                {renamingId !== key.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(key.id)
                        setRenameValue(key.label)
                      }}
                    >
                      Rename
                    </Button>
                    {confirmRevokeId === key.id ? (
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
                          onClick={() => void revoke(key)}
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
                        onClick={() => setConfirmRevokeId(key.id)}
                        aria-label={`Revoke ${key.label}`}
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
