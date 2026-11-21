/**
 * Resumable, concurrent multipart upload queue.
 *
 * Framework-agnostic: the React component in `src/components/uploads`
 * subscribes to snapshots; tests drive it with {@link MockUploadTransport}.
 *
 * Lifecycle per file: queued → uploading → completed | error | paused |
 * cancelled. Paused/cancelled/error files keep their multipart session and
 * uploaded-part etags (persisted via {@link UploadStateStore}), so
 * `resume()`/`retry()` continue where they left off. Restored entries have
 * no `File` object after a reload — call `addFile()` with the same file
 * (matched by name+size+lastModified) to reattach and resume.
 */

import { buildChunks, hashBlob, DEFAULT_CHUNK_SIZE, type FileChunk } from "./chunker"
import {
  createDefaultStore,
  fileKeyFor,
  type PersistedUpload,
  type UploadStateStore,
} from "./persistence"
import type { UploadResult, UploadSession, UploadTransport } from "./transport"

export type FileUploadStatus =
  "queued" | "uploading" | "paused" | "completed" | "error" | "cancelled"

export interface PartProgress {
  partNumber: number
  size: number
  status: "pending" | "uploading" | "done"
  attempts: number
}

export interface FileUploadSnapshot {
  id: string
  fileName: string
  size: number
  status: FileUploadStatus
  /** True when restored from persistence and waiting for the File again. */
  awaitingFile: boolean
  key?: string
  uploadedBytes: number
  totalBytes: number
  percent: number
  uploadedParts: number
  totalParts: number
  error?: string
  parts: PartProgress[]
}

export interface QueueSnapshot {
  files: FileUploadSnapshot[]
  totals: {
    uploadedBytes: number
    totalBytes: number
    percent: number
    activeFiles: number
    queuedFiles: number
    completedFiles: number
    errorFiles: number
  }
}

export interface UploadQueueOptions {
  transport: UploadTransport
  /** Max files uploading concurrently. Default 3. */
  concurrency?: number
  /** Part size in bytes. Default 8 MiB. */
  chunkSize?: number
  /** Attempts per part before the file errors out. Default 4. */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Jitter factor 0..1 applied to backoff delays. Default 0.5. */
  jitter?: number
  /** Compute per-part content checksums. Default true. */
  checksums?: boolean
  /** Persistence backend. Default: IndexedDB → localStorage → memory. */
  store?: UploadStateStore
  /** Injectable delay (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>
  /** Object key derivation. Default: file name. */
  keyFor?: (file: File) => string
  /** Called after a file completes successfully. */
  onFileComplete?: (id: string, result: UploadResult) => void
}

interface InternalPart {
  index: number
  start: number
  end: number
  size: number
  blob?: Blob
  etag?: string
  attempts: number
  status: "pending" | "uploading" | "done"
}

interface InternalEntry {
  id: string
  file?: File
  fileName: string
  size: number
  contentType?: string
  fileKey: string
  key: string
  partSize: number
  status: FileUploadStatus
  awaitingFile: boolean
  parts: InternalPart[]
  /** Persisted etags for restored entries, applied when parts are built. */
  pendingEtags?: Map<number, string>
  session?: UploadSession
  resumeUploadId?: string
  doneBytes: number
  currentLoaded: number
  error?: string
  abort?: AbortController
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `upload-${Date.now().toString(36)}-${idCounter}`
}

/**
 * Exponential backoff with jitter.
 * `attempt` is 1-based (first retry = 1). With jitter = 0 the delay is
 * exactly `min(maxMs, baseMs * 2^(attempt-1))`; with jitter = 1 it is
 * uniformly distributed in [0, capped].
 */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1000,
  maxMs = 30_000,
  jitter = 0.5,
  rand: () => number = Math.random,
): number {
  const capped = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
  if (jitter <= 0) return capped
  const j = Math.min(1, jitter)
  return (1 - j) * capped + rand() * j * capped
}

export class UploadQueue {
  private entries = new Map<string, InternalEntry>()
  private running = new Set<string>()
  private listeners = new Set<(snapshot: QueueSnapshot) => void>()
  private options: Required<
    Pick<
      UploadQueueOptions,
      | "concurrency"
      | "chunkSize"
      | "maxAttempts"
      | "baseDelayMs"
      | "maxDelayMs"
      | "jitter"
      | "checksums"
    >
  > &
    UploadQueueOptions

  private store: UploadStateStore
  private sleep: (ms: number) => Promise<void>

  /** Resolves once persisted state has been hydrated. */
  readonly ready: Promise<void>

  constructor(options: UploadQueueOptions) {
    this.options = {
      concurrency: 3,
      chunkSize: DEFAULT_CHUNK_SIZE,
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      jitter: 0.5,
      checksums: true,
      ...options,
    }
    this.store = options.store ?? createDefaultStore()
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.ready = this.hydrate()
  }

  /* ---------------------------- subscription ---------------------------- */

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): QueueSnapshot {
    const files: FileUploadSnapshot[] = [...this.entries.values()].map((e) => {
      const totalParts = e.parts.length || Math.max(1, Math.ceil(e.size / e.partSize))
      const uploadedBytes = e.doneBytes + e.currentLoaded
      const totalBytes = e.size
      return {
        id: e.id,
        fileName: e.fileName,
        size: e.size,
        status: e.status,
        awaitingFile: e.awaitingFile,
        key: e.key,
        uploadedBytes,
        totalBytes,
        percent:
          totalBytes === 0
            ? e.status === "completed"
              ? 100
              : 0
            : (uploadedBytes / totalBytes) * 100,
        uploadedParts: e.awaitingFile
          ? (e.pendingEtags?.size ?? 0)
          : e.parts.filter((p) => p.status === "done").length,
        totalParts,
        error: e.error,
        parts: e.parts.map((p) => ({
          partNumber: p.index,
          size: p.size,
          status: p.status,
          attempts: p.attempts,
        })),
      }
    })

    const totalBytes = files.reduce((sum, f) => sum + f.totalBytes, 0)
    const uploadedBytes = files
      .filter((f) => f.status !== "cancelled")
      .reduce((sum, f) => sum + Math.min(f.uploadedBytes, f.totalBytes), 0)
    return {
      files,
      totals: {
        uploadedBytes,
        totalBytes,
        percent: totalBytes === 0 ? 100 : (uploadedBytes / totalBytes) * 100,
        activeFiles: files.filter((f) => f.status === "uploading").length,
        queuedFiles: files.filter((f) => f.status === "queued").length,
        completedFiles: files.filter((f) => f.status === "completed").length,
        errorFiles: files.filter((f) => f.status === "error").length,
      },
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  /* ------------------------------ enqueue ------------------------------ */

  /** Add files; returns their queue ids. Auto-starts eligible entries. */
  addFiles(files: Iterable<File> | ArrayLike<File>): string[] {
    const list = Array.from(files as Iterable<File>)
    return list.map((file) => this.addFile(file))
  }

  addFile(file: File): string {
    // Re-attach to a restored entry awaiting its File.
    const awaiting = [...this.entries.values()].find(
      (e) => e.awaitingFile && e.fileKey === fileKeyFor(file),
    )
    if (awaiting) {
      if (this.attachFile(awaiting, file)) this.resume(awaiting.id)
      return awaiting.id
    }

    const id = nextId()
    const key = this.options.keyFor?.(file) ?? file.name
    const entry: InternalEntry = {
      id,
      file,
      fileName: file.name,
      size: file.size,
      contentType: file.type || undefined,
      fileKey: fileKeyFor(file),
      key,
      partSize: this.options.chunkSize,
      status: "queued",
      awaitingFile: false,
      parts: [],
      doneBytes: 0,
      currentLoaded: 0,
    }
    this.buildParts(entry)
    this.entries.set(id, entry)
    void this.persist(entry)
    this.emit()
    this.pump()
    return id
  }

  /** Match a restored (awaitingFile) entry by file identity. */
  findAwaitingEntry(file: File): string | null {
    const key = fileKeyFor(file)
    for (const e of this.entries.values()) {
      if (e.awaitingFile && e.fileKey === key) return e.id
    }
    return null
  }

  /* --------------------------- lifecycle controls ---------------------- */

  pause(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.status === "completed" || entry.status === "cancelled") return
    entry.status = "paused"
    entry.abort?.abort()
    void this.persist(entry)
    this.emit()
    this.pump()
  }

  pauseAll(): void {
    for (const entry of this.entries.values()) this.pause(entry.id)
  }

  /** Resume a paused/cancelled/error file. `file` reattaches restored entries. */
  resume(id: string, file?: File): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    if (file) {
      if (!this.attachFile(entry, file)) return false
    }
    if (entry.status === "completed") return true
    if (entry.awaitingFile) return false
    if (entry.status === "uploading" || entry.status === "queued") return true
    entry.status = "queued"
    entry.error = undefined
    void this.persist(entry)
    this.emit()
    this.pump()
    return true
  }

  /** Stop in-flight work but keep session + parts for later resume. */
  cancel(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.status === "completed" || entry.status === "cancelled") return
    entry.status = "cancelled"
    entry.abort?.abort()
    void this.persist(entry)
    this.emit()
    this.pump()
  }

  /** Discard the entry entirely and best-effort abort the remote session. */
  async remove(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.abort?.abort()
    if (entry.session) {
      try {
        await this.options.transport.abortUpload(entry.session)
      } catch {
        // best-effort
      }
    }
    this.entries.delete(id)
    await this.store.remove(id)
    this.emit()
    this.pump()
  }

  /** Reset a failed/cancelled file and queue it again. */
  retry(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    if (entry.status !== "error" && entry.status !== "cancelled") return false
    for (const part of entry.parts) {
      if (part.status !== "done") part.attempts = 0
    }
    return this.resume(id)
  }

  clearCompleted(): void {
    for (const entry of this.entries.values()) {
      if (entry.status === "completed") this.entries.delete(entry.id)
    }
    this.emit()
  }

  /* ------------------------------ internals ---------------------------- */

  private attachFile(entry: InternalEntry, file: File): boolean {
    if (file.size !== entry.size) {
      entry.error = `File size mismatch: expected ${entry.size} bytes, got ${file.size}`
      entry.status = "error"
      void this.persist(entry)
      this.emit()
      return false
    }
    entry.file = file
    entry.awaitingFile = false
    this.buildParts(entry)
    return true
  }

  private buildParts(entry: InternalEntry): void {
    if (!entry.file) return
    const chunks: FileChunk[] = buildChunks(entry.file, entry.partSize)
    const pending = entry.pendingEtags
    entry.parts = chunks.map((c) => ({
      index: c.index,
      start: c.start,
      end: c.end,
      size: c.size,
      blob: c.blob,
      etag: pending?.get(c.index),
      attempts: 0,
      status: pending?.has(c.index) ? "done" : "pending",
    }))
    entry.doneBytes = entry.parts
      .filter((p) => p.status === "done")
      .reduce((sum, p) => sum + p.size, 0)
    entry.currentLoaded = 0
  }

  private pump(): void {
    const concurrency = Math.max(1, this.options.concurrency)
    for (const entry of this.entries.values()) {
      if (this.running.size >= concurrency) return
      if (entry.status !== "queued" || entry.awaitingFile || !entry.file) continue
      this.running.add(entry.id)
      void this.runFile(entry).finally(() => {
        this.running.delete(entry.id)
        this.pump()
      })
    }
  }

  private async runFile(entry: InternalEntry): Promise<void> {
    if (entry.status !== "queued") return
    entry.status = "uploading"
    entry.error = undefined
    entry.abort = new AbortController()
    const signal = entry.abort.signal
    this.emit()

    try {
      // 1. Init (or resume) the multipart session.
      if (!entry.session) {
        entry.session = await this.options.transport.initUpload(
          {
            key: entry.key,
            fileName: entry.fileName,
            size: entry.size,
            contentType: entry.contentType,
            resumeUploadId: entry.resumeUploadId,
          },
          signal,
        )
        entry.resumeUploadId = entry.session.uploadId ?? entry.session.sessionId
        await this.persist(entry)
      }

      if (this.isHalted(entry)) return

      // 2. Reconcile with parts the backend already has (resume path).
      try {
        const remote = await this.options.transport.listParts(entry.session)
        for (const rp of remote) {
          const part = entry.parts.find((p) => p.index === rp.partNumber)
          if (part && part.status !== "done") {
            part.etag = rp.etag
            part.status = "done"
            entry.doneBytes += part.size
          }
        }
      } catch {
        // listParts is best-effort; persisted etags still apply.
      }
      this.emit()

      // 3. Upload remaining parts sequentially.
      for (const part of entry.parts) {
        if (part.status === "done") continue
        if (this.isHalted(entry)) return
        await this.uploadPartWithRetry(entry, part, signal)
        if (this.isHalted(entry)) return
      }

      // 4. Complete.
      const doneParts = entry.parts
        .filter((p) => p.etag)
        .map((p) => ({ partNumber: p.index, etag: p.etag! }))
        .sort((a, b) => a.partNumber - b.partNumber)
      await this.options.transport.completeUpload(entry.session, doneParts)

      entry.status = "completed"
      entry.abort = undefined
      await this.store.remove(entry.id) // no resume state needed anymore
      this.emit()
      this.options.onFileComplete?.(entry.id, { key: entry.key })
    } catch (error) {
      if (this.isHalted(entry)) return // pause/cancel handled state already
      entry.status = "error"
      entry.error = error instanceof Error ? error.message : String(error)
      entry.abort = undefined
      await this.persist(entry)
      this.emit()
    }
  }

  private isHalted(entry: InternalEntry): boolean {
    return entry.status !== "uploading"
  }

  private async uploadPartWithRetry(
    entry: InternalEntry,
    part: InternalPart,
    signal: AbortSignal,
  ): Promise<void> {
    const maxAttempts = Math.max(1, this.options.maxAttempts)
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.isHalted(entry)) return
      part.status = "uploading"
      part.attempts = attempt
      entry.currentLoaded = 0
      this.emit()

      try {
        const checksum = this.options.checksums ? await hashBlob(part.blob!) : undefined
        const result = await this.options.transport.uploadPart(
          entry.session!,
          { partNumber: part.index, data: part.blob!, checksum },
          signal,
          (loaded) => {
            entry.currentLoaded = loaded
            this.emit()
          },
        )
        part.etag = result.etag
        part.status = "done"
        entry.doneBytes += part.size
        entry.currentLoaded = 0
        await this.persist(entry)
        this.emit()
        return
      } catch (error) {
        lastError = error
        if (signal.aborted || this.isHalted(entry)) return
        if (attempt >= maxAttempts) break
        const delay = backoffDelayMs(
          attempt,
          this.options.baseDelayMs,
          this.options.maxDelayMs,
          this.options.jitter,
        )
        await this.sleep(delay)
        if (this.isHalted(entry)) return
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /* ---------------------------- persistence ---------------------------- */

  private persisted(entry: InternalEntry): PersistedUpload {
    return {
      id: entry.id,
      fileKey: entry.fileKey,
      fileName: entry.fileName,
      size: entry.size,
      contentType: entry.contentType,
      key: entry.key,
      uploadId: entry.resumeUploadId,
      partSize: entry.partSize,
      uploadedParts: entry.parts
        .filter((p) => p.etag)
        .map((p) => ({ partNumber: p.index, etag: p.etag! })),
      status: entry.status,
      lastError: entry.error,
      updatedAt: Date.now(),
    }
  }

  private persist(entry: InternalEntry): Promise<void> {
    return this.store.save(this.persisted(entry))
  }

  private async hydrate(): Promise<void> {
    let stored: PersistedUpload[]
    try {
      stored = await this.store.load()
    } catch {
      stored = []
    }
    for (const saved of stored) {
      if (saved.status === "completed") continue
      const etags = new Map(saved.uploadedParts.map((p) => [p.partNumber, p.etag]))
      const entry: InternalEntry = {
        id: saved.id,
        fileName: saved.fileName,
        size: saved.size,
        contentType: saved.contentType,
        fileKey: saved.fileKey,
        key: saved.key,
        partSize: saved.partSize,
        status: "paused",
        awaitingFile: true,
        parts: [],
        pendingEtags: etags,
        resumeUploadId: saved.uploadId,
        doneBytes: saved.uploadedParts.reduce((sum, p) => {
          // Approximate: assume uniform part size except possibly the last.
          const idx = p.partNumber
          const start = (idx - 1) * saved.partSize
          return sum + Math.max(0, Math.min(saved.partSize, saved.size - start))
        }, 0),
        currentLoaded: 0,
        error: saved.lastError,
      }
      this.entries.set(entry.id, entry)
    }
    if (this.entries.size > 0) this.emit()
  }
}
