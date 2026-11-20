"use client"

import { useMemo, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Link2, Trash2 } from "lucide-react"

import { CopyButton } from "@/components/app/copy-button"
import { getAvatarInitials } from "@/components/ui/avatar"
import type { FileNode, User } from "@/lib/api"

import {
  FILE_SHARE_PERMISSION_LABELS,
  FILE_SHARE_PERMISSIONS,
  fileShareHref,
  sharesForNode,
} from "./file-share"
import type { AddFileShareInput, FileShare, FileSharePermission } from "./file-share"

function memberLabel(user: User) {
  return user.name ?? user.email
}

function ShareAvatar({ name }: { name: string }) {
  return (
    <span className="fm-owner-avatar" aria-hidden="true">
      {getAvatarInitials(name)}
    </span>
  )
}

/**
 * Share dialog for a single file or folder. Workspace members are picked from
 * the `members` roster (the project settings screen uses the same
 * `useWorkspaceMembers` source); each grant stores a `view`/`edit` permission
 * in the localStorage-backed share store. The share link reuses the files
 * screen's `?preview=` deep link for files and the canonical folder path URL
 * for folders — see `file-share.ts`.
 */
export function FileShareDialog({
  node,
  files,
  projectId,
  members,
  shares,
  pathname,
  search,
  onAddShare,
  onSetPermission,
  onRevokeShare,
  onClose,
}: {
  node: FileNode
  files: FileNode[]
  projectId: string
  members: User[]
  /** All shares for the project; filtered to `node` internally. */
  shares: FileShare[]
  pathname: string
  /** Current query string, preserved in the generated share link. */
  search: string
  onAddShare: (input: AddFileShareInput) => void
  onSetPermission: (shareId: string, permission: FileSharePermission) => void
  onRevokeShare: (shareId: string) => void
  onClose: () => void
}) {
  const [memberId, setMemberId] = useState("")
  const [permission, setPermission] = useState<FileSharePermission>("view")

  const nodeShares = useMemo(() => sharesForNode(shares, node.id), [shares, node.id])
  const sharedUserIds = useMemo(
    () => new Set(nodeShares.map((share) => share.userId)),
    [nodeShares],
  )
  // Already-shared members drop out of the picker; the node owner stays
  // pickable since an explicit grant is still meaningful in the mock store.
  const candidates = useMemo(
    () => members.filter((member) => !sharedUserIds.has(member.id)),
    [members, sharedUserIds],
  )

  const shareHref = () => fileShareHref({ node, files, projectId, pathname, search })

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const member = candidates.find((candidate) => candidate.id === memberId)
    if (!member) return
    onAddShare({
      nodeId: node.id,
      nodeName: node.name,
      userId: member.id,
      userName: memberLabel(member),
      permission,
    })
    setMemberId("")
    setPermission("view")
  }

  const nodeKindLabel = node.kind === "folder" ? "folder" : "file"

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-dialog-overlay" />
        <DialogPrimitive.Content
          className="app-dialog-content"
          data-slot="dialog-content"
          aria-modal="true"
          aria-describedby={undefined}
        >
          <div className="app-dialog">
            <DialogPrimitive.Title>Share {node.name}</DialogPrimitive.Title>
            <p>
              Grant workspace members access to this {nodeKindLabel}. Shares are stored locally for
              this demo and sync across tabs.
            </p>

            <div className="app-field">
              <span className="app-field-label" id="file-share-link-label">
                Share link
              </span>
              <div className="fm-share-link-row">
                <Link2 className="icon icon--xs" aria-hidden="true" />
                <CopyButton text={shareHref} label="Copy link" />
              </div>
            </div>

            <div className="app-field">
              <span className="app-field-label" id="file-share-people-label">
                People with access
              </span>
              {nodeShares.length === 0 ? (
                <p className="fm-share-empty">No one has been added yet.</p>
              ) : (
                <ul className="fm-share-list" aria-labelledby="file-share-people-label">
                  {nodeShares.map((share) => (
                    <li key={share.id} className="fm-share-row">
                      <ShareAvatar name={share.userName} />
                      <span className="fm-share-name">{share.userName}</span>
                      <select
                        className="fm-share-permission"
                        aria-label={`Permission for ${share.userName}`}
                        value={share.permission}
                        onChange={(event) =>
                          onSetPermission(share.id, event.target.value as FileSharePermission)
                        }
                      >
                        {FILE_SHARE_PERMISSIONS.map((option) => (
                          <option key={option} value={option}>
                            {FILE_SHARE_PERMISSION_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="fm-btn fm-share-revoke"
                        aria-label={`Revoke access for ${share.userName}`}
                        onClick={() => onRevokeShare(share.id)}
                      >
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form className="fm-share-invite" onSubmit={submit}>
              <div className="app-field">
                <label htmlFor="file-share-member">Add people</label>
                <select
                  id="file-share-member"
                  value={memberId}
                  onChange={(event) => setMemberId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    {candidates.length > 0
                      ? "Select a workspace member"
                      : "Everyone already has access"}
                  </option>
                  {candidates.map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberLabel(member)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="file-share-permission">Permission</label>
                <select
                  id="file-share-permission"
                  value={permission}
                  onChange={(event) => setPermission(event.target.value as FileSharePermission)}
                >
                  {FILE_SHARE_PERMISSIONS.map((option) => (
                    <option key={option} value={option}>
                      {FILE_SHARE_PERMISSION_LABELS[option]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-dialog-actions">
                <button type="button" className="fm-btn" onClick={onClose}>
                  Close
                </button>
                <button
                  type="submit"
                  className="fm-btn fm-btn--solid"
                  disabled={memberId === "" || candidates.length === 0}
                >
                  Share
                </button>
              </div>
            </form>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
