"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, RotateCcw } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import type { WorkspaceBranding } from "@/lib/workspace-branding"

/**
 * Workspace branding screen for `/app/workspaces/[id]/branding`.
 *
 * Loads `GET /api/workspaces/{id}/branding` (owner/admin only — members get
 * 403 and see an insufficient-permissions state) and saves changes via
 * `PATCH /api/workspaces/{id}/branding` with only the fields that changed.
 *
 * The stored values feed two public surfaces: `GET /api/workspaces/brand`
 * (safe subset for anonymous clients) and the branded sign-in page reached
 * via `/sign-in?workspace=<slug-or-id>`.
 */

interface BrandingDraft {
  displayName: string
  logoText: string
  logoUrl: string
  accentColor: string
  backgroundColor: string
}

interface BrandingResponse {
  ok: boolean
  role?: string
  branding?: WorkspaceBranding | null
  message?: string
}

const EMPTY_DRAFT: BrandingDraft = {
  displayName: "",
  logoText: "",
  logoUrl: "",
  accentColor: "",
  backgroundColor: "",
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function draftFrom(branding: WorkspaceBranding | null | undefined): BrandingDraft {
  if (!branding) return { ...EMPTY_DRAFT }
  return {
    displayName: branding.displayName,
    logoText: branding.logoText,
    logoUrl: branding.logoUrl,
    accentColor: branding.accentColor,
    backgroundColor: branding.backgroundColor,
  }
}

function isSameDraft(a: BrandingDraft, b: BrandingDraft) {
  return (
    a.displayName === b.displayName &&
    a.logoText === b.logoText &&
    a.logoUrl === b.logoUrl &&
    a.accentColor === b.accentColor &&
    a.backgroundColor === b.backgroundColor
  )
}

/** Builds the PATCH body containing only fields that differ from baseline. */
function patchFrom(draft: BrandingDraft, baseline: BrandingDraft): Partial<BrandingDraft> {
  const patch: Partial<BrandingDraft> = {}
  if (draft.displayName !== baseline.displayName) patch.displayName = draft.displayName
  if (draft.logoText !== baseline.logoText) patch.logoText = draft.logoText
  if (draft.logoUrl !== baseline.logoUrl) patch.logoUrl = draft.logoUrl
  if (draft.accentColor !== baseline.accentColor) patch.accentColor = draft.accentColor
  if (draft.backgroundColor !== baseline.backgroundColor) {
    patch.backgroundColor = draft.backgroundColor
  }
  return patch
}

/** Color-picker input needs #rrggbb; fall back to a neutral swatch color. */
function colorInputValue(value: string): string {
  return HEX_COLOR_PATTERN.test(value) ? value : "#888888"
}

export function BrandingScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<BrandingDraft | null>(null)
  const [baseline, setBaseline] = useState<BrandingDraft | null>(null)
  const [workspaceName, setWorkspaceName] = useState("")
  const [role, setRole] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setForbidden(false)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/branding`, {
        cache: "no-store",
      })
      const data = (await response.json()) as BrandingResponse
      if (response.status === 403) {
        setForbidden(true)
        setDraft(null)
        setBaseline(null)
        return
      }
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load workspace branding.")
        setDraft(null)
        setBaseline(null)
        return
      }
      const next = draftFrom(data.branding)
      setDraft(next)
      setBaseline(next)
      setWorkspaceName(data.branding?.workspaceName ?? "")
      setRole(data.role ?? null)
      setSaved(false)
    } catch {
      setError("Could not load workspace branding. Check your connection and try again.")
      setDraft(null)
      setBaseline(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"
  const dirty = draft !== null && baseline !== null && !isSameDraft(draft, baseline)

  function patch(patchValue: Partial<BrandingDraft>) {
    setDraft((current) => (current ? { ...current, ...patchValue } : current))
    setSaved(false)
  }

  async function submit() {
    if (!draft || !baseline || saving || !canManage) return
    const body = patchFrom(draft, baseline)
    if (Object.keys(body).length === 0) return

    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/branding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as BrandingResponse
      if (!response.ok || !data.ok) {
        toast({
          title: "Couldn't save branding",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      toast({
        title: "Branding saved",
        description: "Your workspace sign-in page now uses these settings.",
        variant: "success",
      })
      // Re-fetch so baseline matches exactly what the API stored.
      await load()
      setSaved(true)
    } catch {
      toast({
        title: "Couldn't save branding",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  const loading = draft === null && error === null && !forbidden

  const previewName =
    draft?.logoText.trim() || draft?.displayName.trim() || workspaceName || "Workspace"
  const accentCandidate = draft?.accentColor ?? ""
  const previewAccent = HEX_COLOR_PATTERN.test(accentCandidate) ? accentCandidate : undefined

  return (
    <section className="app-page-card" aria-labelledby="workspace-branding-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-branding-heading">Workspace branding</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm" role="note">
        These settings brand the workspace sign-in page (<code>/sign-in?workspace=…</code>) and the
        public <code>/api/workspaces/brand</code> endpoint. Leave fields empty to keep the default
        Spindle look.
      </p>

      {forbidden ? (
        <p className="text-muted-foreground text-sm" role="note">
          Only workspace owners and admins can view or change branding settings.
        </p>
      ) : null}

      {error ? (
        <InlineError
          title="Branding unavailable"
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
        <LoadingPanel label="Loading workspace branding" variant="table" />
      ) : draft && baseline && !forbidden ? (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can change these settings. You&apos;re a{" "}
              {role ?? "member"} of this workspace, so the controls below are read-only.
            </p>
          ) : null}

          {/* Live preview swatch */}
          <div
            className="grid gap-2 rounded-lg border p-4"
            style={
              HEX_COLOR_PATTERN.test(draft.backgroundColor)
                ? { backgroundColor: draft.backgroundColor }
                : undefined
            }
            aria-label="Branding preview"
          >
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Preview
            </p>
            <div className="flex items-center gap-3">
              {/* Admin-supplied branding URL; plain img avoids next/image domain config. */}
              {draft.logoUrl.trim() ? (
                <img src={draft.logoUrl.trim()} alt="" className="h-8 w-8 rounded object-contain" />
              ) : (
                <span
                  className="grid h-8 w-8 place-items-center rounded text-sm font-semibold"
                  style={{
                    backgroundColor: previewAccent ?? "var(--ui-accent)",
                    color: "var(--ui-primary-foreground, #fff)",
                  }}
                  aria-hidden="true"
                >
                  {(previewName || "W").slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="grid">
                <strong className="text-sm">{previewName}</strong>
                {draft.logoText.trim() && draft.displayName.trim() ? (
                  <small className="text-muted-foreground text-xs">
                    Display name: {draft.displayName.trim()}
                  </small>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="ui-btn-primary w-fit px-4 py-1.5 text-xs"
              style={
                previewAccent
                  ? { backgroundColor: previewAccent, borderColor: previewAccent }
                  : undefined
              }
              tabIndex={-1}
            >
              Sign in
            </button>
          </div>

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Identity</legend>
            <div className="app-field">
              <label htmlFor="branding-display-name">Display name</label>
              <input
                id="branding-display-name"
                type="text"
                value={draft.displayName}
                maxLength={80}
                placeholder={workspaceName || "Workspace name"}
                onChange={(event) => patch({ displayName: event.target.value })}
              />
              <p className="app-field-hint">
                Overrides the workspace name on the sign-in page. Leave empty to use the workspace
                name{workspaceName ? ` (${workspaceName})` : ""}.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="branding-logo-text">Logo text</label>
              <input
                id="branding-logo-text"
                type="text"
                value={draft.logoText}
                maxLength={40}
                placeholder="e.g. Acme Labs"
                onChange={(event) => patch({ logoText: event.target.value })}
              />
              <p className="app-field-hint">
                Short label shown next to the logo mark. Leave empty to show only the display name.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="branding-logo-url">Logo image URL</label>
              <input
                id="branding-logo-url"
                type="url"
                value={draft.logoUrl}
                placeholder="https://example.com/logo.png"
                onChange={(event) => patch({ logoUrl: event.target.value })}
              />
              <p className="app-field-hint">
                Optional logo image (http/https). Leave empty to use the default mark.
              </p>
            </div>
          </fieldset>

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Colors</legend>
            <div className="app-field">
              <label htmlFor="branding-accent-color">Accent color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick accent color"
                  className="h-9 w-12 cursor-pointer rounded border"
                  value={colorInputValue(draft.accentColor)}
                  onChange={(event) => patch({ accentColor: event.target.value })}
                />
                <input
                  id="branding-accent-color"
                  type="text"
                  value={draft.accentColor}
                  placeholder="#1a2b3c"
                  className="w-32"
                  onChange={(event) => patch({ accentColor: event.target.value })}
                />
              </div>
              <p className="app-field-hint">
                Hex color (#rrggbb) used for accents on the branded sign-in page. Clear the field to
                restore the default theme color.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="branding-background-color">Background color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick background color"
                  className="h-9 w-12 cursor-pointer rounded border"
                  value={colorInputValue(draft.backgroundColor)}
                  onChange={(event) => patch({ backgroundColor: event.target.value })}
                />
                <input
                  id="branding-background-color"
                  type="text"
                  value={draft.backgroundColor}
                  placeholder="#0f1115"
                  className="w-32"
                  onChange={(event) => patch({ backgroundColor: event.target.value })}
                />
              </div>
              <p className="app-field-hint">
                Optional page background tint for the branded sign-in page. Clear to keep the
                default.
              </p>
            </div>
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
