"use client"

import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import { FileUp, Pause, Play, RotateCcw, Trash2, UploadCloud, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import {
  UploadQueue,
  type FileUploadSnapshot,
  type QueueSnapshot,
  type UploadQueueOptions,
} from "@/lib/uploads/queue"
import type { UploadTransport } from "@/lib/uploads/transport"

export interface UploadQueueProps {
  transport: UploadTransport
  concurrency?: number
  chunkSize?: number
  maxAttempts?: number
  className?: string
  /** Called whenever the set of completed files changes. */
  onAllComplete?: () => void
  /** Optional externally-created queue (tests / advanced usage). */
  queue?: UploadQueue
}

const STATUS_LABELS: Record<FileUploadSnapshot["status"], string> = {
  queued: "Queued",
  uploading: "Uploading",
  paused: "Paused",
  completed: "Completed",
  error: "Error",
  cancelled: "Cancelled",
}

function statusVariant(status: FileUploadSnapshot["status"]) {
  switch (status) {
    case "completed":
      return "default" as const
    case "error":
      return "destructive" as const
    case "uploading":
      return "secondary" as const
    default:
      return "outline" as const
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function UploadQueuePanel({
  transport,
  concurrency,
  chunkSize,
  maxAttempts,
  className,
  onAllComplete,
  queue: externalQueue,
}: UploadQueueProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const completedCount = useRef(0)

  const queueRef = useRef<UploadQueue | null>(null)
  if (!queueRef.current) {
    const options: UploadQueueOptions = {
      transport,
      concurrency,
      chunkSize,
      maxAttempts,
    }
    queueRef.current = externalQueue ?? new UploadQueue(options)
  }
  const queue = queueRef.current

  // Derive completion from snapshots so it works for both internally-created
  // and externally-supplied queues (the latter can't receive onFileComplete).
  useEffect(() => {
    return queue.subscribe((snap) => {
      setSnapshot(snap)
      const done = snap.files.filter((f) => f.status === "completed").length
      const total = snap.files.filter((f) => f.status !== "cancelled").length
      if (total > 0 && done === total && done !== completedCount.current) {
        completedCount.current = done
        onAllComplete?.()
      }
    })
  }, [queue, onAllComplete])

  const addFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    queue.addFiles(Array.from(files))
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files)
    e.target.value = "" // allow re-selecting the same file
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const files = snapshot?.files ?? []
  const totals = snapshot?.totals

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadCloud className="text-muted-foreground size-8" />
        <p className="text-muted-foreground text-sm">
          Drag files here or browse — uploads resume automatically after reload.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileUp /> Add files
        </Button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={onInputChange} />
      </div>

      <p className="text-muted-foreground text-xs">
        Any file type is accepted. Large files upload in resumable chunks, so an interrupted upload
        picks up where it left off — progress stays visible here and in the uploads dock.
      </p>

      {totals && files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>
              {totals.completedFiles}/{files.filter((f) => f.status !== "cancelled").length} files
              {totals.errorFiles > 0 && ` · ${totals.errorFiles} failed`}
            </span>
            <span>{Math.round(totals.percent)}%</span>
          </div>
          <Progress value={totals.percent} />
        </div>
      )}

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="border-border bg-card flex flex-col gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.fileName}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatBytes(file.size)}
                    {file.totalParts > 0 && ` · ${file.uploadedParts}/${file.totalParts} parts`}
                    {file.awaitingFile && " · waiting for file"}
                  </p>
                </div>
                <Badge variant={statusVariant(file.status)}>{STATUS_LABELS[file.status]}</Badge>
              </div>

              <Progress value={file.percent} className="h-1.5" />

              {file.error && <p className="text-destructive text-xs">{file.error}</p>}

              <div className="flex items-center gap-1">
                {(file.status === "uploading" || file.status === "queued") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => queue.pause(file.id)}
                  >
                    <Pause /> Pause
                  </Button>
                )}
                {(file.status === "paused" ||
                  file.status === "cancelled" ||
                  file.status === "error") &&
                  !file.awaitingFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        file.status === "error" ? queue.retry(file.id) : queue.resume(file.id)
                      }
                    >
                      {file.status === "error" ? <RotateCcw /> : <Play />}
                      {file.status === "error" ? "Retry" : "Resume"}
                    </Button>
                  )}
                {file.status !== "completed" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => queue.cancel(file.id)}
                  >
                    <X /> Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground ml-auto"
                  onClick={() => void queue.remove(file.id)}
                >
                  <Trash2 /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
