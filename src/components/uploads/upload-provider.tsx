"use client"

/**
 * Global upload queue provider.
 *
 * Owns a single {@link UploadQueue} (chunked, resumable multipart engine from
 * `src/lib/uploads`) for the whole authenticated app and exposes it through
 * context so any surface — currently the floating `UploadQueueDock` — can
 * render the same queue. There is exactly one visible queue; the mock
 * upload rows inside files-screen remain the folder-targeted path.
 *
 * The provider also manages cross-cutting upload state:
 *
 *  - {@link UploadSettings} (quality / format / destination), persisted to
 *    localStorage and editable from the upload-settings dropdown.
 *  - An upload history list: entries are appended whenever a queued file
 *    reaches a terminal state (completed / error / cancelled), so the
 *    history view survives within the session even though the queue itself
 *    drops completed entries from its persisted resume state.
 *  - Bulk actions (`retryFailed`, `cancelActive`, `clearCompleted`) shared
 *    by the dock and queue panel.
 *
 * Drag & drop: a window-level `drop` listener enqueues dropped `File`s into
 * the queue. It skips events that were already `preventDefault()`-ed, so the
 * files-screen drop zones (which route drops into a specific folder via the
 * workspace API) keep ownership of their drops and nothing is uploaded twice.
 *
 * Transport: defaults to {@link MockUploadTransport} because the workspace
 * API only accepts upload *metadata* today — there is no byte/chunk endpoint
 * yet. Swap `transport` (e.g. `S3MultipartTransport` / `B2Transport`, or a
 * backend presign proxy) once real uploads land; the queue, persistence and
 * UI do not change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { UploadQueue, type FileUploadSnapshot, type QueueSnapshot, type UploadQueueOptions } from "@/lib/uploads/queue"
import {
  loadUploadSettings,
  saveUploadSettings,
  type UploadSettings,
} from "@/lib/uploads/settings"
import { MockUploadTransport, type UploadTransport } from "@/lib/uploads/transport"

/** One row in the session upload history. */
export interface UploadHistoryEntry {
  /** Queue entry id (stable for the session). */
  id: string
  fileName: string
  size: number
  /** Terminal status the file ended in. */
  status: "completed" | "error" | "cancelled"
  /** Destination key reported by the queue. */
  key?: string
  /** File extension lowercased without the dot ("" when none). */
  extension: string
  /** When the terminal state was reached (epoch ms). */
  finishedAt: number
  error?: string
}

export interface UploadsContextValue {
  queue: UploadQueue
  transport: UploadTransport
  /** Current upload settings (quality / format / destination). */
  settings: UploadSettings
  updateSettings: (patch: Partial<UploadSettings>) => void
  /** Recent uploads that reached a terminal state, newest first. */
  history: UploadHistoryEntry[]
  clearHistory: () => void
  /** Retry every file currently in the error state. */
  retryFailed: () => void
  /** Cancel every queued/uploading/paused file. */
  cancelActive: () => void
  /** Remove all completed files from the queue. */
  clearCompleted: () => void
}

const UploadsContext = createContext<UploadsContextValue | null>(null)

/** Cap the in-memory history so long sessions don't grow unbounded. */
const HISTORY_LIMIT = 100

export function useUploadsQueue(): UploadsContextValue {
  const context = useContext(UploadsContext)
  if (!context) {
    throw new Error("useUploadsQueue must be used inside <UploadsProvider>.")
  }
  return context
}

/**
 * Default transport until the backend exposes multipart upload endpoints.
 * A small fixed latency keeps progress UI observable; real transports should
 * report genuine per-part progress instead.
 */
export function createDefaultUploadTransport(): UploadTransport {
  return new MockUploadTransport({ latencyMs: 250 })
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  if (dot <= 0 || dot === fileName.length - 1) return ""
  return fileName.slice(dot + 1).toLowerCase()
}

const TERMINAL_STATUSES = new Set<FileUploadSnapshot["status"]>([
  "completed",
  "error",
  "cancelled",
])

export interface UploadsProviderProps {
  children: ReactNode
  /** Override the transport (tests, or a real backend adapter). */
  transport?: UploadTransport
  /** Additional {@link UploadQueueOptions} (store, chunkSize, …). */
  queueOptions?: Partial<UploadQueueOptions>
  /** Inject a pre-built queue (advanced usage / tests). */
  queue?: UploadQueue
  /** Initial settings (defaults to persisted values). */
  initialSettings?: UploadSettings
}

export function UploadsProvider({
  children,
  transport,
  queueOptions,
  queue: externalQueue,
  initialSettings,
}: UploadsProviderProps) {
  const ref = useRef<UploadsContextValue | null>(null)
  if (!ref.current) {
    const resolvedTransport = queueOptions?.transport ?? transport ?? createDefaultUploadTransport()
    ref.current = {
      transport: resolvedTransport,
      queue:
        externalQueue ??
        new UploadQueue({
          ...queueOptions,
          transport: queueOptions?.transport ?? resolvedTransport,
        }),
    } as UploadsContextValue
  }
  const { queue, transport: resolvedTransport } = ref.current

  const [settings, setSettings] = useState<UploadSettings>(
    () => initialSettings ?? loadUploadSettings(),
  )
  const [history, setHistory] = useState<UploadHistoryEntry[]>([])

  const updateSettings = useCallback((patch: Partial<UploadSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveUploadSettings(next)
      return next
    })
  }, [])

  // Window-level drag & drop → global queue. `defaultPrevented` guards keep
  // nested drop zones (files-screen folders, the dock's own dropzone) in
  // charge of their own drops.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault()
      }
    }
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented) return
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return
      event.preventDefault()
      queue.addFiles(files)
    }
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [queue])

  // Upload history: diff consecutive snapshots and record each file the
  // first time it reaches a terminal state. Re-entries (retry → error again)
  // update the existing row rather than duplicating it.
  useEffect(() => {
    const lastStatus = new Map<string, FileUploadSnapshot["status"]>()
    return queue.subscribe((snapshot: QueueSnapshot) => {
      let changed = false
      const next = new Map(lastStatus)
      const updates = new Map<string, UploadHistoryEntry>()
      for (const file of snapshot.files) {
        const previous = lastStatus.get(file.id)
        next.set(file.id, file.status)
        if (!TERMINAL_STATUSES.has(file.status)) continue
        if (previous === file.status) continue
        updates.set(file.id, {
          id: file.id,
          fileName: file.fileName,
          size: file.size,
          status: file.status as UploadHistoryEntry["status"],
          key: file.key,
          extension: extensionOf(file.fileName),
          finishedAt: Date.now(),
          error: file.error,
        })
        changed = true
      }
      lastStatus.clear()
      for (const [k, v] of next) lastStatus.set(k, v)
      if (!changed || updates.size === 0) return
      setHistory((current) => {
        const merged = current.map((entry) => updates.get(entry.id) ?? entry)
        const fresh = [...updates.values()].filter(
          (entry) => !current.some((existing) => existing.id === entry.id),
        )
        return [...fresh.reverse(), ...merged].slice(0, HISTORY_LIMIT)
      })
    })
  }, [queue])

  const clearHistory = useCallback(() => setHistory([]), [])

  const retryFailed = useCallback(() => {
    for (const file of queue.getSnapshot().files) {
      if (file.status === "error") queue.retry(file.id)
    }
  }, [queue])

  const cancelActive = useCallback(() => {
    for (const file of queue.getSnapshot().files) {
      if (file.status === "queued" || file.status === "uploading" || file.status === "paused") {
        queue.cancel(file.id)
      }
    }
  }, [queue])

  const clearCompleted = useCallback(() => {
    queue.clearCompleted()
  }, [queue])

  const value = useMemo<UploadsContextValue>(
    () => ({
      queue,
      transport: resolvedTransport,
      settings,
      updateSettings,
      history,
      clearHistory,
      retryFailed,
      cancelActive,
      clearCompleted,
    }),
    [
      queue,
      resolvedTransport,
      settings,
      updateSettings,
      history,
      clearHistory,
      retryFailed,
      cancelActive,
      clearCompleted,
    ],
  )

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>
}
