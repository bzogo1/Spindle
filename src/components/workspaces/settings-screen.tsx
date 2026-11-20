"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, RotateCcw } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import type { WorkspaceSettings } from "@/lib/workspace-settings"

/**
 * Workspace settings screen for `/app/workspaces/[id]/settings`.
 *
 * Loads `GET /api/workspaces/{id}` (workspace info + caller role + member
 * count + settings) and saves a single `PATCH /api/workspaces/{id}` with
 * only the fields that changed — `{ name?, settings? }`. Owners/admins get
 * editable controls; members see the same layout disabled with a note,
 * mirroring the role-appropriate read-only state used elsewhere in the app.
 */

const NAME_MAX = 80
const LABEL_MAX = 40

type JoinRole = WorkspaceSettings["defaultJoinRole"]

interface SettingsDraft {
  name: string
  allowMemberInvites: boolean
  defaultJoinRole: JoinRole
  displayLabel: string
}

interface WorkspacePayload {
  id: string
  name: string
  slug: string
}

interface WorkspaceSettingsResponse {
  ok: boolean
  workspace?: WorkspacePayload
  role?: string
  memberCount?: number
  settings?: WorkspaceSettings
  message?: string
}

const JOIN_ROLE_LABELS: Record<JoinRole, string> = {
  member: "Member",
  admin: "Admin",
}

function draftFrom(workspace: WorkspacePayload, settings: WorkspaceSettings): SettingsDraft {
  return {
    name: workspace.name,
    allowMemberInvites: settings.allowMemberInvites,
    defaultJoinRole: settings.defaultJoinRole,
    displayLabel: settings.displayLabel,
  }
}

function isSameDraft(a: SettingsDraft, b: SettingsDraft) {
  return (
    a.name.trim() === b.name.trim() &&
    a.allowMemberInvites === b.allowMemberInvites &&
    a.defaultJoinRole === b.defaultJoinRole &&
    a.displayLabel === b.displayLabel
  )
}

export function WorkspaceSettingsScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [baseline, setBaseline] = useState<SettingsDraft | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store" })
      const data = (await response.json()) as WorkspaceSettingsResponse
      if (!response.ok || !data.ok || !data.workspace || !data.settings) {
        setError(data.message ?? "Could not load workspace settings.")
        setDraft(null)
        setBaseline(null)
        return
      }
      const next = draftFrom(data.workspace, data.settings)
      setDraft(next)
      setBaseline(next)
      setRole(data.role ?? null)
      setMemberCount(data.memberCount ?? null)
      setSaved(false)
    } catch {
      setError("Could not load workspace settings. Check your connection and try again.")
      setDraft(null)
      setBaseline(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"
  const dirty = draft !== null && baseline !== null && !isSameDraft(draft, baseline)
  const nameInvalid =
    draft !== null && (draft.name.trim().length === 0 || draft.name.trim().length > NAME_MAX)

  function patch(patchValue: Partial<SettingsDraft>) {
    setDraft((current) => (current ? { ...current, ...patchValue } : current))
    setSaved(false)
  }

  async function submit() {
    if (!draft || !baseline || saving || !canManage) return

    const body: { name?: string; settings?: Partial<WorkspaceSettings> } = {}
    if (draft.name.trim() !== baseline.name.trim()) {
      body.name = draft.name.trim()
    }
    const settingsPatch: Partial<WorkspaceSettings> = {}
    if (draft.allowMemberInvites !== baseline.allowMemberInvites) {
      settingsPatch.allowMemberInvites = draft.allowMemberInvites
    }
    if (draft.defaultJoinRole !== baseline.defaultJoinRole) {
      settingsPatch.defaultJoinRole = draft.defaultJoinRole
    }
    if (draft.displayLabel !== baseline.displayLabel) {
      settingsPatch.displayLabel = draft.displayLabel
    }
    if (Object.keys(settingsPatch).length > 0) body.settings = settingsPatch
    if (body.name === undefined && body.settings === undefined) return

    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as WorkspaceSettingsResponse
      if (!response.ok || !data.ok || !data.workspace || !data.settings) {
        toast({
          title: "Couldn't save workspace settings",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      const next = draftFrom(data.workspace, data.settings)
      setDraft(next)
      setBaseline(next)
      setSaved(true)
      toast({
        title: "Workspace settings saved",
        description: "Your changes were updated.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't save workspace settings",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  const loading = draft === null && error === null

  return (
    <section className="app-page-card" aria-labelledby="workspace-settings-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-settings-heading">Workspace settings</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
        {memberCount !== null ? (
          <span className="text-muted-foreground text-sm">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        ) : null}
      </div>

      {error ? (
        <InlineError
          title="Workspace settings unavailable"
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
        <LoadingPanel label="Loading workspace settings" variant="table" />
      ) : draft && baseline ? (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can change these settings. You&apos;re a{" "}
              {role ?? "member"} of this workspace, so the controls below are read-only.
            </p>
          ) : null}

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">General</legend>
            <div className="app-field">
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                type="text"
                value={draft.name}
                maxLength={NAME_MAX + 10}
                onChange={(event) => patch({ name: event.target.value })}
              />
              <p className="app-field-hint">
                {nameInvalid
                  ? "Name is required and must be 80 characters or fewer."
                  : "Shown across the app and to members of this workspace."}
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="workspace-display-label">Display label</label>
              <input
                id="workspace-display-label"
                type="text"
                value={draft.displayLabel}
                maxLength={LABEL_MAX}
                placeholder="e.g. Acme"
                onChange={(event) => patch({ displayLabel: event.target.value })}
              />
              <p className="app-field-hint">
                Optional short label shown as the workspace header. {LABEL_MAX} characters max.
              </p>
            </div>
          </fieldset>

          <fieldset className="grid gap-2.5" disabled={!canManage}>
            <legend className="text-sm font-medium">Members &amp; invitations</legend>
            <div className="app-pref-row">
              <div>
                <strong>Members can send invites</strong>
                <small>When off, only owners and admins can invite people to this workspace.</small>
              </div>
              <Switch
                checked={draft.allowMemberInvites}
                onCheckedChange={(allowMemberInvites) => patch({ allowMemberInvites })}
                aria-label="Members can send invites"
              />
            </div>
            <div className="app-field">
              <label htmlFor="workspace-default-role">Default role for invitees</label>
              <select
                id="workspace-default-role"
                className="app-select"
                value={draft.defaultJoinRole}
                onChange={(event) => patch({ defaultJoinRole: event.target.value as JoinRole })}
              >
                {(["member", "admin"] as const).map((roleOption) => (
                  <option key={roleOption} value={roleOption}>
                    {JOIN_ROLE_LABELS[roleOption]}
                  </option>
                ))}
              </select>
              <p className="app-field-hint">
                Role assigned when an invite is accepted without an explicit choice.
              </p>
            </div>
          </fieldset>

          <div className="app-form-actions app-form-actions--save">
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canManage || !dirty || nameInvalid || saving}
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
