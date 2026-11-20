"use client"

import Link from "next/link"
import { useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react"
import { ArrowUpRight, Upload, Users } from "lucide-react"

import { ScreenState } from "@/components/app/states/screen-state"
import { InlineError } from "@/components/app/states/inline-error"
import {
  SettingsImportExportCard,
  type SettingsImportValidation,
} from "@/components/app/settings-import-export"
import { formatDate } from "@/components/app/format"
import { PreferencesPanel } from "@/components/app/preferences-panel"
import { SettingsAuditLog } from "@/components/app/settings-audit-log"
import { recordSettingsAudit } from "@/lib/settings-audit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/toast"
import { useAppSettings } from "@/lib/api"
import type { AppSettingsData, UsageSummary, User, Workspace } from "@/lib/api/types"

const LOGO_MAX_BYTES = 5 * 1024 * 1024

/** Mock plan shown until the billing API lands — mirrors usage-screen.tsx. */
const CURRENT_PLAN_NAME = "Team"

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function roleLabel(role: Workspace["role"]) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

const WORKSPACE_NAME_MAX_LENGTH = 80
const WORKSPACE_DESCRIPTION_MAX_LENGTH = 240

const WORKSPACE_SETTINGS_EXPORT_KIND = "spindle-workspace-settings"
const WORKSPACE_SETTINGS_EXPORT_VERSION = 1

interface WorkspaceSettingsTransfer {
  name: string
  slug: string
  description: string
}

function buildWorkspaceSettingsExport(
  name: string,
  slug: string,
  description: string,
): Record<string, unknown> {
  return {
    kind: WORKSPACE_SETTINGS_EXPORT_KIND,
    version: WORKSPACE_SETTINGS_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    settings: { name, slug, description },
  }
}

function validateWorkspaceSettingsImport(
  value: unknown,
): SettingsImportValidation<WorkspaceSettingsTransfer> {
  const fail = (error: string): SettingsImportValidation<WorkspaceSettingsTransfer> => ({
    ok: false,
    error,
  })

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The file does not contain a settings export.")
  }
  const record = value as Record<string, unknown>
  if (
    record.kind !== WORKSPACE_SETTINGS_EXPORT_KIND ||
    record.version !== WORKSPACE_SETTINGS_EXPORT_VERSION
  ) {
    return fail("This file is not a Spindle workspace settings export.")
  }
  const settings = record.settings
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return fail("The export is missing its settings payload.")
  }
  const { name, slug, description } = settings as Record<string, unknown>
  if (typeof name !== "string" || !name.trim()) {
    return fail("The export is missing a workspace name.")
  }
  const trimmedName = name.trim()
  if (trimmedName.length > WORKSPACE_NAME_MAX_LENGTH) {
    return fail(`Workspace name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`)
  }
  if (typeof slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
    return fail("The export has an invalid workspace slug.")
  }
  if (description !== undefined && typeof description !== "string") {
    return fail("The export has an invalid workspace description.")
  }
  const trimmedDescription = typeof description === "string" ? description.trim() : ""
  if (trimmedDescription.length > WORKSPACE_DESCRIPTION_MAX_LENGTH) {
    return fail(
      `Workspace description must be ${WORKSPACE_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    )
  }
  return {
    ok: true,
    settings: { name: trimmedName, slug: slug.trim(), description: trimmedDescription },
  }
}

function WorkspaceLogoField({
  name,
  previewUrl,
  onFile,
}: {
  name: string
  previewUrl: string | null
  onFile: (file: File | null) => void
}) {
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState("")

  function acceptFile(file: File | undefined | null) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPG, or WebP).")
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError("Logo images must be 5 MB or smaller.")
      return
    }
    setError("")
    onFile(file)
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0])
    event.target.value = ""
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragActive(false)
    acceptFile(event.dataTransfer.files?.[0])
  }

  return (
    <div className="app-field">
      <span className="app-field-label" id="workspace-logo-label">
        Workspace logo
      </span>
      <div className="app-avatar-row">
        <span
          className={`app-avatar app-avatar--lg${previewUrl ? "has-image" : ""}`}
          aria-hidden="true"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" />
          ) : (
            name.trim().charAt(0).toUpperCase() || "?"
          )}
        </span>
        <label
          className={`app-avatar-drop${dragActive ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <Upload aria-hidden="true" />
          <span>{dragActive ? "Drop the image here" : "Drop an image or click to browse"}</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-labelledby="workspace-logo-label"
            onChange={onInputChange}
          />
        </label>
      </div>
      <p className="app-field-hint">
        PNG, JPG, or WebP up to 5 MB. Uploads are previewed locally — there is no workspace avatar
        API yet.
      </p>
      {error ? <InlineError title={null} message={error} /> : null}
    </div>
  )
}

function UnavailableAction({
  description,
  children,
}: {
  description: string
  children: React.ReactNode
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="app-tooltip-target" tabIndex={0}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function GeneralTab({ workspace, user }: { workspace: Workspace; user: User | null }) {
  const { toast } = useToast()
  const [baseline, setBaseline] = useState(workspace)
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [slugDirty, setSlugDirty] = useState(false)
  const [description, setDescription] = useState(workspace.description ?? "")
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [nameError, setNameError] = useState("")
  const [slugError, setSlugError] = useState("")

  useEffect(() => {
    setBaseline(workspace)
    setName(workspace.name)
    setSlug(workspace.slug)
    setSlugDirty(false)
    setDescription(workspace.description ?? "")
    setNameError("")
    setSlugError("")
  }, [workspace.id, workspace.name, workspace.slug, workspace.description])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  const dirty =
    name.trim() !== baseline.name ||
    slug.trim() !== baseline.slug ||
    description.trim() !== (baseline.description ?? "") ||
    logoFile !== null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    let valid = true
    if (!name.trim()) {
      setNameError("Workspace name is required.")
      valid = false
    } else {
      setNameError("")
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
      setSlugError("Slug must use lowercase letters, numbers, and hyphens.")
      valid = false
    } else {
      setSlugError("")
    }
    if (!valid) return

    const changes: string[] = []
    if (name.trim() !== baseline.name) changes.push("name")
    if (slug.trim() !== baseline.slug) changes.push("slug")
    if (description.trim() !== (baseline.description ?? "")) changes.push("description")
    if (logoFile !== null) changes.push("logo")

    // Local-only persistence: the settings API does not exist yet, so the
    // submitted values become the new baseline and the toast says so.
    setBaseline({
      ...baseline,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
    })
    setLogoFile(null)
    if (changes.length > 0) {
      recordSettingsAudit("workspace", {
        actor: user,
        summary: "updated workspace settings",
        target: changes.join(", "),
      })
    }
    toast({
      variant: "success",
      title: "Workspace settings saved",
      description: "Changes are stored locally until the workspace settings API lands.",
    })
  }

  const canDelete = baseline.role === "owner"

  return (
    <>
      <form className="app-form" onSubmit={submit}>
        <section className="app-page-card" aria-labelledby="settings-general-heading">
          <h2 id="settings-general-heading">General</h2>
          <WorkspaceLogoField
            name={name || baseline.name}
            previewUrl={logoPreviewUrl}
            onFile={setLogoFile}
          />
          <div className="app-field">
            <label htmlFor="workspace-name">Workspace name</label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError) setNameError("")
                if (!slugDirty) setSlug(slugify(event.target.value))
              }}
              required
              maxLength={80}
              autoComplete="organization"
              aria-invalid={nameError ? true : undefined}
            />
            {nameError ? <InlineError title={null} message={nameError} /> : null}
          </div>
          <div className="app-form-grid">
            <div className="app-field">
              <label htmlFor="workspace-slug">Slug</label>
              <Input
                id="workspace-slug"
                value={slug}
                onChange={(event) => {
                  setSlug(slugify(event.target.value))
                  setSlugDirty(true)
                  if (slugError) setSlugError("")
                }}
                required
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                aria-invalid={slugError ? true : undefined}
              />
              {slugError ? (
                <InlineError title={null} message={slugError} />
              ) : (
                <p className="app-field-hint">
                  Used in workspace URLs. Lowercase letters, numbers, and hyphens only.
                </p>
              )}
            </div>
            <div className="app-field">
              <label htmlFor="workspace-created">Created</label>
              <Input
                id="workspace-created"
                value={formatDate(baseline.createdAt)}
                disabled
                readOnly
              />
            </div>
          </div>
          <div className="app-field">
            <label htmlFor="workspace-description">Description</label>
            <textarea
              id="workspace-description"
              className="app-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this workspace for?"
              rows={3}
              maxLength={240}
            />
          </div>
          <div className="app-form-actions app-form-actions--save">
            <Button type="submit" disabled={!dirty}>
              Save changes
            </Button>
            <p className="app-field-hint">
              No custom domain is configured — workspace URLs are derived from the slug.
            </p>
          </div>
        </section>
      </form>

      <SettingsImportExportCard<WorkspaceSettingsTransfer>
        headingId="settings-transfer-heading"
        description="Download the workspace name, slug, and description as JSON, or restore them from a previous export. Role, plan, usage, and members are not included — there is no settings transfer API yet, so imports only fill this form."
        exportFilename="spindle-workspace-settings.json"
        buildExportPayload={() => buildWorkspaceSettingsExport(name, slug, description)}
        validateImport={validateWorkspaceSettingsImport}
        onImport={(settings) => {
          setName(settings.name)
          setSlug(settings.slug)
          setSlugDirty(true)
          setDescription(settings.description)
          setNameError("")
          setSlugError("")
        }}
      />

      <section
        className="app-page-card app-page-card--danger"
        aria-labelledby="settings-danger-heading"
      >
        <h2 id="settings-danger-heading">Danger zone</h2>
        <p>
          Workspace lifecycle actions are not wired up yet — there is no delete or leave API in the
          mock shell.
        </p>
        <div className="app-danger-actions">
          {canDelete ? (
            <UnavailableAction description="Workspace deletion is not available until the workspace API lands.">
              <Button type="button" variant="destructive" disabled>
                Delete workspace
              </Button>
            </UnavailableAction>
          ) : (
            <UnavailableAction description="Leaving a workspace is not available until the workspace API lands.">
              <Button type="button" variant="outline" disabled>
                Leave workspace
              </Button>
            </UnavailableAction>
          )}
        </div>
      </section>
    </>
  )
}

function UsageBreakdown({ usage }: { usage: UsageSummary }) {
  return (
    <dl className="app-storage-breakdown">
      <div>
        <dt>Requests</dt>
        <dd>{usage.requests.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>{usage.tokens.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>${usage.costUsd.toFixed(2)}</dd>
      </div>
      <div>
        <dt>Period</dt>
        <dd>
          {formatDate(usage.periodStart)} – {formatDate(usage.periodEnd)}
        </dd>
      </div>
    </dl>
  )
}

function PlanBillingTab({ usage }: { usage: UsageSummary }) {
  return (
    <>
      <section className="app-page-card" aria-labelledby="settings-plan-heading">
        <h2 id="settings-plan-heading">Current plan</h2>
        <div className="app-plan-summary">
          <div className="app-plan-name-row">
            <strong className="app-plan-name">{CURRENT_PLAN_NAME}</strong>
            <span className="app-usage-status is-ok">Active</span>
          </div>
          <p className="app-field-hint">
            Plan details are mock data until the billing API lands —{" "}
            <Link href="/dashboard/usage">see Usage &amp; plan</Link> for the full breakdown.
          </p>
          <div className="app-danger-actions">
            <Button asChild>
              <Link href="/pricing">
                Compare plans
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/usage">Manage billing</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="app-page-card" aria-labelledby="settings-usage-heading">
        <h2 id="settings-usage-heading">Usage this period</h2>
        <UsageBreakdown usage={usage} />
      </section>
    </>
  )
}

function MembersTab({ workspace }: { workspace: Workspace }) {
  return (
    <section className="app-page-card" aria-labelledby="settings-members-heading">
      <h2 id="settings-members-heading">Members</h2>
      <dl className="app-storage-breakdown">
        <div>
          <dt>Your role</dt>
          <dd>{roleLabel(workspace.role)}</dd>
        </div>
        <div>
          <dt>Members</dt>
          <dd>—</dd>
        </div>
      </dl>
      <p className="app-field-hint">
        Member counts, invites, and role management live on the Team members screen. The workspace
        API does not expose a member list yet.
      </p>
      <div className="app-danger-actions">
        <Button asChild variant="outline">
          <Link href="/dashboard/members">
            <Users aria-hidden="true" />
            Open team members
          </Link>
        </Button>
      </div>
    </section>
  )
}

function AuditLogTab() {
  return (
    <section className="app-page-card" aria-labelledby="settings-audit-heading">
      <h2 id="settings-audit-heading">Audit log</h2>
      <p className="app-page-subtitle">
        Recent workspace settings changes, newest first. Entries are stored locally in this browser
        until an audit API ships.
      </p>
      <SettingsAuditLog scope="workspace" />
    </section>
  )
}

function WorkspaceSettings({ settings }: { settings: AppSettingsData }) {
  const workspace = settings.workspace

  if (!workspace) {
    return (
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Settings</h1>
            <p className="app-page-subtitle">No workspace is selected for this session.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1>Settings</h1>
          <p className="app-page-subtitle">
            Workspace preferences, plan, and members for {workspace.name}.
          </p>
        </div>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="billing">Plan &amp; billing</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab workspace={workspace} user={settings.user} />
        </TabsContent>

        <TabsContent value="preferences">
          <PreferencesPanel />
        </TabsContent>

        <TabsContent value="billing">
          <PlanBillingTab usage={settings.usage} />
        </TabsContent>

        <TabsContent value="members">
          <MembersTab workspace={workspace} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Workspace settings screen. General holds the workspace form (logo, name,
 * slug, description) and the danger zone; Plan & billing and Members link out
 * to the usage and team screens. All form state is local — there is no
 * workspace settings API yet, so saves confirm via toast only.
 */
export function SettingsScreen() {
  const query = useAppSettings()

  return (
    <ScreenState
      screen="settings"
      status={query.status}
      data={query.data}
      error={query.error}
      isEmpty={query.mode === "empty"}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(settings) => <WorkspaceSettings settings={settings} />}
    </ScreenState>
  )
}
