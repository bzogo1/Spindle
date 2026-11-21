"use client"

/**
 * Compact upload-queue indicator for the app shell — a small fixed badge
 * showing how many uploads are currently active (queued / uploading /
 * paused / errored). Renders nothing when the queue is idle so it never
 * clutters the shell.
 *
 * Wired next to {@link UploadQueueDock} in `src/app/(app)/layout.tsx` — kept
 * as a separate component so `app-shell.tsx` does not need to know about
 * uploads. Must be rendered inside {@link UploadsProvider}.
 */

import { useEffect, useState } from "react"
import { Loader2, UploadCloud } from "lucide-react"

import { cn } from "@/lib/utils"
import type { QueueSnapshot } from "@/lib/uploads/queue"

import { useUploadsQueue } from "./upload-provider"

function activeCount(snapshot: QueueSnapshot | null): number {
  if (!snapshot) return 0
  return snapshot.files.filter(
    (file) =>
      file.status === "queued" ||
      file.status === "uploading" ||
      file.status === "paused" ||
      file.status === "error",
  ).length
}

export function UploadQueueIndicator({ className }: { className?: string }) {
  const { queue } = useUploadsQueue()
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)

  useEffect(() => queue.subscribe(setSnapshot), [queue])

  const count = activeCount(snapshot)
  const uploading = snapshot?.totals.activeFiles ?? 0
  if (count === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "border-border bg-background/90 text-muted-foreground pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur",
        className,
      )}
    >
      {uploading > 0 ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <UploadCloud className="size-3" aria-hidden="true" />
      )}
      <span>
        {count} upload{count === 1 ? "" : "s"} active
      </span>
    </div>
  )
}
