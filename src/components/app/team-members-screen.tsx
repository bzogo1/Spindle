"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  Check,
  ChevronDown,
  Download,
  MailPlus,
  RotateCcw,
  UserCog,
  UserPlus,
  UserRoundX,
  type LucideIcon,
} from "lucide-react"

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DataTable, type DataTableColumn } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { getAvatarInitials } from "@/components/ui/avatar"
import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { InvitationAnalyticsPanel } from "@/components/app/invitation-analytics-panel"
import { useApiQuery } from "@/lib/api/use-api-query"
import { useMockSession } from "@/components/app/mock-session-provider"
import {
  canAssignRole,
  canChangeMemberRole,
  canInviteMembers,
  canManageInvites,
  canManageMembers,
  canRemoveMember,
  computeBulkTargets,
  type WorkspaceRole,
} from "@/lib/members/permissions"

import { formatDate, formatDateTime, formatRelativeTime } from "./format"

type MemberRole = WorkspaceRole
type MemberStatus = "active" | "away" | "offline"

interface TeamMember {
  id: string
  name: string
  email: string
  role: MemberRole
  status: MemberStatus
  joinedAt: string
}

interface TeamInvite {
  id: string
  email: string
  role: MemberRole
  sentAt: string
  expiresAt: string
}

/** Client-facing invitation payload returned by `/api/invitations*`. */
interface ApiInvitation {
  id: string
  email: string
  role: MemberRole
  status: string
  sentAt: string
  expiresAt: string
}

/** Maps an API invitation to a roster row; non-pending invites are hidden. */
function apiInviteToTeamInvite(invitation: ApiInvitation): TeamInvite | null {
  if (invitation.status !== "pending") return null
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    sentAt: invitation.sentAt,
    expiresAt: invitation.expiresAt,
  }
}

interface TeamSnapshot {
  members: TeamMember[]
  invites: TeamInvite[]
}

const MEMBER_ROLES: { value: MemberRole; label: string; hint: string }[] = [
  {
    value: "owner",
    label: "Owner",
    hint: "Full control over the workspace, billing, and members.",
  },
  {
    value: "admin",
    label: "Admin",
    hint: "Manage projects, invites, and most workspace settings.",
  },
  {
    value: "member",
    label: "Member",
    hint: "Standard access to shared projects and content.",
  },
]

function roleHint(role: MemberRole) {
  return MEMBER_ROLES.find((option) => option.value === role)?.hint ?? ""
}

const STATUS_SORT_ORDER: Record<MemberStatus, number> = {
  active: 0,
  away: 1,
  offline: 2,
}

const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: "mem_01",
    name: "Bogdan Zogovic",
    email: "bogdan@northlight.dev",
    role: "owner",
    status: "active",
    joinedAt: "2026-01-12T09:00:00.000Z",
  },
  {
    id: "mem_02",
    name: "Mara Chen",
    email: "mara@northlight.dev",
    role: "admin",
    status: "active",
    joinedAt: "2026-05-11T15:30:00.000Z",
  },
  {
    id: "mem_03",
    name: "Ilya Petrov",
    email: "ilya@northlight.dev",
    role: "member",
    status: "away",
    joinedAt: "2026-06-02T09:45:00.000Z",
  },
  {
    id: "mem_04",
    name: "June Park",
    email: "june@northlight.dev",
    role: "member",
    status: "offline",
    joinedAt: "2026-07-19T11:15:00.000Z",
  },
]

const INITIAL_INVITES: TeamInvite[] = [
  {
    id: "inv_01",
    email: "theo@northlight.dev",
    role: "admin",
    sentAt: "2026-11-17T12:00:00.000Z",
    expiresAt: "2026-11-24T12:00:00.000Z",
  },
  {
    id: "inv_02",
    email: "ana@northlight.dev",
    role: "member",
    sentAt: "2026-11-15T12:00:00.000Z",
    expiresAt: "2026-11-22T12:00:00.000Z",
  },
]

const EMPTY_SNAPSHOT: TeamSnapshot = { members: [], invites: [] }

/** Membership events shown in the activity log — a local preview until a team-events API lands. */
type MemberActivityKind = "joined" | "invited" | "role-changed" | "removed"

interface MemberActivityEvent {
  id: string
  kind: MemberActivityKind
  /** Display name of whoever caused the event (member themselves for "joined"). */
  actor: string
  summary: string
  target?: string
  createdAt: string
}

const MEMBER_ACTIVITY_META: Record<MemberActivityKind, { label: string; icon: LucideIcon }> = {
  joined: { label: "joined", icon: UserPlus },
  invited: { label: "invited", icon: MailPlus },
  "role-changed": { label: "role changed", icon: UserCog },
  removed: { label: "removed", icon: UserRoundX },
}

function sortActivity(events: MemberActivityEvent[]) {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function baselineActivity(data: TeamSnapshot): MemberActivityEvent[] {
  return sortActivity([
    ...data.members.map((member) => ({
      id: `act_joined_${member.id}`,
      kind: "joined" as const,
      actor: member.name,
      summary: "joined the workspace",
      createdAt: member.joinedAt,
    })),
    ...data.invites.map((invite) => ({
      id: `act_invited_${invite.id}`,
      kind: "invited" as const,
      // The inviter isn't part of the snapshot — fall back to a neutral actor.
      actor: "Workspace",
      summary: "sent an invite to",
      target: `${invite.email} · ${roleLabel(invite.role)}`,
      createdAt: invite.sentAt,
    })),
  ])
}

/** Whether an activity event refers to `member` (as actor or as the event target). */
function activityMentionsMember(event: MemberActivityEvent, member: TeamMember) {
  const haystack = `${event.actor} ${event.summary} ${event.target ?? ""}`.toLowerCase()
  return (
    haystack.includes(member.name.toLowerCase()) || haystack.includes(member.email.toLowerCase())
  )
}

/**
 * Local stand-in for a workspace members endpoint — the API contract has no
 * team/invitation resource yet, so the screen loads its snapshot through
 * `useApiQuery` to get the standard loading/error/empty handling (including
 * the `?mock=` state controls) until a real endpoint lands.
 */
function fetchTeamSnapshot(): Promise<TeamSnapshot> {
  return Promise.resolve({ members: INITIAL_MEMBERS, invites: INITIAL_INVITES })
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

function roleLabel(role: MemberRole) {
  return MEMBER_ROLES.find((option) => option.value === role)?.label ?? role
}

function statusLabel(status: MemberStatus) {
  return status === "active" ? "Active" : status === "away" ? "Away" : "Offline"
}

function roleBadgeVariant(role: MemberRole) {
  if (role === "owner") return "default" as const
  if (role === "admin") return "secondary" as const
  return "outline" as const
}

function initials(name: string) {
  return getAvatarInitials(name)
}

function nextInviteId(invites: TeamInvite[]) {
  const highest = invites.reduce((max, invite) => {
    const suffix = Number(invite.id.replace(/\D/g, ""))
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max
  }, 0)
  return `inv_${String(highest + 1).padStart(2, "0")}`
}

function csvCell(cell: string) {
  return `"${cell.replaceAll('"', '""')}"`
}

/**
 * Member export payload as CSV: one row per member with
 * `name,email,role,status,joinedAt` columns, in roster order. Role and
 * status are the human-readable labels; `joinedAt` stays an ISO timestamp
 * so the export stays machine-readable.
 */
export function memberExportCsv(members: TeamMember[]): string {
  const rows = [
    ["name", "email", "role", "status", "joinedAt"],
    ...members.map((member) => [
      member.name,
      member.email,
      roleLabel(member.role),
      statusLabel(member.status),
      member.joinedAt,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(",")).join("\n")
}

/** Same member data as JSON: one object per member with the exported fields. */
export function memberExportJson(members: TeamMember[]): string {
  return JSON.stringify(
    members.map((member) => ({
      name: member.name,
      email: member.email,
      role: roleLabel(member.role),
      status: statusLabel(member.status),
      joinedAt: member.joinedAt,
    })),
    null,
    2,
  )
}

function downloadMemberExport(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportMembersCsv(members: TeamMember[]) {
  downloadMemberExport("spindle-members.csv", memberExportCsv(members), "text/csv;charset=utf-8")
}

function exportMembersJson(members: TeamMember[]) {
  downloadMemberExport("spindle-members.json", memberExportJson(members), "application/json")
}

function MemberAvatar({ member }: { member: TeamMember }) {
  return (
    <span className="app-member-avatar" aria-hidden="true">
      {initials(member.name)}
    </span>
  )
}

/** One row of the member activity log — mirrors the shared ActivityFeed markup. */
function MemberActivityItem({ event }: { event: MemberActivityEvent }) {
  const meta = MEMBER_ACTIVITY_META[event.kind]
  const KindIcon = meta.icon

  return (
    <li>
      <span className="app-activity-avatar" aria-hidden="true">
        {getAvatarInitials(event.actor)}
      </span>
      <span className="app-activity-kind">
        <KindIcon aria-hidden="true" />
        {meta.label}
      </span>
      <div>
        <p>
          <strong>{event.actor}</strong> {event.summary}
          {event.target ? (
            <>
              {" "}
              <span className="app-activity-target">{event.target}</span>
            </>
          ) : null}
        </p>
        <small>
          Workspace
          {" · "}
          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
            {formatRelativeTime(event.createdAt)}
          </time>
        </small>
      </div>
    </li>
  )
}

function MemberRoleMenu({
  member,
  allowedRoles,
  onRoleChange,
}: {
  member: TeamMember
  /** Roles the current actor may assign to this member; empty renders a plain badge. */
  allowedRoles: MemberRole[]
  onRoleChange: (memberId: string, role: MemberRole) => void
}) {
  if (allowedRoles.length === 0) {
    return (
      <Badge variant={roleBadgeVariant(member.role)} className="app-role-badge">
        {roleLabel(member.role)}
      </Badge>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="app-role-menu-trigger"
        aria-label={`Change role for ${member.name}`}
      >
        <Badge variant={roleBadgeVariant(member.role)} className="app-role-badge">
          {roleLabel(member.role)}
        </Badge>
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="app-menu">
        <DropdownMenuLabel>Change role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MEMBER_ROLES.filter((option) => allowedRoles.includes(option.value)).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onRoleChange(member.id, option.value)}
            aria-current={member.role === option.value ? "true" : undefined}
          >
            <span className="app-menu-item-label">{option.label}</span>
            {member.role === option.value ? (
              <Check className="app-menu-check" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InviteMemberDialog({
  open,
  onOpenChange,
  existingEmails,
  assignableRoles,
  onInvite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingEmails: string[]
  /** Roles the current actor may grant; e.g. admins never see "Owner". */
  assignableRoles: MemberRole[]
  onInvite: (invite: { email: string; role: MemberRole }) => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [error, setError] = useState("")
  const roleOptions = MEMBER_ROLES.filter((option) => assignableRoles.includes(option.value))

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail("")
      setRole("member")
      setError("")
    }
    onOpenChange(nextOpen)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanEmail = email.trim().toLowerCase()

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setError("Enter a valid email address.")
      return
    }
    if (existingEmails.includes(cleanEmail)) {
      setError("That person is already a member or has a pending invite.")
      return
    }

    // Clamp to a grantable role in case permissions changed while open.
    const grantableRole = assignableRoles.includes(role) ? role : assignableRoles[0]
    if (!grantableRole) {
      setError("Your role cannot grant any workspace role.")
      return
    }
    onInvite({ email: cleanEmail, role: grantableRole })
    setEmail("")
    setRole("member")
    setError("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Send a workspace invite. The invite will appear under pending invites until it is
            accepted.
          </DialogDescription>
        </DialogHeader>
        <form className="app-form" onSubmit={submit}>
          <div className="app-field">
            <label htmlFor="invite-member-email">Email</label>
            <Input
              id="invite-member-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@company.com"
              required
              autoFocus
            />
          </div>
          <div className="app-field">
            <label htmlFor="invite-member-role">Role</label>
            <select
              id="invite-member-role"
              className="app-select"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{roleHint(role)}</p>
          </div>
          {error ? <InlineError title="Could not send invite" message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send invite</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Detail view for one roster row — profile facts, the role control, and the member's slice of the activity log. */
function MemberDetailDialog({
  member,
  events,
  allowedRoles,
  canRemove,
  onOpenChange,
  onRoleChange,
  onRemove,
}: {
  member: TeamMember | null
  events: MemberActivityEvent[]
  /** Roles the current actor may assign to this member; empty renders a plain badge. */
  allowedRoles: MemberRole[]
  canRemove: boolean
  onOpenChange: (open: boolean) => void
  onRoleChange: (memberId: string, role: MemberRole) => void
  onRemove: (member: TeamMember) => void
}) {
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
    >
      <DialogContent>
        {member ? (
          <>
            <DialogHeader>
              <div className="app-member-detail-person">
                <MemberAvatar member={member} />
                <div>
                  <DialogTitle>{member.name}</DialogTitle>
                  <DialogDescription>{member.email}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <dl className="app-project-meta">
              <div>
                <dt>Email</dt>
                <dd>{member.email}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className="app-member-status">
                    <span className={`app-status-dot is-${member.status}`} aria-hidden="true" />
                    {statusLabel(member.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>{formatDate(member.joinedAt)}</dd>
              </div>
              <div>
                <dt>Workspace role</dt>
                <dd>
                  <MemberRoleMenu
                    member={member}
                    allowedRoles={allowedRoles}
                    onRoleChange={onRoleChange}
                  />
                </dd>
              </div>
            </dl>

            {events.length > 0 ? (
              <div className="app-member-detail-activity">
                <h3>Recent activity</h3>
                <ol className="app-activity-list">
                  {events.map((event) => (
                    <MemberActivityItem key={event.id} event={event} />
                  ))}
                </ol>
              </div>
            ) : null}

            <DialogFooter>
              {canRemove ? (
                <Button type="button" variant="destructive" onClick={() => onRemove(member)}>
                  Remove member
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function TeamMembersScreen() {
  const { toast } = useToast()
  const { user, workspace } = useMockSession()
  const teamQuery = useApiQuery(fetchTeamSnapshot, [], true, EMPTY_SNAPSHOT)

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvite[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null)
  const [memberDetailId, setMemberDetailId] = useState<string | null>(null)
  const [inviteToRevoke, setInviteToRevoke] = useState<TeamInvite | null>(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [bulkRoleChange, setBulkRoleChange] = useState<MemberRole | null>(null)
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false)
  const [roleFilter, setRoleFilter] = useState<"all" | MemberRole>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | MemberStatus>("all")
  const [activity, setActivity] = useState<MemberActivityEvent[]>([])
  const [announcement, setAnnouncement] = useState("")
  const seededRef = useRef(false)
  const activitySeqRef = useRef(0)

  const actorName = user?.name ?? workspace?.name ?? "Workspace"

  function pushActivity(event: Omit<MemberActivityEvent, "id" | "createdAt">) {
    activitySeqRef.current += 1
    const entry: MemberActivityEvent = {
      id: `act_live_${Date.now().toString(36)}_${activitySeqRef.current}`,
      createdAt: new Date().toISOString(),
      ...event,
    }
    setActivity((current) => sortActivity([entry, ...current]))
  }

  // Seed the editable lists once the snapshot resolves. Invites added before
  // the snapshot lands (e.g. via the header button while loading) are merged
  // in rather than overwritten.
  useEffect(() => {
    const data = teamQuery.data
    if (!data || seededRef.current) return
    seededRef.current = true
    setMembers((current) => (current.length > 0 ? current : data.members))
    setInvites((current) => {
      const known = new Set(current.map((invite) => invite.id))
      return [...current, ...data.invites.filter((invite) => !known.has(invite.id))]
    })
    // Same merge for the activity log: snapshot-derived "joined"/"invited"
    // events merge with any session events recorded before the load finished.
    setActivity((current) => {
      const known = new Set(current.map((event) => event.id))
      return sortActivity([
        ...current,
        ...baselineActivity(data).filter((event) => !known.has(event.id)),
      ])
    })
  }, [teamQuery.data])

  const ready = teamQuery.status === "success"

  // Merge server-side invitations (created via /api/invitations) into the
  // pending list once the local snapshot has seeded. Deduped by email so a
  // local preview invite and its API counterpart never double-list; failures
  // are silent — the screen keeps working as a local preview.
  const remoteInvitesLoadedRef = useRef(false)
  useEffect(() => {
    if (!ready || remoteInvitesLoadedRef.current) return
    remoteInvitesLoadedRef.current = true
    let cancelled = false
    fetch("/api/invitations", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { ok?: boolean; invitations?: ApiInvitation[] } | null) => {
        if (cancelled || !body?.ok || !Array.isArray(body.invitations)) return
        const remote = body.invitations
          .map(apiInviteToTeamInvite)
          .filter((invite): invite is TeamInvite => invite !== null)
        if (remote.length === 0) return
        setInvites((current) => {
          const knownEmails = new Set(current.map((invite) => invite.email.toLowerCase()))
          return [
            ...current,
            ...remote.filter((invite) => !knownEmails.has(invite.email.toLowerCase())),
          ]
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ready])

  const existingEmails = [
    ...members.map((member) => member.email.toLowerCase()),
    ...invites.map((invite) => invite.email.toLowerCase()),
  ]

  // Role and status filters compose with each other and with the DataTable's
  // built-in search box (which matches name, email, role, and status text).
  const visibleMembers = members.filter(
    (member) =>
      (roleFilter === "all" || member.role === roleFilter) &&
      (statusFilter === "all" || member.status === statusFilter),
  )

  // RBAC: the actor is the signed-in session user. Their role comes from the
  // members roster when their email matches a row (kept fresh by role changes
  // made here), then from the session workspace, and finally falls back to
  // the least-privileged role so unknown users see a read-only view.
  const sessionEmail = user?.email.toLowerCase()
  const actorMember = members.find((member) => member.email.toLowerCase() === sessionEmail)
  const actorRole: MemberRole = actorMember?.role ?? workspace?.role ?? "member"
  const actor = actorMember ?? (user ? { id: `session:${user.email}`, role: actorRole } : null)
  const canInvite = canInviteMembers(actorRole)
  const canManagePendingInvites = canManageInvites(actorRole)
  const assignableRoles = MEMBER_ROLES.map((option) => option.value).filter((role) =>
    canAssignRole(actorRole, role),
  )

  // Roles the actor may assign to `member` — shared by the row menu, the
  // detail dialog, and the bulk role-change eligibility checks.
  function allowedRolesFor(member: TeamMember): MemberRole[] {
    if (actor === null) return []
    return MEMBER_ROLES.map((option) => option.value).filter((role) =>
      canChangeMemberRole(actor, member, members, role),
    )
  }

  // The detail dialog tracks a member id (not the row object) so it stays in
  // sync with role changes/removals made elsewhere on the screen.
  const detailMember = memberDetailId
    ? (members.find((member) => member.id === memberDetailId) ?? null)
    : null
  const detailAllowedRoles = detailMember !== null ? allowedRolesFor(detailMember) : []
  const detailCanRemove =
    detailMember !== null && actor !== null && canRemoveMember(actor, detailMember, members)
  const detailEvents = detailMember
    ? activity.filter((event) => activityMentionsMember(event, detailMember))
    : []

  // --- Bulk selection -------------------------------------------------
  // Checkboxes only appear when the actor could actually act on at least
  // one roster row; member-role sessions keep the read-only table.
  const canSelectMembers =
    actor !== null &&
    canManageMembers(actorRole) &&
    members.some(
      (member) =>
        canRemoveMember(actor, member, members) ||
        allowedRolesFor(member).some((role) => role !== member.role),
    )

  const selectedMembers = members.filter((member) => selectedMemberIds.includes(member.id))

  /**
   * Selected members a bulk action would actually affect right now. Both the
   * dialog/count derivations and the confirm handlers go through
   * `computeBulkTargets` so the sequential last-owner budget is applied
   * identically everywhere — per-member checks alone would let two selected
   * owners both look eligible.
   */
  function bulkRoleTargets(role: MemberRole): TeamMember[] {
    return computeBulkTargets(
      actor,
      selectedMembers,
      members,
      (member) => member.role !== role && allowedRolesFor(member).includes(role),
    )
  }

  /** Selected members the actor could remove right now. */
  const bulkRemovableMembers = computeBulkTargets(
    actor,
    selectedMembers,
    members,
    (member) => actor !== null && canRemoveMember(actor, member, members),
  )

  const bulkRoleNames = (role: MemberRole) =>
    bulkRoleTargets(role)
      .map((member) => member.name)
      .join(", ")

  function announce(message: string) {
    setAnnouncement(message)
  }

  function denyPermission(action: string) {
    announce(`You don't have permission to ${action}.`)
    toast.warning(`You don't have permission to ${action}.`)
  }

  function changeRole(memberId: string, role: MemberRole) {
    const member = members.find((item) => item.id === memberId)
    if (!member || member.role === role) return
    if (!actor || !canChangeMemberRole(actor, member, members, role)) {
      denyPermission(`change ${member.name}'s role`)
      return
    }
    setMembers((current) =>
      current.map((item) => (item.id === memberId ? { ...item, role } : item)),
    )
    pushActivity({
      kind: "role-changed",
      actor: actorName,
      summary: `changed ${member.name}'s role`,
      target: `${roleLabel(member.role)} → ${roleLabel(role)}`,
    })
    announce(`Role for ${member.name} updated to ${roleLabel(role)}.`)
    toast({
      variant: "success",
      title: `${member.name} is now ${roleLabel(role)} (local preview).`,
    })
  }

  /** Records a successfully sent invite (API or local preview) in state + activity. */
  function recordInviteSent(newInvite: TeamInvite, announcement?: string) {
    setInvites((current) => [...current, newInvite])
    pushActivity({
      kind: "invited",
      actor: actorName,
      summary: "sent an invite to",
      target: `${newInvite.email} · ${roleLabel(newInvite.role)}`,
    })
    announce(announcement ?? `Invite sent to ${newInvite.email}.`)
  }

  async function addInvite(invite: { email: string; role: MemberRole }) {
    if (!canInviteMembers(actorRole) || !canAssignRole(actorRole, invite.role)) {
      denyPermission("send invites")
      return
    }

    // Real path first: POST /api/invitations creates the record server-side
    // and emails the accept link. The local preview is ONLY a fallback for a
    // missing/unreachable API (network failure or 404 — e.g. mock-only dev
    // without the routes deployed). Real API errors (401/403/429/5xx) are
    // surfaced to the user instead of faking a pending invite, so an
    // "Invite sent" claim is never made for an invite that was not created.
    let apiUnavailable = false
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: invite.email, role: invite.role }),
      })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        code?: string
        message?: string
        invitation?: ApiInvitation
      } | null
      if (response.ok && body?.invitation) {
        const remote = apiInviteToTeamInvite(body.invitation)
        if (remote) {
          recordInviteSent(remote)
          toast({ variant: "success", title: `Invite sent to ${invite.email}.` })
          return
        }
      }
      if (response.status === 409 || body?.code === "duplicate_pending") {
        announce(`A pending invite already exists for ${invite.email}.`)
        toast.warning(`A pending invite already exists for ${invite.email}.`)
        return
      }
      if (response.status === 404) {
        // The invitations routes aren't deployed in this environment —
        // treat like a network failure and use the local preview.
        apiUnavailable = true
      } else {
        const message =
          typeof body?.message === "string" && body.message.trim()
            ? body.message
            : "Couldn't send the invite. Try again."
        announce(message)
        toast.warning(message)
        return
      }
    } catch {
      // Network failure — the API is unreachable, use the local preview.
      apiUnavailable = true
    }
    if (!apiUnavailable) return

    const sentAt = new Date().toISOString()
    const newInvite: TeamInvite = {
      id: nextInviteId(invites),
      email: invite.email,
      role: invite.role,
      sentAt,
      expiresAt: new Date(Date.parse(sentAt) + INVITE_LIFETIME_MS).toISOString(),
    }
    recordInviteSent(
      newInvite,
      `Invite for ${invite.email} saved locally — the invitations API is unavailable.`,
    )
    toast({
      variant: "success",
      title: `Invite for ${invite.email} saved locally (API unavailable).`,
    })
  }

  async function resendInvite(invite: TeamInvite) {
    if (!canManageInvites(actorRole)) {
      denyPermission("resend invites")
      return
    }

    // Same contract as addInvite: the local preview is ONLY a fallback for
    // a missing/unreachable API (network failure or 404 — e.g. mock-only dev
    // without the routes deployed). Real API errors (401/403/429/5xx) are
    // surfaced to the user instead of silently re-dating a local invite.
    let apiUnavailable = false
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(invite.id)}/resend`, {
        method: "POST",
        headers: { accept: "application/json" },
      })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        code?: string
        message?: string
        invitation?: ApiInvitation
      } | null
      if (response.ok && body?.invitation) {
        const remote = apiInviteToTeamInvite(body.invitation)
        if (remote) {
          setInvites((current) => current.map((item) => (item.id === invite.id ? remote : item)))
          announce(`Invite resent to ${invite.email}.`)
          toast({ variant: "success", title: `Invite resent to ${invite.email}.` })
          return
        }
      }
      if (response.status === 404) {
        // The invitations routes aren't deployed in this environment —
        // treat like a network failure and use the local preview.
        apiUnavailable = true
      } else {
        const message =
          typeof body?.message === "string" && body.message.trim()
            ? body.message
            : "Couldn't resend the invite. Try again."
        announce(message)
        toast.warning(message)
        return
      }
    } catch {
      // Network failure — the API is unreachable, use the local preview.
      apiUnavailable = true
    }
    if (!apiUnavailable) return

    const sentAt = new Date().toISOString()
    setInvites((current) =>
      current.map((item) =>
        item.id === invite.id
          ? {
              ...item,
              sentAt,
              expiresAt: new Date(Date.parse(sentAt) + INVITE_LIFETIME_MS).toISOString(),
            }
          : item,
      ),
    )
    // Local-preview fallback (invite has no server-side record): qualify the
    // announcement so it doesn't claim a resend actually happened.
    announce(`Invite resend for ${invite.email} saved locally — API unavailable.`)
    toast({
      variant: "success",
      title: `Invite resent to ${invite.email} (local preview).`,
    })
  }

  function confirmRemoveMember() {
    if (!memberToRemove) return
    if (!actor || !canRemoveMember(actor, memberToRemove, members)) {
      denyPermission(`remove ${memberToRemove.name}`)
      setMemberToRemove(null)
      return
    }
    const removed = memberToRemove
    setMembers((current) => current.filter((member) => member.id !== removed.id))
    pushActivity({
      kind: "removed",
      actor: actorName,
      summary: "removed",
      target: `${removed.name} (${removed.email})`,
    })
    announce(`${removed.name} was removed from the workspace.`)
    toast({
      variant: "success",
      title: `${memberToRemove.name} was removed (local preview).`,
    })
    setMemberToRemove(null)
    setSelectedMemberIds((current) => current.filter((id) => id !== removed.id))
  }

  /**
   * Applies the pending bulk role change. Eligibility is recomputed against
   * the live roster so permission and last-owner checks reflect the current
   * state; members the actor can't touch are simply skipped. Uses the same
   * `computeBulkTargets` budget as the dialog/count derivations.
   */
  function confirmBulkRoleChange() {
    const role = bulkRoleChange
    setBulkRoleChange(null)
    if (!role || !actor) return

    const targets = bulkRoleTargets(role)
    if (targets.length === 0) return

    const targetIds = new Set(targets.map((member) => member.id))
    setMembers((current) =>
      current.map((item) => (targetIds.has(item.id) ? { ...item, role } : item)),
    )
    targets.forEach((member) => {
      pushActivity({
        kind: "role-changed",
        actor: actorName,
        summary: `changed ${member.name}'s role`,
        target: `${roleLabel(member.role)} → ${roleLabel(role)}`,
      })
    })
    const noun = targets.length === 1 ? "member" : "members"
    announce(`Role updated to ${roleLabel(role)} for ${targets.length} ${noun}.`)
    toast({
      variant: "success",
      title: `Updated ${targets.length} ${noun} to ${roleLabel(role)} (local preview).`,
    })
    setSelectedMemberIds([])
  }

  /** Removes every selected member the actor is allowed to remove. */
  function confirmBulkRemoveMembers() {
    setBulkRemoveOpen(false)
    if (!actor) return

    const targets = bulkRemovableMembers
    if (targets.length === 0) return

    const targetIds = new Set(targets.map((member) => member.id))
    setMembers((current) => current.filter((member) => !targetIds.has(member.id)))
    targets.forEach((member) => {
      pushActivity({
        kind: "removed",
        actor: actorName,
        summary: "removed",
        target: `${member.name} (${member.email})`,
      })
    })
    const noun = targets.length === 1 ? "member" : "members"
    announce(`${targets.length} ${noun} removed from the workspace.`)
    toast({
      variant: "success",
      title: `${targets.length} ${noun} removed (local preview).`,
    })
    setSelectedMemberIds([])
  }

  function openMemberDetail(member: TeamMember) {
    setMemberDetailId(member.id)
  }

  function removeMemberFromDetail(member: TeamMember) {
    // Swap the detail dialog for the removal confirmation — stacking two
    // modal dialogs would leave the member row ambiguous about which is on top.
    setMemberDetailId(null)
    setMemberToRemove(member)
  }

  function confirmRevokeInvite() {
    if (!inviteToRevoke) return
    if (!canManageInvites(actorRole)) {
      denyPermission("revoke invites")
      setInviteToRevoke(null)
      return
    }
    // Revoke server-side too when the invite came from the API (its id is the
    // store id); local-only preview ids 404 harmlessly. Fire-and-forget: the
    // local removal below is authoritative for the UI either way.
    void fetch(`/api/invitations/${encodeURIComponent(inviteToRevoke.id)}`, {
      method: "DELETE",
    }).catch(() => {})
    setInvites((current) => current.filter((invite) => invite.id !== inviteToRevoke.id))
    announce(`Invite for ${inviteToRevoke.email} was revoked.`)
    toast({
      variant: "success",
      title: `Invite for ${inviteToRevoke.email} was revoked (local preview).`,
    })
    setInviteToRevoke(null)
  }

  const memberColumns: DataTableColumn<TeamMember>[] = [
    {
      id: "member",
      header: "Member",
      sortValue: (member) => member.name,
      filterText: (member) => `${member.name} ${member.email}`,
      cell: (member) => (
        <div className="app-member-cell">
          <MemberAvatar member={member} />
          <strong>{member.name}</strong>
        </div>
      ),
    },
    {
      id: "email",
      header: "Email",
      sortValue: (member) => member.email,
      filterText: (member) => member.email,
      cell: (member) => member.email,
    },
    {
      id: "role",
      header: "Role",
      sortValue: (member) => roleLabel(member.role),
      filterText: (member) => roleLabel(member.role),
      cell: (member) => (
        <MemberRoleMenu
          member={member}
          allowedRoles={allowedRolesFor(member)}
          onRoleChange={changeRole}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (member) => STATUS_SORT_ORDER[member.status],
      filterText: (member) => statusLabel(member.status),
      cell: (member) => (
        <span className="app-member-status">
          <span className={`app-status-dot is-${member.status}`} aria-hidden="true" />
          {statusLabel(member.status)}
        </span>
      ),
    },
    {
      id: "joined",
      header: "Joined",
      sortValue: (member) => member.joinedAt,
      cell: (member) => formatDate(member.joinedAt),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "app-members-table-actions",
      cell: (member) => (
        <div className="app-member-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`View details for ${member.name}`}
            onClick={() => openMemberDetail(member)}
          >
            Details
          </Button>
          {actor !== null && canRemoveMember(actor, member, members) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${member.name}`}
              onClick={() => setMemberToRemove(member)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="app-page app-team-members">
      <header className="app-dashboard-header">
        <div className="app-dashboard-heading">
          <p className="app-eyebrow">Workspace</p>
          <h1 className="app-page-title">Team members</h1>
          <p className="app-page-lede">
            Manage workspace roles, pending invites, and member access. Member data is a local
            preview until the team API lands.
          </p>
        </div>
        {canInvite ? (
          <Button type="button" onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden="true" />
            Invite member
          </Button>
        ) : null}
      </header>

      <p className="sr-only" role="status">
        {announcement}
      </p>

      <section className="app-panel" aria-labelledby="members-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="members-heading">Members</h2>
            <p>
              {ready
                ? `${members.length} workspace member${members.length === 1 ? "" : "s"}.`
                : "Loading workspace members…"}
            </p>
          </div>
        </div>

        {teamQuery.status === "error" ? (
          <ErrorState
            title="Couldn't load team members"
            error={teamQuery.error}
            isRetrying={teamQuery.isRetrying}
            onRetry={teamQuery.refetch}
          />
        ) : members.length === 0 && ready ? (
          <EmptyState
            icon={<UserRoundX aria-hidden="true" />}
            title="No members"
            body={
              canInvite
                ? "Invite a teammate to give them access to this workspace."
                : "This workspace has no members yet."
            }
            primaryAction={
              canInvite
                ? {
                    label: "Invite member",
                    onClick: () => setInviteOpen(true),
                  }
                : undefined
            }
          />
        ) : (
          <DataTable
            data={visibleMembers}
            columns={memberColumns}
            getRowId={(member) => member.id}
            selectable={canSelectMembers}
            selectedIds={selectedMemberIds}
            onSelectionChange={setSelectedMemberIds}
            searchable
            searchPlaceholder="Search members…"
            loading={!ready}
            loadingRows={4}
            emptyState={
              <span className="text-muted-foreground">
                No members match the current search or filters.
              </span>
            }
            toolbar={
              <div className="flex items-center gap-3">
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  Role
                  <select
                    aria-label="Filter members by role"
                    value={roleFilter}
                    onChange={(event) => setRoleFilter(event.target.value as "all" | MemberRole)}
                    className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  >
                    <option value="all">All roles</option>
                    {MEMBER_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  Status
                  <select
                    aria-label="Filter members by status"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "all" | MemberStatus)
                    }
                    className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="away">Away</option>
                    <option value="offline">Offline</option>
                  </select>
                </label>
                {/* Exports cover the members matching the current role/status
                    filters; the DataTable's in-table search is internal to the
                    table, so it is intentionally not part of the export. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleMembers.length === 0}
                  onClick={() => exportMembersCsv(visibleMembers)}
                >
                  <Download aria-hidden="true" />
                  Export CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleMembers.length === 0}
                  onClick={() => exportMembersJson(visibleMembers)}
                >
                  <Download aria-hidden="true" />
                  Export JSON
                </Button>
              </div>
            }
          />
        )}
      </section>

      {selectedMembers.length > 0 ? (
        <div className="app-bulkbar" role="toolbar" aria-label="Selected members">
          <span>
            {selectedMembers.length} selected
            {bulkRemovableMembers.length < selectedMembers.length
              ? ` · ${bulkRemovableMembers.length} removable`
              : ""}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Change role for selected members"
              >
                Change role
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="app-menu">
              <DropdownMenuLabel>Set role for selected</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {MEMBER_ROLES.filter((option) => assignableRoles.includes(option.value)).map(
                (option) => {
                  const eligibleCount = bulkRoleTargets(option.value).length
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      disabled={eligibleCount === 0}
                      onSelect={() => setBulkRoleChange(option.value)}
                    >
                      <span className="app-menu-item-label">{option.label}</span>
                      <span className="text-muted-foreground text-xs">{eligibleCount}</span>
                    </DropdownMenuItem>
                  )
                },
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            aria-label="Remove selected members"
            disabled={bulkRemovableMembers.length === 0}
            onClick={() => setBulkRemoveOpen(true)}
          >
            Remove
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedMemberIds([])}>
            Clear
          </Button>
        </div>
      ) : null}

      <section className="app-panel" aria-labelledby="pending-invites-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="pending-invites-heading">Pending invites</h2>
            <p>Invites waiting for the recipient to accept.</p>
          </div>
        </div>

        {teamQuery.status === "loading" ? (
          <div role="status" aria-live="polite" aria-busy="true" className="grid gap-2">
            <span className="sr-only">Loading pending invites…</span>
            {[0, 1].map((index) => (
              <div
                key={index}
                className="border-border bg-muted/50 h-12 animate-pulse rounded-lg border"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : teamQuery.status === "error" ? (
          <p className="app-panel-empty">Pending invites are unavailable right now.</p>
        ) : invites.length === 0 ? (
          <p className="app-panel-empty">No pending invites.</p>
        ) : (
          <ul className="app-invite-list">
            {invites.map((invite) => (
              <li key={invite.id}>
                <div className="app-invite-person">
                  <span className="app-invite-avatar" aria-hidden="true">
                    <MailPlus />
                  </span>
                  <div>
                    <strong>{invite.email}</strong>
                    <small>
                      Sent {formatDate(invite.sentAt)} · Expires {formatDate(invite.expiresAt)}
                    </small>
                  </div>
                </div>
                <Badge variant={roleBadgeVariant(invite.role)}>{roleLabel(invite.role)}</Badge>
                {canManagePendingInvites ? (
                  <div className="app-invite-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-label={`Resend invite to ${invite.email}`}
                      onClick={() => resendInvite(invite)}
                    >
                      <RotateCcw aria-hidden="true" />
                      Resend
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Revoke invite to ${invite.email}`}
                      onClick={() => setInviteToRevoke(invite)}
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <InvitationAnalyticsPanel />

      <section className="app-panel" aria-labelledby="member-activity-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="member-activity-heading">Activity</h2>
            <p>Membership events for this workspace, newest first.</p>
          </div>
        </div>

        {teamQuery.status === "loading" ? (
          <p className="app-panel-empty">Loading activity…</p>
        ) : teamQuery.status === "error" ? (
          <p className="app-panel-empty">Activity is unavailable right now.</p>
        ) : activity.length === 0 ? (
          <p className="app-panel-empty">No membership activity yet.</p>
        ) : (
          <ol className="app-activity-list">
            {activity.map((event) => (
              <MemberActivityItem key={event.id} event={event} />
            ))}
          </ol>
        )}
      </section>

      <MemberDetailDialog
        member={detailMember}
        events={detailEvents}
        allowedRoles={detailAllowedRoles}
        canRemove={detailCanRemove}
        onOpenChange={(open) => {
          if (!open) setMemberDetailId(null)
        }}
        onRoleChange={changeRole}
        onRemove={removeMemberFromDetail}
      />

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        existingEmails={existingEmails}
        assignableRoles={assignableRoles}
        onInvite={addInvite}
      />

      <Dialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member?</DialogTitle>
            <DialogDescription>
              {memberToRemove
                ? `${memberToRemove.name} (${memberToRemove.email}) will lose access to this workspace immediately.`
                : "This member will lose access to the workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMemberToRemove(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmRemoveMember}>
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkRoleChange !== null}
        onOpenChange={(open) => {
          if (!open) setBulkRoleChange(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change roles?</DialogTitle>
            <DialogDescription>
              {bulkRoleChange
                ? `${bulkRoleNames(bulkRoleChange)} will be set to ${roleLabel(bulkRoleChange)}. Selected members outside your permissions are skipped.`
                : "The selected members will get a new workspace role."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkRoleChange(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmBulkRoleChange}>
              Change roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkRemoveOpen}
        onOpenChange={(open) => {
          if (!open) setBulkRemoveOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove members?</DialogTitle>
            <DialogDescription>
              {bulkRemovableMembers.length > 0
                ? `${bulkRemovableMembers.map((member) => member.name).join(", ")} will lose access to this workspace immediately. Selected members outside your permissions are skipped.`
                : "The selected members will lose access to the workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={bulkRemovableMembers.length === 0}
              onClick={confirmBulkRemoveMembers}
            >
              Remove members
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inviteToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setInviteToRevoke(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke invite?</DialogTitle>
            <DialogDescription>
              {inviteToRevoke
                ? `The pending invite for ${inviteToRevoke.email} will no longer be valid.`
                : "The pending invite will no longer be valid."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteToRevoke(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmRevokeInvite}>
              Revoke invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
