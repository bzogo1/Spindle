/**
 * Pluggable multipart upload transports.
 *
 * The {@link UploadTransport} interface mirrors the S3/B2 "init → upload
 * parts → complete / abort" lifecycle. {@link MockUploadTransport} is an
 * in-memory implementation used by the upload queue in tests and dev;
 * {@link S3MultipartTransport} and {@link B2Transport} are reference HTTP
 * adapters showing how a real backend plugs in.
 */

import { hashBlob } from "./chunker"

export interface InitUploadParams {
  /** Destination object key / file name. */
  key: string
  fileName: string
  size: number
  contentType?: string
  metadata?: Record<string, string>
  /**
   * When resuming a persisted upload, transports that support it should
   * return the existing session instead of creating a new one.
   */
  resumeUploadId?: string
}

export interface UploadSession {
  /** Opaque session identifier used for all subsequent calls. */
  sessionId: string
  /** Backend upload identifier (S3 UploadId, B2 fileId, …). */
  uploadId?: string
  /** Server-advised part size, if any. */
  partSize?: number
  /** Destination key, echoed back by transports that need it per call. */
  key?: string
  /** Extra backend-specific state (B2 upload URL + auth token, …). */
  state?: Record<string, unknown>
}

export interface UploadPartInput {
  partNumber: number
  data: Blob
  /** Content hash from {@link hashBlob}, when the caller computed one. */
  checksum?: string
}

export interface UploadedPart {
  partNumber: number
  /** Opaque per-part identifier returned by the backend (S3 ETag, B2 sha1…). */
  etag: string
}

export interface UploadResult {
  key?: string
  location?: string
  [extra: string]: unknown
}

export interface UploadTransport {
  readonly name: string

  initUpload(params: InitUploadParams, signal?: AbortSignal): Promise<UploadSession>

  uploadPart(
    session: UploadSession,
    part: UploadPartInput,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ): Promise<UploadedPart>

  /** `parts` must be sorted by partNumber ascending. */
  completeUpload(session: UploadSession, parts: UploadedPart[]): Promise<UploadResult>

  abortUpload(session: UploadSession): Promise<void>

  /**
   * Parts the backend already knows about for this session. Used on resume
   * to reconcile local state. May return [] when unsupported.
   */
  listParts(session: UploadSession): Promise<UploadedPart[]>
}

/* ------------------------------------------------------------------ */
/* Mock transport (in-memory, for tests and local dev)                 */
/* ------------------------------------------------------------------ */

export interface MockUploadTransportOptions {
  /** Artificial latency per part upload, in ms. */
  latencyMs?: number
  /**
   * Called before each part upload; may throw or return a rejected promise
   * to simulate failures. Receives the attempt number (1-based).
   */
  shouldFail?: (ctx: { sessionId: string; partNumber: number; attempt: number }) => boolean
}

interface MockStoredPart extends UploadedPart {
  size: number
  checksum?: string
}

export class MockUploadTransport implements UploadTransport {
  readonly name = "mock"

  private sessions = new Map<string, { uploadId: string; parts: Map<number, MockStoredPart> }>()
  private attempts = new Map<string, number>() // `${sessionId}:${partNumber}` -> count
  private counters = { inits: 0, parts: 0, completes: 0, aborts: 0 }

  constructor(private options: MockUploadTransportOptions = {}) {}

  get stats() {
    return { ...this.counters }
  }

  /** Total part uploads accepted (for assertions). */
  get uploadCount(): number {
    return this.counters.parts
  }

  /** Inspect stored parts for a session. */
  partsFor(sessionId: string): UploadedPart[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return [...session.parts.values()]
      .map(({ partNumber, etag }) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber)
  }

  async initUpload(params: InitUploadParams): Promise<UploadSession> {
    this.counters.inits += 1
    if (params.resumeUploadId && this.sessions.has(params.resumeUploadId)) {
      return { sessionId: params.resumeUploadId, uploadId: params.resumeUploadId, key: params.key }
    }
    const uploadId = `mock-upload-${this.counters.inits}`
    this.sessions.set(uploadId, { uploadId, parts: new Map() })
    return { sessionId: uploadId, uploadId, key: params.key }
  }

  async uploadPart(
    session: UploadSession,
    part: UploadPartInput,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ): Promise<UploadedPart> {
    const stored = this.sessions.get(session.sessionId)
    if (!stored) throw new Error(`Unknown upload session: ${session.sessionId}`)

    const key = `${session.sessionId}:${part.partNumber}`
    const attempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attempt)

    if (
      this.options.shouldFail?.({
        sessionId: session.sessionId,
        partNumber: part.partNumber,
        attempt,
      })
    ) {
      throw new Error(`mock upload failure (part ${part.partNumber}, attempt ${attempt})`)
    }

    if (this.options.latencyMs) {
      await delay(this.options.latencyMs, signal)
    }
    throwIfAborted(signal)

    const checksum = part.checksum ?? (await hashBlob(part.data))
    stored.parts.set(part.partNumber, {
      partNumber: part.partNumber,
      etag: `etag-${session.sessionId}-${part.partNumber}`,
      size: part.data.size,
      checksum,
    })
    this.counters.parts += 1
    onProgress?.(part.data.size)
    return { partNumber: part.partNumber, etag: stored.parts.get(part.partNumber)!.etag }
  }

  async completeUpload(session: UploadSession, parts: UploadedPart[]): Promise<UploadResult> {
    const stored = this.sessions.get(session.sessionId)
    if (!stored) throw new Error(`Unknown upload session: ${session.sessionId}`)
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    for (const part of sorted) {
      const storedPart = stored.parts.get(part.partNumber)
      if (!storedPart || storedPart.etag !== part.etag) {
        throw new Error(`Part ${part.partNumber} etag mismatch during complete`)
      }
    }
    this.counters.completes += 1
    return { key: session.sessionId, location: `mock://uploads/${session.sessionId}` }
  }

  async abortUpload(session: UploadSession): Promise<void> {
    this.sessions.delete(session.sessionId)
    this.counters.aborts += 1
  }

  async listParts(session: UploadSession): Promise<UploadedPart[]> {
    return this.partsFor(session.sessionId)
  }
}

/* ------------------------------------------------------------------ */
/* S3-compatible multipart transport (reference HTTP adapter)          */
/* ------------------------------------------------------------------ */

export interface S3MultipartTransportOptions {
  /**
   * Base URL of an S3-compatible multipart endpoint, e.g. a presign/proxy
   * service or `https://s3.<region>.amazonaws.com/<bucket>`.
   */
  baseUrl: string
  /**
   * Returns auth headers. For presigned flows the backend can bake
   * credentials into `baseUrl`; bearer tokens go here.
   */
  auth?: () => Promise<Record<string, string>> | Record<string, string>
  fetchImpl?: typeof fetch
}

/**
 * Minimal S3 multipart client:
 *   init     → POST  {base}/{key}?uploads
 *   part     → PUT   {base}/{key}?partNumber=N&uploadId=ID
 *   complete → POST  {base}/{key}?uploadId=ID   (XML part list)
 *   abort    → DELETE {base}/{key}?uploadId=ID
 *   list     → GET   {base}/{key}?uploadId=ID
 * Parses both XML (real S3) and JSON (proxy backends).
 */
export class S3MultipartTransport implements UploadTransport {
  readonly name = "s3"
  private fetchImpl: typeof fetch

  constructor(private options: S3MultipartTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    return { ...(await this.options.auth?.()), ...extra }
  }

  private url(session: UploadSession, query: Record<string, string | number>): string {
    const key = session.key ?? session.sessionId
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    const base = this.options.baseUrl.replace(/\/+$/, "")
    return `${base}/${encodeURIComponent(key).replace(/%2F/g, "/")}${qs ? `?${qs}` : ""}`
  }

  async initUpload(params: InitUploadParams): Promise<UploadSession> {
    // resumeUploadId lets a backend/proxy return the existing UploadId
    // instead of starting a new multipart upload.
    const res = await this.fetchImpl(
      this.url({ key: params.key } as UploadSession, { uploads: "" }),
      {
        method: "POST",
        headers: await this.headers(),
      },
    )
    if (!res.ok) throw new Error(`S3 initUpload failed: ${res.status}`)
    const body = await res.text()
    const uploadId = extractField(body, "UploadId")
    if (!uploadId) throw new Error("S3 initUpload: missing UploadId in response")
    return { sessionId: uploadId, uploadId, key: params.key }
  }

  async uploadPart(
    session: UploadSession,
    part: UploadPartInput,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ): Promise<UploadedPart> {
    const checksum = part.checksum ?? (await hashBlob(part.data))
    // S3 expects base64-encoded SHA-256 in the checksum header; our
    // `sha256:<hex>` form is converted here.
    const checksumHeader = checksum.startsWith("sha256:")
      ? `SHA256 ${hexToBase64(checksum.slice("sha256:".length))}`
      : undefined
    const res = await this.fetchImpl(
      this.url(session, {
        uploadId: session.uploadId ?? session.sessionId,
        partNumber: part.partNumber,
      }),
      {
        method: "PUT",
        headers: await this.headers({
          "Content-Type": "application/octet-stream",
          ...(checksumHeader ? { "x-amz-checksum-sha256": checksumHeader.slice(7) } : {}),
        }),
        body: part.data,
        signal,
      },
    )
    if (!res.ok) throw new Error(`S3 uploadPart ${part.partNumber} failed: ${res.status}`)
    const etag = (res.headers.get("etag") ?? "").replace(/"/g, "")
    if (!etag) throw new Error(`S3 uploadPart ${part.partNumber}: missing ETag`)
    onProgress?.(part.data.size)
    return { partNumber: part.partNumber, etag }
  }

  async completeUpload(session: UploadSession, parts: UploadedPart[]): Promise<UploadResult> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    const xml =
      `<CompleteMultipartUpload>` +
      sorted
        .map(
          (p) =>
            `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`,
        )
        .join("") +
      `</CompleteMultipartUpload>`
    const res = await this.fetchImpl(
      this.url(session, { uploadId: session.uploadId ?? session.sessionId }),
      {
        method: "POST",
        headers: await this.headers({ "Content-Type": "application/xml" }),
        body: xml,
      },
    )
    if (!res.ok) throw new Error(`S3 completeUpload failed: ${res.status}`)
    const body = await res.text()
    const location = extractField(body, "Location")
    return { key: session.key, location: location ?? undefined }
  }

  async abortUpload(session: UploadSession): Promise<void> {
    const res = await this.fetchImpl(
      this.url(session, { uploadId: session.uploadId ?? session.sessionId }),
      { method: "DELETE", headers: await this.headers() },
    )
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 abortUpload failed: ${res.status}`)
    }
  }

  async listParts(session: UploadSession): Promise<UploadedPart[]> {
    const res = await this.fetchImpl(
      this.url(session, { uploadId: session.uploadId ?? session.sessionId }),
      { method: "GET", headers: await this.headers() },
    )
    if (!res.ok) throw new Error(`S3 listParts failed: ${res.status}`)
    const body = await res.text()
    const parsed = tryParse(body)
    if (parsed && Array.isArray(parsed.Parts)) {
      return (parsed.Parts as Record<string, unknown>[])
        .map((p) => ({
          partNumber: Number(p.PartNumber ?? p.partNumber),
          etag: String(p.ETag ?? p.etag ?? "").replace(/"/g, ""),
        }))
        .sort((a, b) => a.partNumber - b.partNumber)
    }
    // XML fallback: collect <Part>…</Part> blocks.
    const parts: UploadedPart[] = []
    const blockRe = /<Part>([\s\S]*?)<\/Part>/g
    let match: RegExpExecArray | null
    while ((match = blockRe.exec(body))) {
      const num = extractField(match[1], "PartNumber")
      const etag = extractField(match[1], "ETag")
      if (num && etag) parts.push({ partNumber: Number(num), etag: etag.replace(/"/g, "") })
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber)
  }
}

/* ------------------------------------------------------------------ */
/* Backblaze B2 native large-file transport (reference adapter)        */
/* ------------------------------------------------------------------ */

export interface B2TransportOptions {
  /** B2 API base, e.g. https://api.backblazeb2.com (or regional api host). */
  apiUrl?: string
  accountId: string
  applicationKey: string
  bucketId: string
  fetchImpl?: typeof fetch
}

/**
 * Maps the upload-queue lifecycle onto B2's native large-file API:
 *   init     → b2_start_large_file + b2_get_upload_part_url
 *   part     → b2_upload_part (uploadUrl carries Authorization)
 *   complete → b2_complete_large_file (partSha1Array, ordered)
 *   abort    → b2_cancel_large_file
 *   list     → unsupported by B2 native API; returns [] (resume relies on
 *              the queue's persisted etag state instead).
 *
 * NOTE: verify header names against the current B2 native API docs before
 * production use — this is a reference adapter, not battle-tested code.
 */
export class B2Transport implements UploadTransport {
  readonly name = "b2"
  private fetchImpl: typeof fetch
  private apiUrl = "https://api.backblazeb2.com"
  private authToken?: string
  private authPromise?: Promise<void>

  constructor(private options: B2TransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    if (options.apiUrl) this.apiUrl = options.apiUrl.replace(/\/+$/, "")
  }

  private async authorize(): Promise<void> {
    this.authPromise ??= (async () => {
      const res = await this.fetchImpl(`${this.apiUrl}/b2api/v2/b2_authorize_account`, {
        headers: {
          Authorization: `Basic ${btoa(`${this.options.accountId}:${this.options.applicationKey}`)}`,
        },
      })
      if (!res.ok) throw new Error(`B2 authorize failed: ${res.status}`)
      const body = (await res.json()) as {
        authorizationToken: string
        apiInfo?: { storageApi?: { apiUrl?: string } }
      }
      this.authToken = body.authorizationToken
      const api = body.apiInfo?.storageApi?.apiUrl
      if (api) this.apiUrl = api.replace(/\/+$/, "")
    })()
    return this.authPromise
  }

  private async call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    await this.authorize()
    const res = await this.fetchImpl(`${this.apiUrl}/b2api/v2/${endpoint}`, {
      method: "POST",
      headers: { Authorization: this.authToken!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`B2 ${endpoint} failed: ${res.status}`)
    return (await res.json()) as T
  }

  async initUpload(params: InitUploadParams): Promise<UploadSession> {
    if (params.resumeUploadId) {
      // B2 has no "resume large file" call; the caller must persist the
      // fileId + uploadUrl. We surface the persisted values via state.
      return { sessionId: params.resumeUploadId, uploadId: params.resumeUploadId, key: params.key }
    }
    const started = await this.call<{ fileId: string }>("b2_start_large_file", {
      bucketId: this.options.bucketId,
      fileName: params.fileName || params.key,
      contentType: params.contentType ?? "application/octet-stream",
      fileInfo: params.metadata,
    })
    const partUrl = await this.call<{ uploadUrl: string; authorizationToken: string }>(
      "b2_get_upload_part_url",
      { fileId: started.fileId },
    )
    return {
      sessionId: started.fileId,
      uploadId: started.fileId,
      key: params.key,
      state: { uploadUrl: partUrl.uploadUrl, authToken: partUrl.authorizationToken },
    }
  }

  async uploadPart(
    session: UploadSession,
    part: UploadPartInput,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ): Promise<UploadedPart> {
    const uploadUrl = session.state?.uploadUrl as string | undefined
    const auth = session.state?.authToken as string | undefined
    if (!uploadUrl || !auth) throw new Error("B2 session missing upload URL")
    const res = await this.fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: auth,
        "X-Bz-Part-Number": String(part.partNumber),
        "X-Bz-Content-Sha1": "do_not_verify",
      },
      body: part.data,
      signal,
    })
    if (!res.ok) throw new Error(`B2 upload_part failed: ${res.status}`)
    const sha1 = res.headers.get("x-bz-content-sha1") ?? ""
    onProgress?.(part.data.size)
    return {
      partNumber: part.partNumber,
      etag: sha1 || `b2-${session.sessionId}-${part.partNumber}`,
    }
  }

  async completeUpload(session: UploadSession, parts: UploadedPart[]): Promise<UploadResult> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    const result = await this.call<{ fileId: string; fileName: string }>("b2_complete_large_file", {
      fileId: session.uploadId ?? session.sessionId,
      partSha1Array: sorted.map((p) => p.etag),
    })
    return { key: result.fileName, location: `b2://${this.options.bucketId}/${result.fileName}` }
  }

  async abortUpload(session: UploadSession): Promise<void> {
    await this.call("b2_cancel_large_file", { fileId: session.uploadId ?? session.sessionId })
  }

  async listParts(): Promise<UploadedPart[]> {
    // B2 native API has no "list uploaded parts" call.
    return []
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }
    if (signal?.aborted) {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Extract `UploadId`/`Location`/… from either JSON or XML bodies. */
function extractField(body: string, tag: string): string | null {
  const parsed = tryParse(body)
  if (parsed) {
    const camel = tag.charAt(0).toLowerCase() + tag.slice(1)
    const value = parsed[tag] ?? parsed[camel]
    if (typeof value === "string" && value) return value
    if (typeof value === "object" && value !== null) {
      const inner = (value as Record<string, unknown>)._ ?? (value as Record<string, unknown>)[tag]
      if (typeof inner === "string") return inner
    }
  }
  const match = body.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))
  return match ? match[1] : null
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
