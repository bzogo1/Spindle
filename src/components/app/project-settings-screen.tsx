"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plug, Send, Trash2, UserCog, UserPlus, Users, Webhook } from "lucide-react"

import { api, useMutation, useProjectHome, useSession, useWorkspaceMembers } from "@/lib/api"
import {
  clearProjectWebhookDeliveries,
  fireProjectTestWebhook,
  isValidProjectWebhookUrl,
  listProjectWebhookDeliveries,
  listProjectWebhooks,
  PROJECT_WEBHOOK_EVENTS,
  removeProjectWebhook,
  saveNewProjectWebhook,
  setProjectWebhookEnabled,
  updateProjectWebhook,
  type ProjectWebhook,
  type ProjectWebhookDelivery,
  type ProjectWebhookEvent,
} from "@/lib/project-webhooks"
import type {
  AddProjectMemberInput,
  ProjectDetails,
  ProjectMember,
  ProjectMemberGrantRole,
  ProjectVisibility,
} from "@/lib/api/types"
import {
  canChangeMemberRole,
  canManageMembers,
  canRemoveMember,
  type MemberRoleHolder,
} from "@/lib/members/permissions"
import { getAvatarInitials } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import {
  SettingsImportExportCard,
  type SettingsImportValidation,
} from "@/components/app/settings-import-export"
import { SettingsAuditLog } from "@/components/app/settings-audit-log"
import { recordSettingsAudit } from "@/lib/settings-audit"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"

import { CATEGORY_COPY } from "./notification-preferences-screen"
import {
  APP_NOTIFICATION_CATEGORIES,
  useAppNotifications,
  type AppNotificationCategory,
  type AppNotificationProjectPreferences,
} from "./notifications-provider"
import { formatDate, formatDateTime } from "./format"

const VISIBILITY_LABELS: Record<ProjectVisibility, string> = {
  private: "Private",
  workspace: "Workspace",
  public: "Public",
}

interface IntegrationDef {
  id: string
  name: string
  description: string
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Sync repositories, issues, and pull requests with project files and agent runs.",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Post project activity updates and agent approvals to Slack channels.",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Turn agent run results and file changes into Linear issues.",
  },
  {
    id: "s3",
    name: "S3-compatible storage",
    description: "Mirror project files to an external object-storage bucket.",
  },
]

const PROJECT_NAME_MAX_LENGTH = 80
const PROJECT_DESCRIPTION_MAX_LENGTH = 500
const WEBHOOK_URL_MAX_LENGTH = 500

const PROJECT_SETTINGS_EXPORT_KIND = "spindle-project-settings"
const PROJECT_SETTINGS_EXPORT_VERSION = 1

interface ProjectSettingsTransfer {
  name: string
  description: string
}

function buildProjectSettingsExport(name: string, description: string): Record<string, unknown> {
  return {
    kind: PROJECT_SETTINGS_EXPORT_KIND,
    version: PROJECT_SETTINGS_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    settings: { name, description },
  }
}

function validateProjectSettingsImport(
  value: unknown,
): SettingsImportValidation<ProjectSettingsTransfer> {
  const fail = (error: string): SettingsImportValidation<ProjectSettingsTransfer> => ({
    ok: false,
    error,
  })

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("The file does not contain a settings export.")
  }
  const record = value as Record<string, unknown>
  if (
    record.kind !== PROJECT_SETTINGS_EXPORT_KIND ||
    record.version !== PROJECT_SETTINGS_EXPORT_VERSION
  ) {
    return fail("This file is not a Spindle project settings export.")
  }
  const settings = record.settings
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return fail("The export is missing its settings payload.")
  }
  const { name, description } = settings as Record<string, unknown>
  if (typeof name !== "string" || !name.trim()) {
    return fail("The export is missing a project name.")
  }
  const trimmedName = name.trim()
  if (trimmedName.length > PROJECT_NAME_MAX_LENGTH) {
    return fail(`Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`)
  }
  if (description !== undefined && typeof description !== "string") {
    return fail("The export has an invalid project description.")
  }
  const trimmedDescription = typeof description === "string" ? description.trim() : ""
  if (trimmedDescription.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    return fail(
      `Project description must be ${PROJECT_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    )
  }
  return { ok: true, settings: { name: trimmedName, description: trimmedDescription } }
}

function generateWebhookSecret() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

function IntegrationRow({
  integration,
  connected,
  onToggle,
}: {
  integration: IntegrationDef
  connected: boolean
  onToggle: () => void
}) {
  return (
    <li className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <strong className="text-sm font-medium">{integration.name}</strong>
        <p className="text-muted-foreground text-sm">{integration.description}</p>
      </div>
      <div className="flex items-center gap-2">
        {connected ? <Badge variant="secondary">Connected</Badge> : null}
        <Button type="button" variant="outline" size="sm" onClick={onToggle}>
          {connected ? "Disconnect" : "Connect"}
        </Button>
      </div>
    </li>
  )
}

function GeneralTab({ project, onSaved }: { project: ProjectDetails; onSaved: () => void }) {
  const { toast } = useToast()
  const session = useSession()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? "")
  const [nameError, setNameError] = useState("")
  const save = useMutation((input: { name: string; description?: string }) =>
    api.projects.updateProject(project.id, input),
  )

  useEffect(() => {
    setName(project.name)
    setDescription(project.description ?? "")
    setNameError("")
  }, [project.id, project.name, project.description])

  const dirty = name.trim() !== project.name || description.trim() !== (project.description ?? "")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError("Project name is required.")
      return
    }
    if (trimmedName.length > PROJECT_NAME_MAX_LENGTH) {
      setNameError(`Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`)
      return
    }
    setNameError("")

    const trimmedDescription = description.trim()
    const changes: string[] = []
    if (trimmedName !== project.name) changes.push("name")
    if (trimmedDescription !== (project.description ?? "")) changes.push("description")

    try {
      await save.mutate({
        name: trimmedName,
        description: trimmedDescription === "" ? undefined : trimmedDescription,
      })
      if (changes.length > 0) {
        recordSettingsAudit(`project:${project.id}`, {
          actor: session.data,
          summary: "updated project settings",
          target: changes.join(", "),
        })
      }
      toast({ title: "Project settings saved" })
      onSaved()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not save project settings",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      <div className="app-page-card" aria-labelledby="project-settings-general-heading">
        <h2 id="project-settings-general-heading">General</h2>
        <form className="app-form" onSubmit={submit} noValidate>
          <div className="app-field">
            <label htmlFor="project-name">Project name</label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError) setNameError("")
              }}
              required
              maxLength={PROJECT_NAME_MAX_LENGTH}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "project-name-error" : undefined}
            />
            {nameError ? (
              <InlineError id="project-name-error" title={null} message={nameError} />
            ) : null}
          </div>
          <div className="app-field">
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              className="app-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project for?"
              rows={3}
              maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
            />
          </div>
          <div className="app-field">
            <label htmlFor="project-visibility">Visibility</label>
            <select
              id="project-visibility"
              className="border-input dark:bg-input/30 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              value={project.visibility}
              disabled
            >
              <option value="private">Private</option>
              <option value="workspace">Workspace</option>
              <option value="public">Public</option>
            </select>
            <p className="app-field-hint">
              Currently <Badge variant="outline">{VISIBILITY_LABELS[project.visibility]}</Badge>.
              Changing visibility is not supported by the project API yet.
            </p>
          </div>
          <div className="app-field">
            <label htmlFor="project-default-branch">Default branch</label>
            <Input id="project-default-branch" value="main" disabled readOnly />
            <p className="app-field-hint">
              Managed by the repository integration, which is not available yet.
            </p>
          </div>
          <div className="app-form-actions">
            <Button type="submit" disabled={!dirty || save.isLoading}>
              {save.isLoading ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
      <SettingsImportExportCard<ProjectSettingsTransfer>
        headingId="project-settings-transfer-heading"
        description="Download the general settings below as JSON, or restore the project name and description from a previous export. Integrations, webhooks, and members are not included — there is no settings transfer API yet, so imports only fill this form."
        exportFilename="spindle-project-settings.json"
        buildExportPayload={() => buildProjectSettingsExport(name, description)}
        validateImport={validateProjectSettingsImport}
        onImport={(settings) => {
          setName(settings.name)
          setDescription(settings.description)
          setNameError("")
        }}
      />
    </>
  )
}

const PROJECT_MEMBER_ROLE_OPTIONS: { value: ProjectMemberGrantRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
]

const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

function projectMemberName(member: ProjectMember) {
  return member.user.name ?? member.user.email
}

function projectMemberBadgeVariant(role: ProjectMember["role"]) {
  if (role === "owner") return "default" as const
  if (role === "admin") return "secondary" as const
  return "outline" as const
}

/**
 * Project membership: who can see and work in this project. The role rules
 * mirror `lib/members/permissions` — owners and admins manage rows, the owner
 * row is read-only (ownership moves via the transfer flow in the danger
 * zone), and nobody edits their own row here.
 */
function MembersTab({ project, onChanged }: { project: ProjectDetails; onChanged: () => void }) {
  const { toast } = useToast()
  const session = useSession()
  const workspaceMembers = useWorkspaceMembers()
  const [addUserId, setAddUserId] = useState("")
  const [addRole, setAddRole] = useState<ProjectMemberGrantRole>("member")

  const addMember = useMutation((input: AddProjectMemberInput) =>
    api.projects.addProjectMember(project.id, input),
  )
  const changeRole = useMutation((input: { memberId: string; role: ProjectMemberGrantRole }) =>
    api.projects.updateProjectMemberRole(project.id, input.memberId, input.role),
  )
  const removeMember = useMutation((memberId: string) =>
    api.projects.removeProjectMember(project.id, memberId),
  )

  useEffect(() => {
    setAddUserId("")
    setAddRole("member")
  }, [project.id])

  const sessionUser = session.data ?? null
  const actorMember = project.members.find((member) => member.user.id === sessionUser?.id)
  // The owner may not have a member row in every profile; treat them as owner
  // for permission checks either way.
  const actorRole =
    actorMember?.role ?? (sessionUser && sessionUser.id === project.owner.id ? "owner" : null)
  const actor: MemberRoleHolder | null =
    actorRole !== null && sessionUser
      ? { id: actorMember?.id ?? sessionUser.id, role: actorRole }
      : null
  const memberHolders: MemberRoleHolder[] = project.members.map((member) => ({
    id: member.id,
    role: member.role,
  }))
  const canManage = canManageMembers(actorRole)

  const memberUserIds = new Set(project.members.map((member) => member.user.id))
  const candidates = (workspaceMembers.data ?? []).filter((user) => !memberUserIds.has(user.id))

  async function submitAdd() {
    const user = candidates.find((candidate) => candidate.id === addUserId)
    if (!user) return
    const target = user.name ?? user.email
    try {
      await addMember.mutate({ userId: user.id, role: addRole })
      toast({ title: `${target} added to ${project.name}` })
      recordSettingsAudit(`project:${project.id}`, {
        actor: session.data,
        summary: "added a project member",
        target,
      })
      setAddUserId("")
      setAddRole("member")
      onChanged()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not add member",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  async function changeMemberRole(member: ProjectMember, role: ProjectMemberGrantRole) {
    if (role === member.role) return
    const target = projectMemberName(member)
    try {
      await changeRole.mutate({ memberId: member.id, role })
      toast({ title: `${target} is now ${PROJECT_MEMBER_ROLE_LABELS[role].toLowerCase()}` })
      recordSettingsAudit(`project:${project.id}`, {
        actor: session.data,
        summary: "changed a project member's role",
        target: `${target} → ${role}`,
      })
      onChanged()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not update role",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  async function removeProjectMember(member: ProjectMember) {
    const target = projectMemberName(member)
    try {
      await removeMember.mutate(member.id)
      toast({ title: `${target} removed from ${project.name}` })
      recordSettingsAudit(`project:${project.id}`, {
        actor: session.data,
        summary: "removed a project member",
        target,
      })
      onChanged()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not remove member",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <div className="app-page-card" aria-labelledby="project-settings-members-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="project-settings-members-heading">Members</h2>
          <p className="app-page-subtitle">
            People who can open {project.name}. Project membership is separate from workspace
            membership — only workspace members can be added.
          </p>
        </div>
      </div>
      {project.members.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title="No members yet"
          body="Add workspace members to give them access to this project."
        />
      ) : (
        <ul className="grid gap-2">
          {project.members.map((member) => {
            const target: MemberRoleHolder = { id: member.id, role: member.role }
            // The grant helpers need a concrete next role; pick the opposite
            // assignable role — for non-owner rows it does not affect the
            // last-owner guard, which only applies to owner targets.
            const canEditRole =
              member.role !== "owner" &&
              canChangeMemberRole(
                actor,
                target,
                memberHolders,
                member.role === "admin" ? "member" : "admin",
              )
            const canRemove = canRemoveMember(actor, target, memberHolders)
            return (
              <li
                key={member.id}
                className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="app-member-avatar" aria-hidden="true">
                    {getAvatarInitials(projectMemberName(member))}
                  </span>
                  <div className="min-w-0">
                    <strong className="text-sm font-medium">{projectMemberName(member)}</strong>
                    <p className="text-muted-foreground text-sm">
                      {member.user.email} · Joined {formatDate(member.joinedAt)}
                      {member.user.id === project.owner.id ? " · Project owner" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {member.role === "owner" ? (
                    <Badge variant="default">Owner</Badge>
                  ) : canEditRole ? (
                    <select
                      className="app-select"
                      value={member.role}
                      disabled={changeRole.isLoading}
                      onChange={(event) =>
                        void changeMemberRole(member, event.target.value as ProjectMemberGrantRole)
                      }
                      aria-label={`Role for ${projectMemberName(member)}`}
                    >
                      {PROJECT_MEMBER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant={projectMemberBadgeVariant(member.role)}>
                      {PROJECT_MEMBER_ROLE_LABELS[member.role]}
                    </Badge>
                  )}
                  {canRemove ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={removeMember.isLoading}
                      onClick={() => void removeProjectMember(member)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {canManage ? (
        <div className="app-field mt-4">
          <label htmlFor="project-member-add-user">Add a workspace member</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="project-member-add-user"
              className="app-select"
              value={addUserId}
              onChange={(event) => setAddUserId(event.target.value)}
              disabled={candidates.length === 0 || addMember.isLoading}
            >
              <option value="">
                {candidates.length === 0
                  ? "No workspace members left to add"
                  : "Select a workspace member…"}
              </option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email} ({user.email})
                </option>
              ))}
            </select>
            <select
              className="app-select"
              value={addRole}
              onChange={(event) => setAddRole(event.target.value as ProjectMemberGrantRole)}
              disabled={addMember.isLoading}
              aria-label="Role for the new member"
            >
              {PROJECT_MEMBER_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={!addUserId || addMember.isLoading}
              onClick={() => void submitAdd()}
            >
              <UserPlus aria-hidden="true" />
              {addMember.isLoading ? "Adding…" : "Add member"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="app-page-subtitle mt-4">Only project owners and admins can manage members.</p>
      )}
    </div>
  )
}

/** Tri-state value for a per-project category override select. */
type ProjectCategoryOverride = "inherit" | "on" | "off"

/** Return `next`, or `null` when it carries no overrides (entry gets dropped). */
function pruneProjectOverrides(
  next: AppNotificationProjectPreferences,
): AppNotificationProjectPreferences | null {
  return next.muted || Object.keys(next.categories).length > 0 ? next : null
}

/**
 * Project-level notification overrides. Writes straight through to
 * `AppNotificationsProvider.updatePreferences` (persisted to localStorage),
 * mirroring the global preferences screen — there is no save button because
 * changes apply to `deliver()` immediately. Overrides layer on top of the
 * global preferences; "inherit" removes the override so the global value
 * applies again.
 */
function NotificationsTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { preferences, updatePreferences } = useAppNotifications()
  const projectPrefs = preferences.projects[projectId]

  /**
   * Apply `updater` to this project's overrides inside the preferences
   * updater so rapid changes never clobber each other. Returning `null`
   * removes the project entry — used when no overrides remain.
   */
  function updateProject(
    updater: (
      current: AppNotificationProjectPreferences | undefined,
    ) => AppNotificationProjectPreferences | null,
  ) {
    updatePreferences((current) => {
      const projects = { ...current.projects }
      const next = updater(current.projects[projectId])
      if (next === null) {
        delete projects[projectId]
      } else {
        projects[projectId] = next
      }
      return { ...current, projects }
    })
  }

  function patchProject(patchValue: Partial<AppNotificationProjectPreferences>) {
    updateProject((current) =>
      pruneProjectOverrides({ ...(current ?? { muted: false, categories: {} }), ...patchValue }),
    )
  }

  function setCategoryOverride(category: AppNotificationCategory, value: ProjectCategoryOverride) {
    updateProject((current) => {
      const existing = current ?? { muted: false, categories: {} }
      const categories = { ...existing.categories }
      if (value === "inherit") {
        delete categories[category]
      } else {
        categories[category] = { ...categories[category], inApp: value === "on" }
      }
      return pruneProjectOverrides({ ...existing, categories })
    })
  }

  const hasOverrides = projectPrefs !== undefined

  return (
    <div className="app-page-card" aria-labelledby="project-settings-notifications-heading">
      <h2 id="project-settings-notifications-heading">Notifications</h2>
      <p className="app-page-subtitle">
        Per-project overrides for {projectName}. They layer on top of your{" "}
        <Link href="/app/account/notifications">global notification preferences</Link> and are
        stored in this browser.
      </p>
      <div className="grid gap-2.5">
        <div className="app-pref-row">
          <div>
            <strong>Mute this project</strong>
            <small>Pause every in-app notification tagged with {projectName}.</small>
          </div>
          <Switch
            checked={projectPrefs?.muted ?? false}
            onCheckedChange={(muted) => patchProject({ muted })}
            aria-label="Mute this project"
          />
        </div>
      </div>
      <h3 className="mt-4 text-sm font-semibold">Category overrides</h3>
      <p className="text-muted-foreground text-sm">
        Override the in-app delivery of a single category for this project. Categories left on
        Default follow your global settings.
      </p>
      <div className="mt-2 grid gap-2.5">
        {APP_NOTIFICATION_CATEGORIES.map((category) => {
          const copy = CATEGORY_COPY[category]
          const override = projectPrefs?.categories[category]?.inApp
          const value: ProjectCategoryOverride =
            override === undefined ? "inherit" : override ? "on" : "off"
          return (
            <div key={category} className="app-pref-row">
              <div>
                <strong>{copy.label}</strong>
                <small>{copy.description}</small>
              </div>
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                In-app
                <select
                  className="app-select"
                  value={value}
                  onChange={(event) =>
                    setCategoryOverride(category, event.target.value as ProjectCategoryOverride)
                  }
                  aria-label={`${copy.label} in-app override for this project`}
                >
                  <option value="inherit">
                    Default ({preferences.categories[category].inApp ? "on" : "off"})
                  </option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
          )
        })}
      </div>
      {hasOverrides ? (
        <div className="app-form-actions">
          <Button type="button" variant="outline" onClick={() => updateProject(() => null)}>
            Reset project overrides
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function IntegrationsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const session = useSession()
  const [connected, setConnected] = useState<ReadonlySet<string>>(new Set())

  function toggle(integration: IntegrationDef) {
    const next = new Set(connected)
    const isConnected = next.has(integration.id)
    if (isConnected) {
      next.delete(integration.id)
      toast({ title: `${integration.name} disconnected` })
    } else {
      next.add(integration.id)
      toast({
        title: `${integration.name} connected`,
        description: "Connection state is local until the integrations API ships.",
      })
    }
    setConnected(next)
    recordSettingsAudit(`project:${projectId}`, {
      actor: session.data,
      summary: isConnected ? "disconnected an integration" : "connected an integration",
      target: integration.name,
    })
  }

  return (
    <div className="app-page-card" aria-labelledby="project-settings-integrations-heading">
      <h2 id="project-settings-integrations-heading">Integrations</h2>
      <p className="app-page-subtitle">
        Connect external services to this project. No integrations API exists yet, so connection
        state is kept locally in this session.
      </p>
      {connected.size === 0 ? (
        <EmptyState
          icon={<Plug aria-hidden="true" />}
          title="No integrations connected"
          body="Connect a service below to sync repositories, notifications, or storage with this project."
        />
      ) : null}
      <ul className="grid gap-2">
        {INTEGRATIONS.map((item) => (
          <IntegrationRow
            key={item.id}
            integration={item}
            connected={connected.has(item.id)}
            onToggle={() => toggle(item)}
          />
        ))}
      </ul>
    </div>
  )
}

interface WebhookDialogInput {
  url: string
  events: ProjectWebhookEvent[]
  /** Fresh signing secret — only set when creating a webhook. */
  secret?: string
  enabled: boolean
}

function WebhookDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: ProjectWebhook | null
  onClose: () => void
  onSave: (input: WebhookDialogInput) => void
}) {
  const [url, setUrl] = useState(initial?.url ?? "")
  const [events, setEvents] = useState<ProjectWebhookEvent[]>(initial?.events ?? [])
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [urlError, setUrlError] = useState("")
  const [eventsError, setEventsError] = useState("")

  useEffect(() => {
    if (open) {
      setUrl(initial?.url ?? "")
      setEvents(initial?.events ?? [])
      setEnabled(initial?.enabled ?? true)
      setRevealedSecret(null)
      setUrlError("")
      setEventsError("")
    }
  }, [open, initial])

  function toggleEvent(eventName: ProjectWebhookEvent) {
    setEvents((current) =>
      current.includes(eventName)
        ? current.filter((item) => item !== eventName)
        : [...current, eventName],
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    let valid = true
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setUrlError("Endpoint URL is required.")
      valid = false
    } else if (!isValidProjectWebhookUrl(trimmedUrl)) {
      setUrlError("Enter a valid URL starting with http:// or https://.")
      valid = false
    } else {
      setUrlError("")
    }
    if (events.length === 0) {
      setEventsError("Select at least one event to subscribe to.")
      valid = false
    } else {
      setEventsError("")
    }
    if (!valid) return

    const isNew = initial === null
    // The signing secret is generated up front so it can be persisted with
    // the webhook and shown once before the dialog closes.
    const secret = isNew ? generateWebhookSecret() : undefined
    onSave({ url: trimmedUrl, events, secret, enabled })
    if (isNew) {
      setRevealedSecret(secret ?? null)
    } else {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit webhook" : "New webhook"}</DialogTitle>
          <DialogDescription>
            Webhooks POST a signed JSON payload to your endpoint when the selected events happen.
            Configuration is stored in this browser until the webhooks API ships.
          </DialogDescription>
        </DialogHeader>
        {revealedSecret ? (
          <div className="grid gap-3">
            <h3 className="text-sm font-semibold">Webhook secret</h3>
            <p className="text-muted-foreground text-sm">
              Copy this signing secret now — it is shown only once.
            </p>
            <code className="border-border bg-muted block overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs">
              {revealedSecret}
            </code>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="app-form" onSubmit={submit} noValidate>
            <div className="app-field">
              <label htmlFor="webhook-url">Endpoint URL</label>
              <Input
                id="webhook-url"
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                  if (urlError) setUrlError("")
                }}
                placeholder="https://example.com/hooks/spindle"
                required
                maxLength={WEBHOOK_URL_MAX_LENGTH}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? "webhook-url-error" : undefined}
              />
              {urlError ? (
                <InlineError id="webhook-url-error" title={null} message={urlError} />
              ) : null}
            </div>
            <fieldset
              className="app-field"
              aria-describedby={eventsError ? "webhook-events-error" : undefined}
            >
              <legend className="text-muted-foreground text-xs font-semibold">Events</legend>
              <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {PROJECT_WEBHOOK_EVENTS.map((eventName) => (
                  <label
                    key={eventName}
                    className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(eventName)}
                      onChange={() => {
                        toggleEvent(eventName)
                        if (eventsError) setEventsError("")
                      }}
                    />
                    <code className="text-xs">{eventName}</code>
                  </label>
                ))}
              </div>
              {eventsError ? (
                <InlineError id="webhook-events-error" title={null} message={eventsError} />
              ) : events.length === 0 ? (
                <p className="app-field-hint">Select at least one event to subscribe to.</p>
              ) : null}
            </fieldset>
            <div className="app-field">
              <label htmlFor="webhook-status">Status</label>
              <select
                id="webhook-status"
                className="border-input dark:bg-input/30 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                value={enabled ? "active" : "paused"}
                onChange={(event) => setEnabled(event.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              {initial?.secret ? (
                <p className="app-field-hint">
                  A signing secret is configured for this webhook. It cannot be viewed again.
                </p>
              ) : null}
            </div>
            <div className="app-form-actions">
              <Button type="submit">{initial ? "Save changes" : "Create webhook"}</Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WebhookDeliveryRow({ delivery }: { delivery: ProjectWebhookDelivery }) {
  return (
    <li className="border-border bg-card flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          <code>{delivery.event}</code>
          <span className="text-muted-foreground"> · {formatDateTime(delivery.attemptedAt)}</span>
        </p>
        <p className="text-muted-foreground truncate text-sm" title={delivery.url}>
          {delivery.url}
        </p>
        {delivery.error ? (
          <p className="text-destructive text-sm">{delivery.error}</p>
        ) : delivery.responseSnippet ? (
          <p className="text-muted-foreground text-xs">{delivery.responseSnippet}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={delivery.status === "success" ? "secondary" : "destructive"}>
          {delivery.status === "success" ? "delivered" : "failed"}
        </Badge>
        <span className="text-muted-foreground text-xs">{delivery.durationMs}ms</span>
      </div>
    </li>
  )
}

function WebhooksTab({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const session = useSession()
  const [webhooks, setWebhooks] = useState<ProjectWebhook[]>(() => listProjectWebhooks(projectId))
  const [deliveries, setDeliveries] = useState<ProjectWebhookDelivery[]>(() =>
    listProjectWebhookDeliveries(projectId),
  )
  const [testingId, setTestingId] = useState<string | null>(null)
  const [dialogState, setDialogState] = useState<
    { mode: "create" } | { mode: "edit"; webhook: ProjectWebhook } | null
  >(null)

  function refresh() {
    setWebhooks(listProjectWebhooks(projectId))
    setDeliveries(listProjectWebhookDeliveries(projectId))
  }

  function audit(summary: string, target?: string) {
    recordSettingsAudit(`project:${projectId}`, {
      actor: session.data,
      summary,
      target,
    })
  }

  function saveWebhook(input: WebhookDialogInput) {
    if (dialogState?.mode === "edit") {
      const existing = dialogState.webhook
      updateProjectWebhook(projectId, {
        ...existing,
        url: input.url,
        events: input.events,
        enabled: input.enabled,
      })
      toast({ title: "Webhook updated" })
      audit("updated a webhook", input.url)
    } else {
      const created = saveNewProjectWebhook(projectId, {
        url: input.url,
        events: input.events,
        secret: input.secret,
        enabled: input.enabled,
      })
      if (!created.ok || !created.webhook) {
        toast({
          variant: "error",
          title: "Could not create webhook",
          description: created.error,
        })
        return
      }
      toast({ title: "Webhook created" })
      audit("created a webhook", input.url)
    }
    refresh()
  }

  function toggleWebhook(webhook: ProjectWebhook) {
    const enabled = !webhook.enabled
    setProjectWebhookEnabled(projectId, webhook.id, enabled)
    toast({
      title: enabled ? "Webhook enabled" : "Webhook paused",
      description: webhook.url,
    })
    audit(enabled ? "enabled a webhook" : "paused a webhook", webhook.url)
    refresh()
  }

  function deleteWebhook(id: string) {
    const target = webhooks.find((item) => item.id === id)?.url
    removeProjectWebhook(projectId, id)
    toast({ title: "Webhook deleted" })
    audit("deleted a webhook", target)
    refresh()
  }

  function testWebhook(webhook: ProjectWebhook) {
    setTestingId(webhook.id)
    // Mock delivery — recorded in the log without an HTTP request.
    fireProjectTestWebhook(projectId, webhook)
    setTestingId(null)
    toast({
      title: "Test delivery recorded",
      description: `${webhook.url} — mock delivery logged below.`,
    })
    audit("test-fired a webhook", webhook.url)
    refresh()
  }

  function clearDeliveries() {
    clearProjectWebhookDeliveries(projectId)
    refresh()
  }

  // Derive the edited webhook from the list so saves are reflected if the
  // dialog is reopened; dialogState only carries the id captured at click time.
  const editing =
    dialogState?.mode === "edit"
      ? (webhooks.find((item) => item.id === dialogState.webhook.id) ?? dialogState.webhook)
      : null

  return (
    <div className="app-page-card" aria-labelledby="project-settings-webhooks-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="project-settings-webhooks-heading">Webhooks</h2>
          <p className="app-page-subtitle">
            Endpoint URLs that receive signed event payloads for this project. Configuration is
            stored in this browser until the webhooks API ships.
          </p>
        </div>
        <Button type="button" onClick={() => setDialogState({ mode: "create" })}>
          New webhook
        </Button>
      </div>
      {webhooks.length === 0 ? (
        <EmptyState
          icon={<Webhook aria-hidden="true" />}
          title="No webhooks yet"
          body="Create a webhook to notify an external service when project events happen."
          primaryAction={{
            label: "New webhook",
            onClick: () => setDialogState({ mode: "create" }),
          }}
        />
      ) : (
        <ul className="grid gap-2">
          {webhooks.map((webhook) => (
            <li
              key={webhook.id}
              className="border-border bg-card flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <code className="block truncate text-sm font-medium">{webhook.url}</code>
                <p className="text-muted-foreground text-sm">
                  {webhook.events.length} event{webhook.events.length === 1 ? "" : "s"} ·{" "}
                  {webhook.events.join(", ")}
                </p>
                <p className="text-muted-foreground text-xs">
                  Created {formatDateTime(webhook.createdAt)}
                  {webhook.secret ? " · signed" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={webhook.enabled}
                  onCheckedChange={() => toggleWebhook(webhook)}
                  aria-label={`Enable deliveries for ${webhook.url}`}
                />
                <Badge variant={webhook.enabled ? "secondary" : "outline"}>
                  {webhook.enabled ? "active" : "paused"}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => testWebhook(webhook)}
                  disabled={testingId === webhook.id}
                >
                  <Send aria-hidden="true" />
                  {testingId === webhook.id ? "Testing…" : "Test"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogState({ mode: "edit", webhook })}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteWebhook(webhook.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <div className="app-panel-head">
          <div>
            <h3 className="text-sm font-semibold">Delivery log</h3>
            <p className="text-muted-foreground text-sm">
              Recent test deliveries. Real event dispatch lands when the webhooks API ships.
            </p>
          </div>
          {deliveries.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={clearDeliveries}>
              Clear log
            </Button>
          ) : null}
        </div>
        {deliveries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No deliveries yet — use Test on a webhook to record a mock delivery.
          </p>
        ) : (
          <ul className="grid gap-2">
            {deliveries.map((delivery) => (
              <WebhookDeliveryRow key={delivery.id} delivery={delivery} />
            ))}
          </ul>
        )}
      </div>
      {dialogState ? (
        <WebhookDialog
          open
          initial={editing}
          onClose={() => setDialogState(null)}
          onSave={saveWebhook}
        />
      ) : null}
    </div>
  )
}

function TransferOwnershipDialog({
  project,
  open,
  onClose,
  onTransferred,
}: {
  project: ProjectDetails
  open: boolean
  onClose: () => void
  onTransferred: () => void
}) {
  const { toast } = useToast()
  const candidates = useMemo(
    () => project.members.filter((member) => member.user.id !== project.owner.id),
    [project.members, project.owner.id],
  )
  const [targetId, setTargetId] = useState<string>(candidates[0]?.user.id ?? "")
  const [confirmation, setConfirmation] = useState("")
  const target = candidates.find((member) => member.user.id === targetId)
  const transfer = useMutation((ownerId: string) =>
    api.projects.updateProject(project.id, { ownerId }),
  )
  const matches = confirmation.trim() === project.name

  useEffect(() => {
    if (open) {
      setTargetId(candidates[0]?.user.id ?? "")
      setConfirmation("")
    }
  }, [open, candidates])

  async function confirmTransfer() {
    if (!target) return
    try {
      await transfer.mutate(target.user.id)
      const targetName = target.user.name ?? target.user.email
      // The adapter records the "transferred ownership" activity event —
      // same convention as archive/reactivate, which don't audit locally.
      toast({
        title: `Ownership of “${project.name}” transferred`,
        description: `${targetName} is now the owner. You remain a member.`,
      })
      onClose()
      onTransferred()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not transfer ownership",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            The new owner gets full control of {project.name}, including settings and the danger
            zone. You will remain a member.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="app-page-subtitle">There are no other members to transfer ownership to.</p>
        ) : (
          <>
            <div className="app-field">
              <label htmlFor="transfer-target">New owner</label>
              <select
                id="transfer-target"
                className="border-input dark:bg-input/30 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                {candidates.map((member) => (
                  <option key={member.id} value={member.user.id}>
                    {member.user.name ?? member.user.email} ({member.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="app-field">
              <label htmlFor="transfer-confirmation">
                Type <strong>{project.name}</strong> to confirm
              </label>
              <Input
                id="transfer-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={project.name}
                autoFocus
              />
            </div>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!target || !matches || transfer.isLoading}
            onClick={confirmTransfer}
          >
            {transfer.isLoading ? "Transferring…" : "Transfer ownership"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DangerZoneTab({
  project,
  isOwner,
  onChanged,
}: {
  project: ProjectDetails
  isOwner: boolean
  onChanged: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [transferOpen, setTransferOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const isArchived = project.status === "archived"
  const archiveProject = useMutation(() =>
    api.projects.updateProject(project.id, { status: isArchived ? "active" : "archived" }),
  )
  const deleteProject = useMutation(() => api.projects.deleteProject(project.id))
  const matches = confirmation.trim() === project.name

  async function confirmArchive() {
    try {
      await archiveProject.mutate()
      toast({
        title: isArchived
          ? `Project “${project.name}” reactivated`
          : `Project “${project.name}” archived`,
        description: isArchived
          ? "The project is active again and visible to members."
          : "The project is hidden from the active list. You can reactivate it at any time.",
      })
      setArchiveOpen(false)
      onChanged()
    } catch (error) {
      toast({
        variant: "error",
        title: isArchived ? "Could not reactivate project" : "Could not archive project",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  async function confirmDelete() {
    try {
      await deleteProject.mutate()
      toast({ title: `Project “${project.name}” deleted` })
      // Replace, not push: going Back should not land on a deleted project.
      router.replace("/projects")
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not delete project",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <div
      className="app-page-card app-page-card--danger"
      aria-labelledby="project-settings-danger-heading"
    >
      <h2 id="project-settings-danger-heading">
        Danger zone {isArchived ? <Badge variant="outline">Archived</Badge> : null}
      </h2>
      <p className="app-page-subtitle">
        Lifecycle actions for {project.name}. Archiving is reversible; deleting is not. Only the
        project owner can run destructive actions.
      </p>

      <section className="app-danger-zone" aria-labelledby="project-archive-heading">
        <h3 id="project-archive-heading">
          {isArchived ? "Reactivate project" : "Archive project"}
        </h3>
        <div className="app-danger-row">
          <div>
            <strong>{isArchived ? "Reactivate this project" : "Archive this project"}</strong>
            <p>
              {isArchived
                ? `Restore ${project.name} to the active project list. Files, runs, and history are kept.`
                : `Hide ${project.name} from the active project list without deleting anything. You can reactivate it at any time.`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!isOwner || archiveProject.isLoading}
            onClick={() => setArchiveOpen(true)}
          >
            {isArchived ? "Reactivate project" : "Archive project"}
          </Button>
        </div>
      </section>

      <section className="app-danger-zone" aria-labelledby="project-transfer-heading">
        <h3 id="project-transfer-heading">Transfer ownership</h3>
        <div className="app-danger-row">
          <div>
            <strong>Make another member the owner</strong>
            <p>Hand control of {project.name} to another member. You stay on as a member.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!isOwner}
            onClick={() => setTransferOpen(true)}
          >
            <UserCog aria-hidden="true" />
            Transfer ownership
          </Button>
        </div>
      </section>

      <section className="app-danger-zone" aria-labelledby="project-delete-heading">
        <h3 id="project-delete-heading">Delete project</h3>
        <div className="app-danger-row">
          <div>
            <strong>Delete this project</strong>
            <p>
              Permanently remove {project.name} and all of its files, lab sessions, agent runs, and
              webhooks. Every member loses access. This cannot be undone.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={!isOwner}
            onClick={() => {
              setConfirmation("")
              setDeleteOpen(true)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete project
          </Button>
        </div>
        {!isOwner ? (
          <p className="app-page-subtitle">
            You are not the owner of this project, so destructive actions are disabled.
          </p>
        ) : null}
      </section>

      {transferOpen ? (
        <TransferOwnershipDialog
          project={project}
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          onTransferred={onChanged}
        />
      ) : null}

      <Dialog open={archiveOpen} onOpenChange={(open) => !open && setArchiveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isArchived ? "Reactivate project" : "Archive project"}</DialogTitle>
            <DialogDescription>
              {isArchived
                ? `Restore ${project.name} to the active project list. Nothing was deleted while it was archived.`
                : `Hide ${project.name} from the active project list. Files, lab sessions, agent runs, and webhooks are kept, and you can reactivate the project at any time.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={isArchived ? "default" : "outline"}
              disabled={archiveProject.isLoading}
              onClick={confirmArchive}
            >
              {archiveProject.isLoading
                ? isArchived
                  ? "Reactivating…"
                  : "Archiving…"
                : isArchived
                  ? "Reactivate project"
                  : "Archive project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              Permanently delete {project.name} and everything in it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
            <li>
              All {project.members.length}{" "}
              {project.members.length === 1 ? "member loses" : "members lose"} access immediately.
            </li>
            <li>
              Project files, lab sessions, agent runs, chat history, and webhook delivery logs are
              permanently deleted.
            </li>
            <li>Webhooks stop firing and cannot be recovered.</li>
          </ul>
          <div className="app-field">
            <label htmlFor="project-delete-confirmation">
              Type <strong>{project.name}</strong> to confirm
            </label>
            <Input
              id="project-delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={project.name}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!matches || deleteProject.isLoading}
              onClick={confirmDelete}
            >
              {deleteProject.isLoading ? "Deleting…" : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AuditLogTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <div className="app-page-card" aria-labelledby="project-settings-audit-heading">
      <h2 id="project-settings-audit-heading">Audit log</h2>
      <p className="app-page-subtitle">
        Recent settings changes for this project, newest first. Entries are stored locally in this
        browser until an audit API ships.
      </p>
      <SettingsAuditLog
        scope={`project:${projectId}`}
        projectId={projectId}
        projectName={projectName}
      />
    </div>
  )
}

function ProjectSettings({ projectId }: { projectId: string }) {
  const query = useProjectHome(projectId)
  const session = useSession()

  if (query.status !== "success" || !query.data) return null

  const project = query.data.project
  const isOwner = session.data != null && session.data.id === project.owner.id

  return (
    <div className="app-page">
      <header className="app-project-header app-project-header--compact">
        <nav className="app-breadcrumb" aria-label="Breadcrumb">
          <Link href="/dashboard">Dashboard</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/projects/${projectId}`}>{project.name}</Link>
          <span aria-hidden="true">/</span>
          <span>Settings</span>
        </nav>
        <h1>Settings</h1>
        <p className="app-page-lede">
          General preferences, members, notifications, integrations, webhooks, and danger zone for{" "}
          {project.name}.
        </p>
      </header>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab project={project} onSaved={query.refetch} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab project={project} onChanged={query.refetch} />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab projectId={projectId} projectName={project.name} />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab projectId={projectId} projectName={project.name} />
        </TabsContent>
        <TabsContent value="danger">
          <DangerZoneTab project={project} isOwner={isOwner} onChanged={query.refetch} />
        </TabsContent>
      </Tabs>

      <p className="app-generated-at">Data generated {formatDateTime(query.data.generatedAt)}</p>
    </div>
  )
}

/** Project settings screen: general form, integrations, webhooks, danger zone. */
export function ProjectSettingsScreen({ projectId }: { projectId: string }) {
  const query = useProjectHome(projectId)

  return (
    <ScreenState
      screen="project"
      status={query.status}
      data={query.data}
      error={query.error}
      isEmpty={query.mode === "empty"}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {() => <ProjectSettings projectId={projectId} />}
    </ScreenState>
  )
}
