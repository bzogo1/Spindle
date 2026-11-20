/**
 * Pure helpers for the API playground: URL building, header assembly, JSON
 * formatting, and call-history persistence. Kept free of React so they can be
 * unit-tested directly.
 */

export interface KeyValuePair {
  key: string
  value: string
}

export interface PlaygroundRequest {
  method: string
  /** Path template, e.g. `/api/auth/oauth/{provider}`. */
  path: string
  pathParams?: Record<string, string>
  query?: KeyValuePair[]
  headers?: KeyValuePair[]
  body?: string
  /** Bearer token sent as `Authorization: Bearer <token>`. */
  token?: string
}

export interface ApiResponse {
  url: string
  method: string
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  bodyJson: unknown
  durationMs: number
  ok: boolean
}

export interface HistoryEntry {
  id: string
  timestamp: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  ok: boolean
}

const HISTORY_KEY = "spindle.playground.history"
const MAX_HISTORY = 25

/** Replace `{name}` segments in a path template. */
export function interpolatePath(path: string, pathParams?: Record<string, string>): string {
  return path.replace(/\{([^}/]+)\}/g, (match, name: string) => {
    const value = pathParams?.[name]
    return value && value.length > 0 ? encodeURIComponent(value) : match
  })
}

/** Extract `{param}` names from a path template. */
export function pathParamNames(path: string): string[] {
  const names: string[] = []
  for (const match of path.matchAll(/\{([^}/]+)\}/g)) {
    names.push(match[1])
  }
  return names
}

/** Path params declared by the template that have no non-empty value yet. */
export function missingPathParams(path: string, pathParams?: Record<string, string>): string[] {
  return pathParamNames(path).filter((name) => !pathParams?.[name]?.trim())
}

/** Methods that must not carry a request body — `fetch` throws on GET/HEAD. */
const BODYLESS_METHODS = new Set(["GET", "HEAD"])

export function isBodylessMethod(method: string): boolean {
  return BODYLESS_METHODS.has(method.toUpperCase())
}

/** Build the same-origin URL for a request, including query params. */
export function buildUrl(request: PlaygroundRequest): string {
  const path = interpolatePath(request.path, request.pathParams)
  const params = new URLSearchParams()
  for (const pair of request.query ?? []) {
    const key = pair.key.trim()
    if (key) params.set(key, pair.value)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * Assemble request headers. Custom headers win over defaults except
 * `Authorization`, which the token field owns when provided.
 */
export function buildHeaders(request: PlaygroundRequest): Record<string, string> {
  const headers: Record<string, string> = {}
  const hasBody =
    request.body !== undefined && request.body.trim() !== "" && !isBodylessMethod(request.method)
  // Default to JSON when a body is present; custom headers below may override.
  if (hasBody) headers["content-type"] = "application/json"

  if (request.token && request.token.trim()) {
    headers["authorization"] = `Bearer ${request.token.trim()}`
  }

  for (const pair of request.headers ?? []) {
    const key = pair.key.trim()
    if (!key) continue
    const lower = key.toLowerCase()
    if (lower === "authorization" && request.token?.trim()) continue
    headers[lower] = pair.value
  }

  return headers
}

/** Parse an optional JSON request body; returns undefined for empty input. */
export function parseRequestBody(
  body?: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (body === undefined || body.trim() === "") return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" }
  }
}

/** Pretty-print a value as JSON, falling back to String(). */
export function formatJson(value: unknown): string {
  if (value === undefined) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export interface ExecuteOptions {
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * Execute a playground request against the same origin and normalize the
 * response. Network failures resolve with `status: 0` rather than throwing.
 */
export async function executeRequest(
  request: PlaygroundRequest,
  options: ExecuteOptions = {},
): Promise<ApiResponse> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => performance.now())
  const url = buildUrl(request)
  const started = now()

  const method = request.method.toUpperCase()
  const init: RequestInit = {
    method,
    headers: buildHeaders(request),
  }
  const bodyCheck = parseRequestBody(request.body)
  if (!bodyCheck.ok) {
    return {
      url,
      method: init.method as string,
      status: 0,
      statusText: "Invalid request body",
      headers: {},
      bodyText: bodyCheck.error,
      bodyJson: undefined,
      durationMs: Math.round(now() - started),
      ok: false,
    }
  }
  // GET/HEAD must not carry a body — `fetch` throws "Request with GET/HEAD
  // method cannot have body". The body is dropped rather than sent.
  if (bodyCheck.value !== undefined && !isBodylessMethod(method)) {
    // Always JSON.stringify the parsed value: primitives (strings, numbers,
    // booleans) would otherwise go out unquoted and produce invalid JSON.
    init.body = JSON.stringify(bodyCheck.value)
  }

  try {
    const response = await fetchImpl(url, init)
    const bodyText = await response.text()
    let bodyJson: unknown
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined
    } catch {
      bodyJson = undefined
    }
    return {
      url,
      method: init.method as string,
      status: response.status,
      statusText: response.statusText,
      headers: formatHeaders(response.headers),
      bodyText,
      bodyJson,
      durationMs: Math.round(now() - started),
      ok: response.ok,
    }
  } catch (error) {
    return {
      url,
      method: init.method as string,
      status: 0,
      statusText: "Network error",
      headers: {},
      bodyText: error instanceof Error ? error.message : String(error),
      bodyJson: undefined,
      durationMs: Math.round(now() - started),
      ok: false,
    }
  }
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage
  return null
}

export function loadHistory(storage?: Storage): HistoryEntry[] {
  const store = getStorage(storage)
  if (!store) return []
  try {
    const raw = store.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is HistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as HistoryEntry).method === "string" &&
        typeof (e as HistoryEntry).url === "string",
    )
  } catch {
    return []
  }
}

export function saveHistoryEntry(entry: HistoryEntry, storage?: Storage): HistoryEntry[] {
  const history = [entry, ...loadHistory(storage).filter((e) => e.id !== entry.id)].slice(
    0,
    MAX_HISTORY,
  )
  const store = getStorage(storage)
  if (store) {
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // best-effort
    }
  }
  return history
}

export function clearHistory(storage?: Storage): void {
  const store = getStorage(storage)
  if (!store) return
  try {
    store.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}

export function historyEntryFromResponse(
  request: PlaygroundRequest,
  response: ApiResponse,
): HistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    method: request.method.toUpperCase(),
    url: response.url,
    status: response.status === 0 ? null : response.status,
    durationMs: response.durationMs,
    ok: response.ok,
  }
}
