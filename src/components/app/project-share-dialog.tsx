"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { UserPlus } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
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
import { api, useMutation, useWorkspaceMembers } from "@/lib/api"
import type { ProjectDetails, ProjectMember, ProjectMemberGrantRole } from "@/lib/api/types"
import { useToast } from "@/components/ui/toast"

const ROLE_OPTIONS: { value: ProjectMemberGrantRole; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
]

const ROLE_LABELS: Record<ProjectMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

function memberName(member: ProjectMember) {
  return member.user.name ?? member.user.email
}

function memberBadgeVariant(role: ProjectMember["role"]) {
  if (role === "owner") return "default" as const
  if (role === "admin") return "secondary" as const
  return "outline" as const
}

/**
 * Project sharing modal: shows who already has access and lets the caller
 * grant a workspace member the `member` or `admin` project role through
 * `api.projects.addProjectMember`. Ownership is never assignable here — it
 * moves through the transfer flow on the settings danger zone.
 */
export function ProjectShareDialog({
  project,
  open,
  onOpenChange,
  onChanged,
}: {
  project: ProjectDetails
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a member is added so the parent can refetch project data. */
  onChanged: () => void
}) {
  const { toast } = useToast()
  const membersQuery = useWorkspaceMembers()
  const addMember = useMutation((input: { userId: string; role: ProjectMemberGrantRole }) =>
    api.projects.addProjectMember(project.id, input),
  )
  const [userId, setUserId] = useState("")
  const [role, setRole] = useState<ProjectMemberGrantRole>("member")
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setUserId("")
      setRole("member")
      setError("")
    }
  }, [open, project.id])

  const memberUserIds = useMemo(
    () => new Set(project.members.map((member) => member.user.id)),
    [project.members],
  )
  const candidates = useMemo(
    () => (membersQuery.data ?? []).filter((user) => !memberUserIds.has(user.id)),
    [membersQuery.data, memberUserIds],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const candidate = candidates.find((user) => user.id === userId)
    if (!candidate) {
      setError("Pick a workspace member to add.")
      return
    }
    const target = candidate.name ?? candidate.email
    try {
      await addMember.mutate({ userId: candidate.id, role })
      toast({ title: `${target} added to ${project.name}` })
      setUserId("")
      setRole("member")
      setError("")
      onChanged()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not add the member.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {project.name}</DialogTitle>
          <DialogDescription>
            Invite workspace members to collaborate on files, lab sessions, chat, and agent runs in
            this project.
          </DialogDescription>
        </DialogHeader>

        {project.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="grid gap-2">
            {project.members.map((member) => (
              <li
                key={member.id}
                className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="app-member-avatar" aria-hidden="true">
                    {getAvatarInitials(memberName(member))}
                  </span>
                  <div className="min-w-0">
                    <strong className="text-sm font-medium">{memberName(member)}</strong>
                    <p className="text-muted-foreground text-sm">{member.user.email}</p>
                  </div>
                </div>
                <Badge variant={memberBadgeVariant(member.role)}>{ROLE_LABELS[member.role]}</Badge>
              </li>
            ))}
          </ul>
        )}

        <form className="app-form" onSubmit={submit}>
          <div className="app-field">
            <label htmlFor="project-share-member">Add people</label>
            <select
              id="project-share-member"
              className="app-select"
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value)
                if (error) setError("")
              }}
              disabled={membersQuery.status === "loading" || addMember.isLoading}
            >
              <option value="">
                {membersQuery.status === "loading"
                  ? "Loading workspace members…"
                  : candidates.length === 0
                    ? "Everyone is already a member"
                    : "Select a workspace member…"}
              </option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email} ({user.email})
                </option>
              ))}
            </select>
          </div>
          <div className="app-field">
            <label htmlFor="project-share-role">Role</label>
            <select
              id="project-share-role"
              className="app-select"
              value={role}
              onChange={(event) => setRole(event.target.value as ProjectMemberGrantRole)}
              disabled={addMember.isLoading}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {membersQuery.status === "error" ? (
            <InlineError
              title="Workspace members did not load"
              message="The member list is unavailable, so nobody can be added right now."
            />
          ) : null}
          {error ? <InlineError title="Could not add member" message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={!userId || candidates.length === 0 || addMember.isLoading}
            >
              <UserPlus aria-hidden="true" />
              {addMember.isLoading ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
