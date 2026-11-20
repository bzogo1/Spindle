/**
 * Generates a typed TypeScript fetch client for every route under
 * `src/app/api/**\/route.ts`.
 *
 * Usage:
 *   npx tsx scripts/generate-sdk.ts          # write src/generated/sdk/*
 *   npx tsx scripts/generate-sdk.ts --check  # exit 1 if output is stale
 *
 * The script is idempotent: running it repeatedly produces byte-identical
 * output, so the generated files can be committed and diffed in review.
 * Route handlers are discovered by scanning for `export async function
 * GET|POST|...`; a JSDoc block placed directly above the export is carried
 * over onto the generated function.
 *
 * Output (all generated — do not edit by hand):
 *   src/generated/sdk/types.ts   shared config/request/response types
 *   src/generated/sdk/client.ts  configureSdk + one function per endpoint
 *   src/generated/sdk/index.ts   barrel re-exports
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { scanApiRoutes, type RouteEndpoint } from "./sdk/scan-routes"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const API_DIR = join(REPO_ROOT, "src/app/api")
const OUT_DIR = join(REPO_ROOT, "src/generated/sdk")

const GENERATED_HEADER = `// GENERATED FILE — do not edit by hand.
// Regenerate with: npx tsx scripts/generate-sdk.ts
// Source of truth: src/app/api/**/route.ts
`

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"])

function jsDoc(doc: string | null, indent = ""): string {
  if (!doc) return ""
  const lines = doc.split("\n")
  const body = lines.map((line) => `${indent} * ${line}`).join("\n")
  return `${indent}/**\n${body}\n${indent} */\n`
}

function renderTypes(): string {
  return `${GENERATED_HEADER}
/**
 * Shared types for the generated Spindle API client.
 */

/** Runtime configuration for the generated client. */
export type SdkConfig = {
  /**
   * Base URL prepended to every endpoint path. Defaults to "" (same origin,
   * e.g. "/api/..." resolved against the page origin in the browser).
   */
  baseUrl?: string
  /** Headers sent with every request (e.g. auth tokens). */
  headers?: Record<string, string>
  /** Fetch implementation override — useful for tests or non-browser runtimes. */
  fetch?: typeof fetch
}

/** Per-request options. */
export type RequestOptions = {
  /** Additional headers merged over the configured defaults. */
  headers?: HeadersInit
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal
  /**
   * Query string parameters appended to the endpoint path. Undefined
   * values are skipped.
   */
  query?: Record<string, string | number | boolean | undefined>
}

/** Metadata for a single generated endpoint. */
export type EndpointMeta = {
  /** Exported client function name, e.g. "postContact". */
  name: string
  method: string
  /** Route path with dynamic segments as ":name". */
  path: string
  pathParams: string[]
}

/** Error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number
  /** Parsed response body when available, otherwise the raw text. */
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}
`
}

function renderClient(endpoints: RouteEndpoint[]): string {
  const functions = endpoints.map((endpoint) => {
    const paramsType = endpoint.pathParams.length
      ? `{ ${endpoint.pathParams.map((p) => `${p}: string`).join("; ")} }`
      : null
    const takesBody = BODY_METHODS.has(endpoint.method)

    const args: string[] = []
    if (paramsType) args.push(`params: ${paramsType}`)
    if (takesBody) args.push(`body?: unknown`)
    args.push(`options: RequestOptions = {}`)

    const callArgs: string[] = [`"${endpoint.method}"`, `"${endpoint.path}"`]
    const requestInit: string[] = []
    if (paramsType) requestInit.push(`pathParams: params`)
    if (takesBody) requestInit.push(`body`)
    requestInit.push(`options`)
    callArgs.push(`{ ${requestInit.join(", ")} }`)

    return `${jsDoc(endpoint.doc)}export function ${endpoint.name}(${args.join(", ")}): Promise<unknown> {
  return request(${callArgs.join(", ")})
}`
  })

  const meta = endpoints.map(
    (e) =>
      `  { name: "${e.name}", method: "${e.method}", path: "${e.path}", pathParams: [${e.pathParams
        .map((p) => `"${p}"`)
        .join(", ")}] },`,
  )

  return `${GENERATED_HEADER}
import { ApiError, type EndpointMeta, type RequestOptions, type SdkConfig } from "./types"

let config: SdkConfig = {}

/**
 * Configure the generated client (base URL, default headers, fetch
 * implementation). Call once at app startup, or pass per-request overrides
 * via RequestOptions.
 */
export function configureSdk(next: SdkConfig): void {
  config = { ...config, ...next }
}

/** Returns a snapshot of the current SDK configuration. */
export function getSdkConfig(): Readonly<SdkConfig> {
  return { ...config }
}

type RequestArgs = {
  pathParams?: Record<string, string>
  body?: unknown
  options?: RequestOptions
}

function resolveUrl(path: string, args: RequestArgs): string {
  let url = path
  if (args.pathParams) {
    // Substitute per path segment so ":id" can never corrupt a longer param
    // like ":idFoo" — segment starts are the only valid param boundaries.
    url = url
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment
        const value = args.pathParams?.[segment.slice(1)]
        return value === undefined ? segment : encodeURIComponent(value)
      })
      .join("/")
  }

  const query = args.options?.query
  if (query) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value))
    }
    const qs = params.toString()
    if (qs) url += (url.includes("?") ? "&" : "?") + qs
  }

  const baseUrl = config.baseUrl?.replace(/\\/+$/, "")
  return baseUrl ? baseUrl + url : url
}

async function request(
  method: string,
  path: string,
  args: RequestArgs = {},
): Promise<unknown> {
  const fetchImpl = config.fetch ?? fetch
  const hasBody = args.body !== undefined
  const headers = new Headers({ accept: "application/json" })
  if (hasBody) headers.set("content-type", "application/json")
  new Headers(config.headers).forEach((value, key) => headers.set(key, value))
  if (args.options?.headers) {
    new Headers(args.options.headers).forEach((value, key) => headers.set(key, value))
  }

  const response = await fetchImpl(resolveUrl(path, args), {
    method,
    headers,
    body: hasBody ? JSON.stringify(args.body) : undefined,
    signal: args.options?.signal ?? null,
  })

  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON response body; keep the raw text.
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : \`Request failed with status \${response.status}\`
    throw new ApiError(response.status, message, parsed)
  }

  return parsed
}

${functions.join("\n\n")}

/** Static metadata for every generated endpoint, in stable sorted order. */
export const ENDPOINTS: readonly EndpointMeta[] = [
${meta.join("\n")}
]
`
}

function renderIndex(): string {
  return `${GENERATED_HEADER}
export * from "./types"
export * from "./client"
`
}

function main(): void {
  const check = process.argv.includes("--check")
  const endpoints = scanApiRoutes(API_DIR, REPO_ROOT)

  const files: Record<string, string> = {
    "types.ts": renderTypes(),
    "client.ts": renderClient(endpoints),
    "index.ts": renderIndex(),
  }

  if (check) {
    let stale = false
    for (const [name, content] of Object.entries(files)) {
      const target = join(OUT_DIR, name)
      let existing = ""
      try {
        existing = readFileSync(target, "utf8")
      } catch {
        // missing file counts as stale
      }
      if (existing !== content) {
        console.error(`stale: src/generated/sdk/${name}`)
        stale = true
      }
    }
    if (stale) {
      console.error("Run `npx tsx scripts/generate-sdk.ts` to regenerate.")
      process.exit(1)
    }
    console.log(`SDK client is up to date (${endpoints.length} endpoints).`)
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(OUT_DIR, name), content)
  }
  console.log(`Generated SDK client for ${endpoints.length} endpoints -> src/generated/sdk/`)
}

main()
