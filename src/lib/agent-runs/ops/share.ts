/**
 * Portable share payloads for agent run records.
 *
 * Mirrors the file-tree share convention (`src/lib/file-tree/share.ts`): a
 * `AgentRunSharePayload` serializes a run snapshot into a compact JSON
 * document, and `encodeAgentRunShareForUrl` produces a URL-safe base64url
 * string suitable for a `#share=` hash fragment or `?share=` query param.
 * `decodeAgentRunShare` / `decodeAgentRunShareFromUrl` restore it.
 */

import { normalizeAgentRunRecord, type AgentRunRecord } from "./types"

export interface AgentRunSharePayload {
  version: 1
  run: AgentRunRecord
  /** When the payload was created (ISO-8601). */
  exportedAt: string
  /** Optional human label for the share. */
  name?: string
  /** Optional free-text note attached to the share. */
  note?: string
}

export function createAgentRunSharePayload(input: {
  run: AgentRunRecord
  name?: string
  note?: string
  now?: Date
}): AgentRunSharePayload {
  return {
    version: 1,
    run: input.run,
    exportedAt: (input.now ?? new Date()).toISOString(),
    name: input.name,
    note: input.note,
  }
}

export function encodeAgentRunShare(payload: AgentRunSharePayload): string {
  return JSON.stringify(payload)
}

function base64UrlEncode(text: string): string {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  }
  const buf = (
    globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }
  ).Buffer
  if (buf) return buf.from(text, "utf8").toString("base64url")
  return encodeURIComponent(text)
}

function base64UrlDecode(encoded: string): string {
  if (typeof atob === "function" && /^[A-Za-z0-9_-]+$/.test(encoded)) {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
    // atob output is a byte string; decodeURIComponent(escape(...)) restores UTF-8.
    return decodeURIComponent(escape(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))))
  }
  // Fallback transport form: percent-encoded JSON. decodeURIComponent throws
  // on stray "%" — fall back to the raw string so JSON.parse gets a chance.
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

/** Encode for a URL hash/query fragment (base64url, no padding). */
export function encodeAgentRunShareForUrl(payload: AgentRunSharePayload): string {
  return base64UrlEncode(encodeAgentRunShare(payload))
}

/**
 * Decode a JSON share payload; returns null on malformed input.
 *
 * `raw` must already be transport-decoded (callers own URI/base64 handling —
 * see `decodeAgentRunShareFromUrl`). It is parsed as JSON *verbatim*: running
 * `decodeURIComponent` here would corrupt legitimate "%" sequences inside
 * run content (prompts, payloads) and throw on malformed escapes.
 */
export function decodeAgentRunShare(raw: string): AgentRunSharePayload | null {
  try {
    const payload = JSON.parse(raw) as AgentRunSharePayload
    if (!payload || payload.version !== 1 || !payload.run || typeof payload.run !== "object") {
      return null
    }
    const run = payload.run as unknown as Record<string, unknown>
    if (
      typeof run.id !== "string" ||
      typeof run.prompt !== "string" ||
      typeof run.status !== "string" ||
      typeof run.createdAt !== "string" ||
      !Array.isArray(run.steps) ||
      !Array.isArray(run.events)
    ) {
      return null
    }
    // Normalize lax fields (metrics/tags may be absent in hand-edited shares)
    // so downstream analytics/compliance never see undefined collections.
    return { ...payload, run: normalizeAgentRunRecord(payload.run) }
  } catch {
    return null
  }
}

export function decodeAgentRunShareFromUrl(encoded: string): AgentRunSharePayload | null {
  try {
    return decodeAgentRunShare(base64UrlDecode(encoded))
  } catch {
    return null
  }
}

function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Extract a `#share=` / `?share=` payload from a URL string / location. */
export function agentRunSharePayloadFromLocation(href?: string): AgentRunSharePayload | null {
  const url = href ?? (typeof window !== "undefined" ? window.location.href : "")
  const hashMatch = url.match(/#share=([^&]+)/)
  if (hashMatch) return decodeAgentRunShareFromUrl(safeDecodeURIComponent(hashMatch[1]))
  const queryMatch = url.match(/[?&]share=([^&#]+)/)
  if (queryMatch) return decodeAgentRunShareFromUrl(safeDecodeURIComponent(queryMatch[1]))
  return null
}

/**
 * Import a decoded share payload as a fresh run record: the run keeps its
 * content but receives a new id and a `createdAt` of `now`, and a
 * `sharedFrom` marker is avoided — instead the original id is preserved in
 * `tags` as `shared:<originalId>` for traceability.
 */
export function importAgentRunShare(
  payload: AgentRunSharePayload,
  options: { now?: Date } = {},
): AgentRunRecord {
  const now = (options.now ?? new Date()).toISOString()
  const originalId = payload.run.id
  const normalized = normalizeAgentRunRecord(payload.run)
  const tags = new Set(normalized.tags)
  tags.add(`shared:${originalId}`)
  return {
    ...normalized,
    id: `run_import_${now.replace(/[^0-9]/g, "").slice(0, 14)}_${originalId}`,
    createdAt: now,
    tags: [...tags],
  }
}
