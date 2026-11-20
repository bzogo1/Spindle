import type { APIRequestContext, APIResponse } from "playwright/test"

/**
 * Shared helpers for the `/api/*` contract specs.
 *
 * Two auth modes exist server-side (see `src/lib/notifications/principal.ts`
 * and `src/app/api/profile/route.ts`):
 *
 *  - Real auth: signed `spindle_at` access cookie (issued by
 *    `/api/auth/signin`/`signup`; the `request` fixture's cookie jar keeps it
 *    for the rest of the test).
 *  - Mock auth (`NEXT_PUBLIC_MOCK_AUTH=1`, the playwright webServer default):
 *    the unsigned `spindle_mock_session` cookie — base64url JSON. Specs forge
 *    it directly; no signature is checked server-side.
 */

export const MOCK_SESSION_COOKIE = "spindle_mock_session"

export type MockSessionInput = {
  name?: string
  email: string
  workspaceName?: string
  workspaceSlug?: string
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** Builds the `spindle_mock_session` cookie value for mock-auth mode. */
export function mockSessionCookieValue(input: MockSessionInput): string {
  const session = {
    user: { name: input.name ?? "Contract User", email: input.email },
    workspace: {
      name: input.workspaceName ?? "Contract Workspace",
      slug: input.workspaceSlug ?? "contract-workspace",
    },
    signedInAt: new Date().toISOString(),
  }
  return toBase64Url(JSON.stringify(session))
}

/** `Cookie` header carrying a mock session for `email`. */
export function mockSessionCookieHeader(email: string): string {
  return `${MOCK_SESSION_COOKIE}=${mockSessionCookieValue({ email })}`
}

/** `Cookie` header carrying the analytics-consent cookie (v1.0, granted). */
export function analyticsConsentCookieHeader(): string {
  const value = encodeURIComponent(
    JSON.stringify({ version: "1.0", analytics: true, timestamp: new Date().toISOString() }),
  )
  return `spindle_consent=${value}`
}

/** Combines cookie fragments into a single `Cookie` header value. */
export function cookieHeader(...fragments: string[]): string {
  return fragments.filter(Boolean).join("; ")
}

/**
 * Reads the first SSE frame from a stream endpoint. `APIRequestContext`
 * buffers whole bodies, which never terminates for `text/event-stream`, so
 * this uses Node's `fetch` with an AbortController instead. Returns the first
 * decoded chunk (routes emit `: connected` immediately on subscribe).
 */
export async function readFirstSseChunk(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; contentType: string | null; chunk: string }> {
  const controller = new AbortController()
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    const contentType = response.headers.get("content-type")
    const reader = response.body?.getReader()
    if (!reader) {
      return { status: response.status, contentType, chunk: "" }
    }
    const { value } = await reader.read()
    return {
      status: response.status,
      contentType,
      chunk: value ? new TextDecoder().decode(value) : "",
    }
  } finally {
    controller.abort()
  }
}

/** Absolute origin of the server under test, derived from any API response. */
export async function apiOrigin(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/auth/session")
  return new URL(response.url()).origin
}

/** Parses a JSON response body; fails the test with status context on error. */
export async function jsonBody<T = unknown>(response: APIResponse): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(
      `Expected JSON body from ${response.url()} (status ${response.status()}), got: ${await response
        .text()
        .catch(() => "<unreadable>")}`,
    )
  }
}
