"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import {
  BarChart3,
  Bot,
  Files,
  FlaskConical,
  Folder,
  HardDrive,
  History,
  MessageSquare,
  UserPlus,
} from "lucide-react"

import { ActivityFeed } from "@/components/app/activity-feed"
import { ProjectShareDialog } from "@/components/app/project-share-dialog"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getAvatarInitials } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useProjectHome } from "@/lib/api"
import { mergeActivityEvents } from "@/lib/activity/client"
import { useActivityEvents } from "@/lib/activity/use-activity-events"
import type { ProjectHomeData, ProjectMember, ProjectMemberRole } from "@/lib/api/types"

import { formatBytes, formatDate, formatRelativeTime } from "./format"
import { SharedElement } from "@/components/view-transitions/view-transitions"
import { viewTransitionName } from "@/components/view-transitions/vt-support"

function initials(name: string) {
  return getAvatarInitials(name)
}

function MemberAvatar({ member }: { member: ProjectMember }) {
  const label = member.user.name ?? member.user.email
  return (
    <span className="app-member-avatar" aria-hidden="true">
      {initials(label)}
    </span>
  )
}

function MemberStack({ members }: { members: ProjectMember[] }) {
  const visible = members.slice(0, 4)
  const extra = Math.max(members.length - visible.length, 0)

  if (visible.length === 0) return null

  return (
    <span className="app-member-stack" aria-label={`${members.length} members`}>
      {visible.map((member) => {
        const label = member.user.name ?? member.user.email
        return (
          <span key={member.id} className="app-member-avatar" title={label} aria-hidden="true">
            {initials(label)}
          </span>
        )
      })}
      {extra > 0 ? <span className="app-member-stack-count">+{extra}</span> : null}
    </span>
  )
}

function ProjectMembers({ members, onInvite }: { members: ProjectMember[]; onInvite: () => void }) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={<UserPlus aria-hidden="true" />}
        title="No members yet"
        body="Invite a teammate to collaborate on files, lab sessions, chat, and agent runs."
        primaryAction={{ label: "Invite member", onClick: onInvite }}
      />
    )
  }

  return (
    <ul className="app-member-list">
      {members.map((member) => (
        <li key={member.id}>
          <MemberAvatar member={member} />
          <div>
            <strong>{member.user.name ?? member.user.email}</strong>
            <small>{member.user.email}</small>
          </div>
          <Badge variant="secondary">{member.role}</Badge>
        </li>
      ))}
    </ul>
  )
}

function InviteMemberForm({
  projectId,
  members,
  onAdd,
  onCancel,
}: {
  projectId: string
  members: ProjectMember[]
  onAdd: (member: ProjectMember) => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<ProjectMemberRole>("member")
  const [error, setError] = useState("")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail.includes("@")) {
      setError("Enter a valid email address.")
      return
    }
    if (members.some((member) => member.user.email.toLowerCase() === cleanEmail)) {
      setError("That person is already a member.")
      return
    }

    const now = new Date().toISOString()
    const id = `local_member_${cleanEmail.replace(/[^a-z0-9]+/g, "_")}`
    onAdd({
      id,
      user: {
        id: `usr_${id}`,
        email: cleanEmail,
        name: cleanEmail.split("@")[0],
        createdAt: now,
      },
      role,
      joinedAt: now,
    })
    setEmail("")
    setRole("member")
    setError("")
  }

  return (
    <form
      className="app-invite-form"
      onSubmit={submit}
      aria-label={`Invite member to ${projectId}`}
    >
      <div className="app-field">
        <label htmlFor="invite-email">Email</label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="teammate@example.com"
          required
          autoFocus
        />
      </div>
      <div className="app-field">
        <label htmlFor="invite-role">Role</label>
        <select
          id="invite-role"
          className="app-select"
          value={role}
          onChange={(event) => setRole(event.target.value as ProjectMemberRole)}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {error ? <InlineError title="Could not add member" message={error} /> : null}
      <div className="app-form-actions">
        <Button type="submit" size="sm">
          Add member
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ProjectHomeLoaded({
  data,
  projectId,
  onChanged,
}: {
  data: ProjectHomeData
  projectId: string
  /** Refetches project home data after membership changes (share dialog). */
  onChanged: () => void
}) {
  const [invitedMembers, setInvitedMembers] = useState<ProjectMember[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // Live activity events merge with the fetched feed by id so new events
  // appear without a refetch (same channel as the project activity page).
  const liveActivity = useActivityEvents(projectId)
  const project = data.project
  const members = [...project.members, ...invitedMembers]
  const recentFiles = data.files.slice(0, 5)
  const recentRuns = data.agentRuns.slice(0, 5)
  const activity = mergeActivityEvents(data.activity, liveActivity)
  const recentActivity = activity.slice(0, 6)
  const topLevelFolders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const file of data.files) {
      const segments = file.path.split("/").filter(Boolean)
      if (segments.length > 1) {
        const root = segments[0]
        counts.set(root, (counts.get(root) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data.files])
  const storagePercent =
    data.storageBytes > 0 ? Math.min(100, (data.storageBytes / (5 * 1024 * 1024 * 1024)) * 100) : 0

  useEffect(() => {
    setInvitedMembers([])
    setInviteOpen(false)
    setShareOpen(false)
  }, [projectId])

  return (
    <div className="app-page app-project-home">
      <header className="app-project-header">
        <nav className="app-breadcrumb" aria-label="Breadcrumb">
          <Link href="/dashboard" transitionTypes={["nav-back"]}>
            Dashboard
          </Link>
          <span aria-hidden="true">/</span>
          <span>{project.name}</span>
        </nav>
        <div className="app-project-title-row">
          <div>
            {/* Same view-transition-name as the project card/row title on the
                projects list, so the heading morphs between the two pages. */}
            <SharedElement name={viewTransitionName("project", projectId)}>
              <h1>{project.name}</h1>
            </SharedElement>
            <p className="app-page-lede">
              {project.description ?? "No description yet. Add one to give this project context."}
            </p>
            <div className="app-project-member-stack">
              <MemberStack members={members} />
              <span>
                {members.length} member{members.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="app-project-actions">
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/lab`}>
                <FlaskConical aria-hidden="true" />
                Open lab
              </Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>
              <UserPlus aria-hidden="true" />
              Share
            </Button>
            <Button asChild>
              <Link href={`/projects/${projectId}/agent`}>
                <Bot aria-hidden="true" />
                Ask agent
              </Link>
            </Button>
          </div>
        </div>
        <dl className="app-project-meta">
          <div>
            <dt>Status</dt>
            <dd>
              <Badge variant={project.status === "active" ? "secondary" : "outline"}>
                {project.status === "active" ? "Active" : "Archived"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>
              <Badge variant="outline">{project.visibility}</Badge>
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{project.owner.name ?? project.owner.email}</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>{members.length}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(project.updatedAt)}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{formatBytes(data.storageBytes)}</dd>
          </div>
        </dl>
      </header>

      <div className="app-project-columns">
        <div className="app-project-main">
          <section className="app-panel" aria-labelledby="files-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="files-heading">Files</h2>
                <p>Top-level folders and recent files.</p>
              </div>
              <Link className="app-panel-link" href={`/projects/${projectId}/files`}>
                View all
              </Link>
            </div>
            {data.files.length === 0 ? (
              <EmptyState
                icon={<Files aria-hidden="true" />}
                title="No files yet"
                body="Upload a file or ask the agent to create one for this project."
                primaryAction={{
                  label: "Open files",
                  href: `/projects/${projectId}/files`,
                }}
              />
            ) : (
              <ul className="app-file-list">
                {topLevelFolders.map((folder) => (
                  <li key={`folder-${folder.name}`}>
                    <Link
                      href={`/projects/${projectId}/files/${encodeURIComponent(folder.name)}`}
                      className="app-file-row"
                    >
                      <span className="app-file-icon" aria-hidden="true">
                        <Folder />
                      </span>
                      <span className="app-file-main">
                        <strong>{folder.name}/</strong>
                        <small>
                          {folder.count} item{folder.count === 1 ? "" : "s"} inside
                        </small>
                      </span>
                    </Link>
                  </li>
                ))}
                {recentFiles.map((file) => (
                  <li key={file.id}>
                    <Link href={`/projects/${projectId}/files`} className="app-file-row">
                      <span className="app-file-icon" aria-hidden="true">
                        <Files />
                      </span>
                      <span className="app-file-main">
                        <strong>{file.name}</strong>
                        <small>{file.path}</small>
                      </span>
                      <span className="app-file-meta">
                        <span>{formatBytes(file.sizeBytes)}</span>
                        <span>{formatDate(file.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="app-panel" aria-labelledby="recent-runs-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="recent-runs-heading">Recent agent runs</h2>
                <p>Latest prompts, statuses, and results.</p>
              </div>
              <Link className="app-panel-link" href={`/projects/${projectId}/agent`}>
                View all
              </Link>
            </div>
            {recentRuns.length === 0 ? (
              <EmptyState
                icon={<Bot aria-hidden="true" />}
                title="No agent runs yet"
                body="Ask the agent to inspect files, draft changes, or summarize project work."
                primaryAction={{
                  label: "Ask agent",
                  href: `/projects/${projectId}/agent`,
                }}
              />
            ) : (
              <ul className="app-run-list">
                {recentRuns.map((run) => (
                  <li key={run.id}>
                    <Link href={`/projects/${projectId}/agent`} className="app-run-row">
                      <span className={`app-status-dot is-${run.status}`} aria-hidden="true" />
                      <span className="app-run-main">
                        <strong>{run.prompt}</strong>
                        <small>{run.result ?? "No result yet"}</small>
                      </span>
                      <span className="app-run-meta">
                        <Badge variant="secondary">{run.status}</Badge>
                        <span>{formatRelativeTime(run.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="app-project-side" aria-label="Project details">
          <section className="app-panel" aria-labelledby="members-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="members-heading">Members</h2>
                <p>
                  {members.length} collaborator{members.length === 1 ? "" : "s"}
                </p>
              </div>
              {members.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setInviteOpen((open) => !open)}
                  aria-expanded={inviteOpen}
                >
                  <UserPlus aria-hidden="true" />
                  Invite
                </Button>
              ) : null}
            </div>
            <ProjectMembers members={members} onInvite={() => setInviteOpen(true)} />
            {inviteOpen ? (
              <InviteMemberForm
                projectId={projectId}
                members={members}
                onAdd={(member) => {
                  setInvitedMembers((current) => [...current, member])
                  setInviteOpen(false)
                }}
                onCancel={() => setInviteOpen(false)}
              />
            ) : null}
          </section>

          <section className="app-panel" aria-labelledby="project-storage-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="project-storage-heading">Storage</h2>
                <p>{formatBytes(data.storageBytes)} in project files</p>
              </div>
              <HardDrive aria-hidden="true" className="app-panel-icon" />
            </div>
            <div className="app-storage">
              <div className="app-storage-row">
                <span>Project files</span>
                <strong>{formatBytes(data.storageBytes)}</strong>
              </div>
              <div className="app-storage-track" aria-hidden="true">
                <span style={{ width: `${storagePercent}%` }} />
              </div>
              <div className="app-storage-row app-storage-row--muted">
                <span>Workspace quota shared with compute</span>
                <span>{storagePercent.toFixed(1)}%</span>
              </div>
            </div>
          </section>

          <section className="app-panel" aria-labelledby="project-links-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="project-links-heading">Open project</h2>
                <p>Continue where you left off.</p>
              </div>
            </div>
            <nav className="app-quick-links" aria-label="Project sections">
              <Link href={`/projects/${projectId}/files`} className="app-quick-link">
                <Files aria-hidden="true" />
                <span>
                  <strong>Files</strong>
                  <small>{data.files.length} files</small>
                </span>
              </Link>
              <Link href={`/projects/${projectId}/lab`} className="app-quick-link">
                <FlaskConical aria-hidden="true" />
                <span>
                  <strong>Lab</strong>
                  <small>{data.labSessions.length} sessions</small>
                </span>
              </Link>
              <Link href={`/projects/${projectId}/chat`} className="app-quick-link">
                <MessageSquare aria-hidden="true" />
                <span>
                  <strong>Chat</strong>
                  <small>{data.chatMessages.length} messages</small>
                </span>
              </Link>
              <Link href={`/projects/${projectId}/agent`} className="app-quick-link">
                <Bot aria-hidden="true" />
                <span>
                  <strong>Agent</strong>
                  <small>{data.agentRuns.length} runs</small>
                </span>
              </Link>
              <Link href={`/projects/${projectId}/activity`} className="app-quick-link">
                <History aria-hidden="true" />
                <span>
                  <strong>Activity</strong>
                  <small>{activity.length} events</small>
                </span>
              </Link>
              <Link href={`/projects/${projectId}/analytics`} className="app-quick-link">
                <BarChart3 aria-hidden="true" />
                <span>
                  <strong>Analytics</strong>
                  <small>Usage overview</small>
                </span>
              </Link>
            </nav>
          </section>
        </aside>
      </div>

      <section className="app-panel" aria-labelledby="project-activity-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="project-activity-heading">Project activity</h2>
            <p>Recent changes inside this project.</p>
          </div>
          <Link className="app-panel-link" href={`/projects/${projectId}/activity`}>
            View all
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <EmptyState
            title="No recent activity"
            body="Project events will appear here as files, sessions, messages, and runs change."
            primaryAction={{ label: "Open files", href: `/projects/${projectId}/files` }}
          />
        ) : (
          <ActivityFeed events={recentActivity} projectId={projectId} />
        )}
      </section>

      <ProjectShareDialog
        project={project}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onChanged={onChanged}
      />
    </div>
  )
}

export function ProjectHomeScreen({ projectId }: { projectId: string }) {
  const query = useProjectHome(projectId)

  return (
    <ScreenState
      screen="project"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(data) => <ProjectHomeLoaded data={data} projectId={projectId} onChanged={query.refetch} />}
    </ScreenState>
  )
}
