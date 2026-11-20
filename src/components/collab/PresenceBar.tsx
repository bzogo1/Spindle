"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  derivePresence,
  type AwarenessState,
  type PresenceEntry,
  type PresenceStatus,
} from "@/lib/collab/awareness"

export interface PresenceBarProps {
  /** All known awareness states, including the local user's. */
  entries: { clientId: string; state: AwarenessState }[]
  /** Client id of the local user — rendered with a "you" suffix. */
  selfId?: string
  /** Idle threshold passed to derivePresence. Default 60s. */
  idleAfterMs?: number
  /** How long join/leave toasts stay visible. Default 4s. */
  toastDurationMs?: number
  className?: string
}

interface PresenceToast {
  id: number
  kind: "join" | "leave"
  text: string
}

const STATUS_LABEL: Record<PresenceStatus, string | null> = {
  online: null,
  idle: "idle",
  away: "away",
}

/**
 * Editor-chrome presence roster: one chip per collaborator with their
 * colour, name, status (online/idle/away) and last-seen recency, plus
 * transient join/leave indicators.
 *
 * Status is re-derived on an interval so peers drift to "idle" even when
 * no awareness updates arrive.
 */
export function PresenceBar({
  entries,
  selfId,
  idleAfterMs,
  toastDurationMs = 4000,
  className,
}: PresenceBarProps) {
  const [now, setNow] = React.useState(() => Date.now())
  const [toasts, setToasts] = React.useState<PresenceToast[]>([])
  const prevIdsRef = React.useRef<Set<string> | null>(null)
  const nameCacheRef = React.useRef<Map<string, string>>(new Map())
  const toastSeq = React.useRef(0)
  const timersRef = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Re-derive statuses periodically so idle transitions surface.
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  React.useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t)
      timersRef.current.clear()
    }
  }, [])

  const roster = React.useMemo<PresenceEntry[]>(
    () => derivePresence(new Map(entries.map((e) => [e.clientId, e.state])), now, idleAfterMs),
    [entries, now, idleAfterMs],
  )

  // Join/leave detection: diff the client-id set between renders.
  React.useEffect(() => {
    const ids = new Set(entries.map((e) => e.clientId))
    const prev = prevIdsRef.current
    prevIdsRef.current = ids
    if (prev === null) return // first render — everyone is already here

    for (const e of entries) nameCacheRef.current.set(e.clientId, e.state.user.name)
    const nameOf = (id: string) => nameCacheRef.current.get(id) ?? id
    const added = [...ids].filter((id) => !prev.has(id))
    const removed = [...prev].filter((id) => !ids.has(id))
    if (!added.length && !removed.length) return

    const fresh: PresenceToast[] = []
    for (const id of added) {
      fresh.push({
        id: ++toastSeq.current,
        kind: "join",
        text: `${nameOf(id)} joined`,
      })
    }
    for (const id of removed) {
      fresh.push({ id: ++toastSeq.current, kind: "leave", text: `${nameOf(id)} left` })
    }
    setToasts((t) => [...t, ...fresh])
    for (const toast of fresh) {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer)
        setToasts((t) => t.filter((x) => x.id !== toast.id))
      }, toastDurationMs)
      timersRef.current.add(timer)
    }
  }, [entries, toastDurationMs])

  if (roster.length === 0 && toasts.length === 0) return null

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-testid="presence-bar"
    >
      {roster.map((entry) => {
        const isSelf = entry.clientId === selfId
        const label = STATUS_LABEL[entry.status]
        return (
          <span
            key={entry.clientId}
            data-status={entry.status}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4",
              entry.status === "online" && "border-border bg-muted/40",
              entry.status === "idle" && "border-border/60 bg-muted/20 text-muted-foreground",
              entry.status === "away" && "border-border/40 text-muted-foreground/70 bg-transparent",
            )}
            title={
              label
                ? `${entry.user.name} — ${label} (last seen ${Math.round(entry.idleMs / 1000)}s ago)`
                : entry.user.name
            }
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: entry.user.color }}
            />
            <span
              className={cn(
                entry.status !== "online" && "decoration-muted-foreground/50 line-through",
              )}
            >
              {entry.user.name}
              {isSelf ? " (you)" : ""}
            </span>
            {label && <span className="text-muted-foreground">· {label}</span>}
          </span>
        )
      })}
      {toasts.map((toast) => (
        <span
          key={toast.id}
          data-testid="presence-toast"
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4",
            toast.kind === "join"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {toast.text}
        </span>
      ))}
    </div>
  )
}
