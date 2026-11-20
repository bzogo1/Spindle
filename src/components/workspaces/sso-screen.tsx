"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, RotateCcw, ShieldAlert } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import type { WorkspaceSsoConfig } from "@/lib/workspace-sso"

/**
 * Workspace SSO settings screen for `/app/workspaces/[id]/sso`.
 *
 * Loads `GET /api/workspaces/{id}/sso` (owner/admin only — members get 403
 * and see an insufficient-permissions state) and saves changes via
 * `PATCH /api/workspaces/{id}/sso` with only the fields that changed.
 *
 * IMPORTANT: this UI stores SSO *configuration only*. SAML/OIDC protocol
 * flows, assertion validation, and login enforcement are NOT implemented
 * yet — `enabled` and `enforced` are inert flags until that work lands.
 *
 * Masking: the API masks `entityId`/`ssoUrl` to `origin/***`. Unchanged
 * masked values are omitted from the PATCH (partial-update semantics); to
 * replace a stored value, type the new URL into the field. Clearing a field
 * sends "" which unsets it.
 */

type SsoProvider = WorkspaceSsoConfig["provider"]

const PROVIDER_LABELS: Record<SsoProvider, string> = {
  none: "None (SSO not configured)",
  saml: "SAML 2.0",
  oidc: "OpenID Connect (OIDC)",
}

interface SsoDraft {
  enabled: boolean
  provider: SsoProvider
  entityId: string
  ssoUrl: string
  certificateConfigured: boolean
  certificateFingerprintLast4: string
  enforced: boolean
  /** Comma-separated editor form of config.allowedDomains. */
  allowedDomainsText: string
}

interface SsoResponse {
  ok: boolean
  role?: string
  config?: WorkspaceSsoConfig
  message?: string
}

function domainsToText(domains: string[]): string {
  return domains.join(", ")
}

function textToDomains(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
}

function draftFrom(config: WorkspaceSsoConfig): SsoDraft {
  return {
    enabled: config.enabled,
    provider: config.provider,
    entityId: config.entityId,
    ssoUrl: config.ssoUrl,
    certificateConfigured: config.certificateConfigured,
    certificateFingerprintLast4: config.certificateFingerprintLast4,
    enforced: config.enforced,
    allowedDomainsText: domainsToText(config.allowedDomains),
  }
}

function isSameDraft(a: SsoDraft, b: SsoDraft) {
  return (
    a.enabled === b.enabled &&
    a.provider === b.provider &&
    a.entityId === b.entityId &&
    a.ssoUrl === b.ssoUrl &&
    a.certificateConfigured === b.certificateConfigured &&
    a.certificateFingerprintLast4 === b.certificateFingerprintLast4 &&
    a.enforced === b.enforced &&
    a.allowedDomainsText.trim() === b.allowedDomainsText.trim()
  )
}

/** Builds the PATCH body containing only fields that differ from baseline. */
function patchFrom(draft: SsoDraft, baseline: SsoDraft): Partial<WorkspaceSsoConfig> {
  const patch: Partial<WorkspaceSsoConfig> = {}
  if (draft.enabled !== baseline.enabled) patch.enabled = draft.enabled
  if (draft.provider !== baseline.provider) patch.provider = draft.provider
  if (draft.entityId !== baseline.entityId) patch.entityId = draft.entityId
  if (draft.ssoUrl !== baseline.ssoUrl) patch.ssoUrl = draft.ssoUrl
  if (draft.certificateConfigured !== baseline.certificateConfigured) {
    patch.certificateConfigured = draft.certificateConfigured
  }
  if (draft.certificateFingerprintLast4.trim() !== baseline.certificateFingerprintLast4.trim()) {
    patch.certificateFingerprintLast4 = draft.certificateFingerprintLast4.trim()
  }
  if (draft.enforced !== baseline.enforced) patch.enforced = draft.enforced
  if (draft.allowedDomainsText.trim() !== baseline.allowedDomainsText.trim()) {
    patch.allowedDomains = textToDomains(draft.allowedDomainsText)
  }
  return patch
}

export function SsoScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<SsoDraft | null>(null)
  const [baseline, setBaseline] = useState<SsoDraft | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setForbidden(false)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sso`, {
        cache: "no-store",
      })
      const data = (await response.json()) as SsoResponse
      if (response.status === 403) {
        setForbidden(true)
        setDraft(null)
        setBaseline(null)
        return
      }
      if (!response.ok || !data.ok || !data.config) {
        setError(data.message ?? "Could not load SSO settings.")
        setDraft(null)
        setBaseline(null)
        return
      }
      const next = draftFrom(data.config)
      setDraft(next)
      setBaseline(next)
      setRole(data.role ?? null)
      setSaved(false)
    } catch {
      setError("Could not load SSO settings. Check your connection and try again.")
      setDraft(null)
      setBaseline(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"
  const dirty = draft !== null && baseline !== null && !isSameDraft(draft, baseline)

  function patch(patchValue: Partial<SsoDraft>) {
    setDraft((current) => (current ? { ...current, ...patchValue } : current))
    setSaved(false)
  }

  async function submit() {
    if (!draft || !baseline || saving || !canManage) return
    const body = patchFrom(draft, baseline)
    if (Object.keys(body).length === 0) return

    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sso`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as SsoResponse
      if (!response.ok || !data.ok) {
        toast({
          title: "Couldn't save SSO settings",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      toast({
        title: "SSO settings saved",
        description: "Your changes were updated. Protocol enforcement is still pending.",
        variant: "success",
      })
      // Re-fetch so baseline matches the masked config the API returns.
      await load()
      setSaved(true)
    } catch {
      toast({
        title: "Couldn't save SSO settings",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  const loading = draft === null && error === null && !forbidden

  return (
    <section className="app-page-card" aria-labelledby="workspace-sso-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-sso-heading">Single sign-on (SSO)</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm" role="note">
        <ShieldAlert aria-hidden="true" className="mr-1 inline h-4 w-4 align-text-bottom" />
        SSO protocol flows (SAML/OIDC login, assertion validation, and enforcement) are{" "}
        <strong>not yet implemented</strong>. This page stores configuration only — enabling SSO
        here does not change how members sign in yet.
      </p>

      {forbidden ? (
        <p className="text-muted-foreground text-sm" role="note">
          Only workspace owners and admins can view or change SSO settings. SSO configuration may
          reveal identity-provider infrastructure details, so it isn&apos;t visible to members.
        </p>
      ) : null}

      {error ? (
        <InlineError
          title="SSO settings unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading SSO settings" variant="table" />
      ) : draft && baseline && !forbidden ? (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can change these settings. You&apos;re a{" "}
              {role ?? "member"} of this workspace, so the controls below are read-only.
            </p>
          ) : null}

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Connection</legend>
            <div className="app-pref-row">
              <div>
                <strong>Enable SSO</strong>
                <small>
                  Marks this workspace as SSO-configured. No login behavior changes yet.
                </small>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) => patch({ enabled })}
                aria-label="Enable SSO"
              />
            </div>
            <div className="app-field">
              <label htmlFor="sso-provider">Identity provider protocol</label>
              <select
                id="sso-provider"
                className="app-select"
                value={draft.provider}
                onChange={(event) => patch({ provider: event.target.value as SsoProvider })}
              >
                {(Object.keys(PROVIDER_LABELS) as SsoProvider[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </div>
            <div className="app-field">
              <label htmlFor="sso-entity-id">Entity ID / issuer</label>
              <input
                id="sso-entity-id"
                type="text"
                value={draft.entityId}
                placeholder="https://idp.example.com/entity"
                onChange={(event) => patch({ entityId: event.target.value })}
              />
              <p className="app-field-hint">
                SAML Entity ID or OIDC issuer URL. Stored values are masked (&hellip;/***) for
                security — leave unchanged to keep, or type a new URL to replace.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="sso-url">SSO URL</label>
              <input
                id="sso-url"
                type="text"
                value={draft.ssoUrl}
                placeholder="https://idp.example.com/sso"
                onChange={(event) => patch({ ssoUrl: event.target.value })}
              />
              <p className="app-field-hint">
                SAML SSO endpoint or OIDC authorization endpoint. Must be https (http allowed only
                for localhost in development).
              </p>
            </div>
          </fieldset>

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Certificate</legend>
            <p className="text-muted-foreground text-sm">
              Certificates and private keys are <strong>never stored here</strong>. Only a
              &quot;configured&quot; flag and a short fingerprint suffix are kept for display.
            </p>
            <div className="app-pref-row">
              <div>
                <strong>Signing certificate on file</strong>
                <small>Records that your IdP metadata includes a signing certificate.</small>
              </div>
              <Switch
                checked={draft.certificateConfigured}
                onCheckedChange={(certificateConfigured) => patch({ certificateConfigured })}
                aria-label="Signing certificate on file"
              />
            </div>
            <div className="app-field">
              <label htmlFor="sso-cert-fingerprint">Certificate fingerprint suffix</label>
              <input
                id="sso-cert-fingerprint"
                type="text"
                value={draft.certificateFingerprintLast4}
                maxLength={16}
                placeholder="e.g. a1b2"
                onChange={(event) => patch({ certificateFingerprintLast4: event.target.value })}
              />
              <p className="app-field-hint">
                Optional short non-secret identifier (last characters of the fingerprint) so admins
                can tell certificates apart. Do not paste the certificate itself.
              </p>
            </div>
          </fieldset>

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Membership</legend>
            <div className="app-field">
              <label htmlFor="sso-allowed-domains">Allowed email domains</label>
              <input
                id="sso-allowed-domains"
                type="text"
                value={draft.allowedDomainsText}
                placeholder="example.com, corp.example.com"
                onChange={(event) => patch({ allowedDomainsText: event.target.value })}
              />
              <p className="app-field-hint">
                Comma-separated domains allowed to sign in via SSO (e.g. <code>example.com</code>).
                Used once enforcement ships.
              </p>
            </div>
            <div className="app-pref-row">
              <div>
                <strong>Enforce SSO for members</strong>
                <small>
                  When implemented, members of this workspace will be required to authenticate
                  through the identity provider.
                </small>
              </div>
              <Switch
                checked={draft.enforced}
                onCheckedChange={(enforced) => patch({ enforced })}
                aria-label="Enforce SSO for members"
              />
            </div>
            {draft.enforced ? (
              <p className="text-sm" role="alert">
                <strong>Warning:</strong> enforcing SSO will require all workspace members to sign
                in through your identity provider. Enforcement is not active yet — this flag is
                stored for when the protocol layer ships. Make sure your allowed domains and IdP
                configuration are correct before that happens.
              </p>
            ) : null}
          </fieldset>

          <div className="app-form-actions app-form-actions--save">
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canManage || !dirty || saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(baseline)
                setSaved(false)
              }}
              disabled={!canManage || saving || !dirty}
            >
              <RotateCcw aria-hidden="true" />
              Reset
            </Button>
            {saved ? (
              <p className="app-saved-note" role="status">
                <Check aria-hidden="true" />
                Changes saved.
              </p>
            ) : dirty ? (
              <p className="text-muted-foreground text-sm" role="status">
                You have unsaved changes.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
