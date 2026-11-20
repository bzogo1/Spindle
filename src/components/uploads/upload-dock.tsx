"use client"

/**
 * Floating upload dock — the globally visible surface for the chunked
 * upload queue. Renders a small pill button (with an active-file count)
 * fixed to the bottom-right of the app shell; activating it opens a panel
 * containing the shared {@link UploadQueuePanel} (drop zone, per-file
 * progress, pause/resume/retry/cancel).
 *
 * Must be rendered inside {@link UploadsProvider}. Files dropped anywhere in
 * the app are picked up by the provider's window-level drop handler and show
 * up here automatically.
 */

import { useEffect, useId, useRef, useState } from "react"
import { UploadCloud, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { QueueSnapshot } from "@/lib/uploads/queue"

import { UploadQueuePanel } from "./upload-queue"
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

export function UploadQueueDock({ className }: { className?: string }) {
  const { queue, transport } = useUploadsQueue()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const panelId = useId()
  const pillRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => queue.subscribe(setSnapshot), [queue])

  // Move focus into the panel when it opens; callers that close the panel
  // (close button, Escape) return focus to the pill.
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const count = activeCount(snapshot)
  const total = snapshot?.files.length ?? 0
  const liveTotal = snapshot?.files.filter((f) => f.status !== "cancelled").length ?? 0
  const statusText =
    liveTotal > 0 && snapshot
      ? `${snapshot.totals.completedFiles} of ${liveTotal} files completed${snapshot.totals.errorFiles > 0 ? `, ${snapshot.totals.errorFiles} failed` : ""}`
      : ""

  const closePanel = () => {
    setOpen(false)
    pillRef.current?.focus()
  }

  return (
    <div
      className={cn(
        "fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2",
        className,
      )}
    >
      {/* Polite announcements for queue progress/failures without spamming
          on every byte-level percent tick. */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusText}
      </div>
      {open ? (
        <section
          id={panelId}
          aria-label="Upload queue"
          onKeyDown={(event) => {
            if (event.key === "Escape") closePanel()
          }}
          className="border-border bg-background flex max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg border p-3 shadow-lg"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Uploads</h2>
            <Button
              ref={closeRef}
              type="button"
              variant="ghost"
              size="xs"
              onClick={closePanel}
              aria-label="Close"
            >
              <X />
            </Button>
          </header>
          <UploadQueuePanel queue={queue} transport={transport} className="gap-3" />
        </section>
      ) : null}

      <Button
        ref={pillRef}
        type="button"
        variant={open ? "secondary" : "default"}
        size="sm"
        className="rounded-full shadow-md"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          count > 0
            ? `Uploads ${count} — upload queue, ${count} active of ${total}`
            : `Uploads — ${open ? "close" : "open"} upload queue`
        }
      >
        <UploadCloud aria-hidden="true" />
        Uploads {count > 0 ? <Badge variant="secondary">{count}</Badge> : null}
      </Button>
    </div>
  )
}
