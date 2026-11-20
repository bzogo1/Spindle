"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ChevronDown, UserRoundX } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { EmptyState } from "@/components/app/states/empty-state"
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
import { DataTable, type DataTableColumn } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { getAvatarInitials } from "@/components/ui/avatar"
import {
  canChangeMemberRole,
  canManageMembers,
  canRemoveMember,
  isWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/members/permissions"

import { formatDate } from "../app/format"

/**
 * Workspace members screen for `/app/workspaces/[id]/members`.
 *
 * Loads `GET /api/workspaces/{id}/members` (roster + caller role + coarse
 * `canManage`) and mutates through
 * `PATCH|DELETE /api/workspaces/{id}/members/{userId}`. Per-row controls are
 * gated client-side by the pure helpers in `src/lib/members/permissions`
 * (self-changes, admin scope, and the last-owner rule all apply); the API
 * re-checks the same rules server-side, so a stale UI can never overreach.
 */

type MemberRole = WorkspaceRole

interface WorkspaceMember {
  id: string
  name: string | null
  email: string
  role: MemberRole
  joinedAt: string
}

interface MembersResponse {
  ok: boolean
  role?: string
  userId?: string
  canManage?: boolean
  members?: WorkspaceMember[]
  message?: string
}

interface MemberMutationResponse {
  ok: boolean
  member?: { id: string; name: string | null; email: string; role: string }
  message?: string
}

const MEMBER_ROLES: { value: MemberRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
]

/** Privilege order used only to decide which role changes need confirmation. */
const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 }

function roleLabel(role: MemberRole) {
  return MEMBER_ROLES.find((option) => option.value === role)?.label ?? role
}

function roleBadgeVariant(role: MemberRole) {
  if (role === "owner") return "default" as const
  if (role === "admin") return "secondary" as const
  return "outline" as const
}

function displayName(member: WorkspaceMember) {
  return member.name?.trim() || member.email
}

function memberInitials(member: WorkspaceMember) {
  return getAvatarInitials(displayName(member))
}

/**
 * Role changes that hand out ownership or strip a privileged role get a
 * confirmation step; routine member↔admin moves by an owner apply directly.
 */
function isSensitiveRoleChange(current: MemberRole, next: MemberRole) {
  return next === "owner" || ROLE_RANK[next] < ROLE_RANK[current]
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  return (
    <span className="app-member-avatar" aria-hidden="true">
      {memberInitials(member)}
    </span>
  )
}

function MemberRoleMenu({
  member,
  allowedRoles,
  disabled,
  onRoleChange,
}: {
  member: WorkspaceMember
  /** Roles the actor may assign to this member; empty renders a plain badge. */
  allowedRoles: MemberRole[]
  disabled: boolean
  onRoleChange: (member: WorkspaceMember, role: MemberRole) => void
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
        aria-label={`Change role for ${displayName(member)}`}
        disabled={disabled}
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
            onSelect={() => onRoleChange(member, option.value)}
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

function RoleChangeDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: { member: WorkspaceMember; role: MemberRole } | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change role?</DialogTitle>
          <DialogDescription>
            {pending
              ? `${displayName(pending.member)} (${pending.member.email}) will move from ${roleLabel(pending.member.role)} to ${roleLabel(pending.role)}. This grants or removes elevated workspace access.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Updating…" : "Change role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RemoveMemberDialog({
  member,
  busy,
  onCancel,
  onConfirm,
}: {
  member: WorkspaceMember | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove member?</DialogTitle>
          <DialogDescription>
            {member
              ? `${displayName(member)} (${member.email}) will lose access to this workspace immediately.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceMembersScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [role, setRole] = useState<MemberRole | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingRole, setPendingRole] = useState<{
    member: WorkspaceMember
    role: MemberRole
  } | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        cache: "no-store",
      })
      const data = (await response.json()) as MembersResponse
      if (!response.ok || !data.ok || !Array.isArray(data.members)) {
        setError(data.message ?? "Could not load workspace members.")
        setMembers([])
        return
      }
      setMembers(data.members)
      setRole(isWorkspaceRole(data.role) ? data.role : null)
      setUserId(data.userId ?? null)
    } catch {
      setError("Could not load workspace members. Check your connection and try again.")
      setMembers([])
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const actor = userId !== null && role !== null ? { id: userId, role } : null
  const canManage = canManageMembers(role)

  /** Roles the actor may assign to `member` — empty means badge-only. */
  function allowedRolesFor(member: WorkspaceMember): MemberRole[] {
    if (actor === null) return []
    return MEMBER_ROLES.map((option) => option.value).filter((nextRole) =>
      canChangeMemberRole(actor, member, members, nextRole),
    )
  }

  function canRemove(member: WorkspaceMember) {
    return actor !== null && canRemoveMember(actor, member, members)
  }

  function requestRoleChange(member: WorkspaceMember, nextRole: MemberRole) {
    if (member.role === nextRole) return
    if (actor === null || !canChangeMemberRole(actor, member, members, nextRole)) {
      toast.warning(`You don't have permission to change ${displayName(member)}'s role.`)
      return
    }
    if (isSensitiveRoleChange(member.role, nextRole)) {
      setPendingRole({ member, role: nextRole })
      return
    }
    void applyRoleChange(member, nextRole)
  }

  async function applyRoleChange(member: WorkspaceMember, nextRole: MemberRole) {
    setBusyMemberId(member.id)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${encodeURIComponent(member.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      )
      const data = (await response.json().catch(() => null)) as MemberMutationResponse | null
      if (!response.ok || !data?.ok || !isWorkspaceRole(data.member?.role)) {
        toast.warning(data?.message ?? `Couldn't update ${displayName(member)}'s role. Try again.`)
        return
      }
      const updatedRole = data.member.role as MemberRole
      setMembers((current) =>
        current.map((item) => (item.id === member.id ? { ...item, role: updatedRole } : item)),
      )
      toast({
        variant: "success",
        title: `${displayName(member)} is now ${roleLabel(updatedRole)}.`,
      })
    } catch {
      toast.warning(`Couldn't update ${displayName(member)}'s role. Check your connection.`)
    } finally {
      setBusyMemberId(null)
    }
  }

  function confirmRoleChange() {
    if (!pendingRole) return
    const { member, role: nextRole } = pendingRole
    setPendingRole(null)
    void applyRoleChange(member, nextRole)
  }

  async function confirmRemove() {
    if (!memberToRemove) return
    const member = memberToRemove
    setBusyMemberId(member.id)
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      )
      const data = (await response.json().catch(() => null)) as MemberMutationResponse | null
      if (!response.ok || !data?.ok) {
        toast.warning(data?.message ?? `Couldn't remove ${displayName(member)}. Try again.`)
        return
      }
      setMembers((current) => current.filter((item) => item.id !== member.id))
      toast({ variant: "success", title: `${displayName(member)} was removed.` })
      setMemberToRemove(null)
    } catch {
      toast.warning(`Couldn't remove ${displayName(member)}. Check your connection.`)
    } finally {
      setBusyMemberId(null)
    }
  }

  const loading = members.length === 0 && error === null && role === null
  const busy = busyMemberId !== null

  const columns: DataTableColumn<WorkspaceMember>[] = [
    {
      id: "member",
      header: "Member",
      sortValue: (member) => displayName(member),
      filterText: (member) => `${displayName(member)} ${member.email}`,
      cell: (member) => (
        <div className="app-member-cell">
          <MemberAvatar member={member} />
          <div>
            <strong>
              {member.name?.trim() || "Unnamed member"}
              {member.id === userId ? (
                <Badge variant="outline" size="sm" className="ml-2">
                  You
                </Badge>
              ) : null}
            </strong>
            <small>{member.email}</small>
          </div>
        </div>
      ),
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
          disabled={busyMemberId === member.id}
          onRoleChange={requestRoleChange}
        />
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
      cell: (member) =>
        canRemove(member) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${displayName(member)}`}
            disabled={busyMemberId === member.id}
            onClick={() => setMemberToRemove(member)}
          >
            <UserRoundX aria-hidden="true" />
            Remove
          </Button>
        ) : null,
    },
  ]

  return (
    <section className="app-page-card" aria-labelledby="workspace-members-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-members-heading">Members</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
        {members.length > 0 ? (
          <span className="text-muted-foreground text-sm">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        ) : null}
      </div>

      {!canManage && role !== null ? (
        <p className="text-muted-foreground text-sm" role="note">
          Only workspace owners and admins can change roles or remove members. You&apos;re a {role}{" "}
          of this workspace, so the roster below is read-only.
        </p>
      ) : null}

      {error ? (
        <InlineError
          title="Workspace members unavailable"
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
        <LoadingPanel label="Loading workspace members" variant="table" />
      ) : !error ? (
        <DataTable
          data={members}
          columns={columns}
          getRowId={(member) => member.id}
          stickyFirstColumn
          searchable
          searchPlaceholder="Search members…"
          pagination={members.length > 10}
          emptyState={
            <EmptyState title="No members yet" body="This workspace has no members to show." />
          }
        />
      ) : null}

      <RoleChangeDialog
        pending={pendingRole}
        busy={busy}
        onCancel={() => setPendingRole(null)}
        onConfirm={confirmRoleChange}
      />
      <RemoveMemberDialog
        member={memberToRemove}
        busy={busy}
        onCancel={() => setMemberToRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  )
}
