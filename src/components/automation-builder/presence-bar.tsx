"use client"

import { useState } from "react"
import { Check, Link2, Users } from "lucide-react"

import type { Collaborator, PresenceState } from "@/lib/automation-graph"
import { Avatar, AvatarFallback, getAvatarInitials } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

interface PresenceBarProps {
  /** The local user's collaborator identity. */
  local: Collaborator
  /** Remote + simulated peers currently in the builder. */
  peers: PresenceState[]
  className?: string
}

/**
 * Collaboration header strip: an avatar stack of everyone in the builder
 * (local user first, then peers) plus a share-link button that copies the
 * current URL. Peer presence is simulated locally — see
 * `src/lib/automation-graph/collaboration.ts`.
 */
export function PresenceBar({ local, peers, className }: PresenceBarProps) {
  const [copied, setCopied] = useState(false)

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — ignore silently.
    }
  }

  const entries = [local, ...peers.map((peer) => peer.user)]

  return (
    <div className={className}>
      <div
        className="flex items-center gap-1.5"
        role="group"
        aria-label={`Collaborators (${entries.length})`}
      >
        <Users className="text-muted-foreground size-3.5" aria-hidden="true" />
        <div className="flex -space-x-1.5">
          {entries.map((user) => (
            <Avatar
              key={user.id}
              size="sm"
              title={`${user.name}${user.id === local.id ? " (you)" : ""}`}
              className="ring-background ring-2"
            >
              <AvatarFallback
                className="text-[9px] font-semibold text-white"
                style={{ backgroundColor: user.color }}
              >
                {getAvatarInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
        <span className="text-muted-foreground text-[11px]">
          {entries.length} collaborator{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => void copyShareLink()}
        aria-label="Copy share link"
      >
        {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {copied ? "Link copied" : "Share"}
      </Button>
    </div>
  )
}
