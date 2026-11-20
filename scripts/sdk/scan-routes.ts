/**
 * Scans `src/app/api/**\/route.ts` files and extracts every exported HTTP
 * method handler (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) together with the
 * JSDoc block that precedes it, when present.
 *
 * Pure functions only — no filesystem writes — so the parser can be unit
 * tested. The CLI entry point lives in `scripts/generate-sdk.ts`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]

/** Canonical ordering used when sorting generated output. */
const METHOD_ORDER: Record<HttpMethod, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  HEAD: 5,
  OPTIONS: 6,
}

export type RouteEndpoint = {
  method: HttpMethod
  /**
   * URL path the route is mounted at, e.g. `/api/auth/signin`. Dynamic
   * segments (`[provider]`) are emitted as `:provider`.
   */
  path: string
  /** Dynamic path parameter names in declaration order, e.g. `["provider"]`. */
  pathParams: string[]
  /**
   * JSDoc text found immediately above the exported handler. `null` when the
   * handler has no doc comment.
   */
  doc: string | null
  /** Generated client function name, e.g. `postAuthSignin`. */
  name: string
  /** Route file path relative to the repo root (posix separators). */
  file: string
}

const METHOD_EXPORT_RE =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g

// `export const GET = …` style handlers are not parsed into endpoints; they
// are reported as warnings so a route never goes silently missing.
const CONST_EXPORT_RE = /export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g

// `export { GET }` / `export { handler as POST }` re-export style.
const BRACE_EXPORT_RE = /export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^}]*\}/g

/** Catch-all segments like `[...slug]` or `[[...slug]]` cannot map to a
 * single `:param` client argument, so routes using them are skipped. */
export function isCatchAllSegment(segment: string): boolean {
  return /^\[\[?\.\.\./.test(segment)
}

/**
 * Returns human-readable warnings for route constructs the scanner cannot
 * turn into client functions: const-style exports, brace re-exports, and
 * catch-all path segments.
 */
export function findRouteWarnings(source: string, segments: string[]): string[] {
  const warnings: string[] = []

  for (const match of source.matchAll(CONST_EXPORT_RE)) {
    warnings.push(
      `export const ${match[1]} handler is not supported — use "export async function ${match[1]}"`,
    )
  }
  for (const match of source.matchAll(BRACE_EXPORT_RE)) {
    warnings.push(`export { … ${match[1]} … } re-export is not supported`)
  }
  for (const segment of segments) {
    if (isCatchAllSegment(segment)) {
      warnings.push(`catch-all segment "${segment}" is not supported by the SDK client`)
    }
  }
  return [...new Set(warnings)]
}

function toPosix(path: string): string {
  return path.split(sep).join("/")
}

/**
 * Turns `/api/auth/oauth/[provider]` into `/api/auth/oauth/:provider` and
 * returns the dynamic parameter names in order.
 */
export function routePathFromSegments(segments: string[]): {
  path: string
  pathParams: string[]
} {
  const pathParams: string[] = []
  const parts = segments.map((segment) => {
    const dynamic = /^\[(.+)\]$/.exec(segment)
    if (dynamic) {
      pathParams.push(dynamic[1])
      return `:${dynamic[1]}`
    }
    return segment
  })
  return { path: "/" + parts.join("/"), pathParams }
}

/**
 * Finds the JSDoc block (`/** ... *\/`) that ends immediately before
 * `index` in `source`. Returns the comment body (without the delimiters) or
 * `null` when there is no comment or unrelated code sits between the comment
 * and the export.
 */
export function extractDocComment(source: string, index: number): string | null {
  const before = source.slice(0, index)
  const commentEnd = before.lastIndexOf("*/")
  if (commentEnd === -1) return null
  const commentStart = before.lastIndexOf("/**", commentEnd)
  if (commentStart === -1) return null

  // Anything between the end of the comment and the export other than
  // whitespace means the comment documents something else.
  if (before.slice(commentEnd + 2).trim() !== "") return null

  const body = source.slice(commentStart + 3, commentEnd)
  // Strip the leading `*` continuation markers and one level of indentation.
  const lines = body
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim()
  return lines.length > 0 ? lines : null
}

/** Extracts every exported HTTP handler from a single route.ts source. */
export function parseRouteSource(source: string): { method: HttpMethod; doc: string | null }[] {
  const found: { method: HttpMethod; doc: string | null }[] = []
  METHOD_EXPORT_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = METHOD_EXPORT_RE.exec(source)) !== null) {
    const method = match[1] as HttpMethod
    const doc = extractDocComment(source, match.index)
    // A file may export the same method twice only in pathological cases;
    // keep the first occurrence.
    if (!found.some((entry) => entry.method === method)) {
      found.push({ method, doc })
    }
  }
  return found
}

function pascalCase(segment: string): string {
  return segment
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/**
 * Builds a stable, unique client function name for an endpoint:
 * `POST /api/auth/signin` → `postAuthSignin`.
 */
export function endpointName(method: HttpMethod, segments: string[]): string {
  const relevant = segments.filter((segment) => segment !== "api")
  const tail = relevant.map((segment) => {
    const dynamic = /^\[(.+)\]$/.exec(segment)
    return pascalCase(dynamic ? dynamic[1] : segment)
  })
  return method.toLowerCase() + tail.join("")
}

function* walkRouteFiles(dir: string): Generator<string> {
  // Sort entries so scan order — and therefore collision suffixes — is
  // deterministic across filesystems.
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walkRouteFiles(full)
    } else if (entry === "route.ts" || entry === "route.tsx") {
      yield full
    }
  }
}

/**
 * Scans `apiDir` (the absolute path to `src/app/api`) for route files and
 * returns every endpoint, sorted deterministically by path then method.
 */
export function scanApiRoutes(apiDir: string, repoRoot: string): RouteEndpoint[] {
  const endpoints: RouteEndpoint[] = []

  for (const file of walkRouteFiles(apiDir)) {
    const source = readFileSync(file, "utf8")
    const relToApi = toPosix(relative(apiDir, dirname(file)))
    const segments = relToApi === "" || relToApi === "." ? [] : relToApi.split("/")
    const apiSegments = ["api", ...segments]
    const fileRel = toPosix(relative(repoRoot, file))

    const warnings = findRouteWarnings(source, segments)
    for (const warning of warnings) {
      console.warn(`generate-sdk: ${fileRel}: ${warning}`)
    }

    const handlers = parseRouteSource(source)
    // Catch-all segments cannot be expressed as client path params; skip the
    // whole file rather than emit a wrong signature.
    if (handlers.length === 0 || segments.some(isCatchAllSegment)) continue

    const { path, pathParams } = routePathFromSegments(apiSegments)

    for (const { method, doc } of handlers) {
      endpoints.push({
        method,
        path,
        pathParams,
        doc,
        name: endpointName(method, apiSegments),
        file: fileRel,
      })
    }
  }

  // Guard against name collisions (two routes mapping to the same function
  // name): append a numeric suffix deterministically.
  const seen = new Map<string, number>()
  for (const endpoint of endpoints) {
    const count = seen.get(endpoint.name) ?? 0
    seen.set(endpoint.name, count + 1)
    if (count > 0) endpoint.name = `${endpoint.name}${count + 1}`
  }

  return endpoints.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    return METHOD_ORDER[a.method] - METHOD_ORDER[b.method]
  })
}
