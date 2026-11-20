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

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"

import { UploadQueue, type UploadQueueOptions } from "@/lib/uploads/queue"
import { MockUploadTransport, type UploadTransport } from "@/lib/uploads/transport"

export interface UploadsContextValue {
  queue: UploadQueue
  transport: UploadTransport
}

const UploadsContext = createContext<UploadsContextValue | null>(null)

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

export interface UploadsProviderProps {
  children: ReactNode
  /** Override the transport (tests, or a real backend adapter). */
  transport?: UploadTransport
  /** Additional {@link UploadQueueOptions} (store, chunkSize, …). */
  queueOptions?: Partial<UploadQueueOptions>
  /** Inject a pre-built queue (advanced usage / tests). */
  queue?: UploadQueue
}

export function UploadsProvider({
  children,
  transport,
  queueOptions,
  queue: externalQueue,
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
    }
  }
  const { queue, transport: resolvedTransport } = ref.current

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

  return (
    <UploadsContext.Provider value={{ queue, transport: resolvedTransport }}>
      {children}
    </UploadsContext.Provider>
  )
}
