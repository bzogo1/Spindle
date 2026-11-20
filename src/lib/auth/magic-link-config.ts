import type { EnvSource } from "@/lib/env"

/**
 * Magic-link (passwordless sign-in) token lifetime.
 *
 * Single source of truth for how long `/api/auth/passwordless/request`
 * tokens live. The request route passes {@link MagicLinkConfig.ttlMs} to
 * `backend.issueOneTimeToken({ ttlMs })` and uses
 * {@link MagicLinkConfig.expiresInMinutes} for the "expires in N minutes"
 * copy in the email and on the `/magic-link` screen (via props from
 * `src/app/(auth)/magic-link/page.tsx`).
 *
 * Configuration surface — one optional environment variable:
 *
 *   MAGIC_LINK_TTL_MINUTES   token lifetime in minutes (default 15)
 *
 * Parsing rules ({@link parseMagicLinkTtlMinutes}):
 *  - unset, blank, non-numeric, or non-positive values fall back to the
 *    15 minute default, so a typo can never silently disable sign-in links;
 *  - numeric values are clamped into [MIN, MAX] = [1, 60] minutes — a too
 *    short value would make links unusable in practice, a too long one
 *    would weaken the single-use token's exposure window;
 *  - fractional values are allowed (e.g. "2.5" → 150 seconds) and are
 *    rounded for display only.
 *
 * NOTE: this module reads `process.env` directly instead of going through
 * `src/lib/env.server.ts`. The env schema is shared/validated at boot and
 * intentionally does not know about this optional knob; reading it lazily
 * here keeps a missing or malformed value from failing startup. Values are
 * re-read on every call so tests and deploy-time overrides take effect
 * without a module-cache reset.
 */

export const MAGIC_LINK_TTL_ENV_VAR = "MAGIC_LINK_TTL_MINUTES"

export const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15
export const MIN_MAGIC_LINK_TTL_MINUTES = 1
export const MAX_MAGIC_LINK_TTL_MINUTES = 60

const MS_PER_MINUTE = 60_000

export type MagicLinkConfig = {
  /** Lifetime handed to `issueOneTimeToken({ ttlMs })`. */
  ttlMs: number
  /**
   * Lifetime in minutes for user-facing copy. May be fractional when the
   * env override is (e.g. 2.5); format with {@link formatMagicLinkExpiry}.
   */
  expiresInMinutes: number
}

/**
 * Parses a raw `MAGIC_LINK_TTL_MINUTES` value into whole minutes, applying
 * the default for missing/invalid input and clamping to the allowed range.
 */
export function parseMagicLinkTtlMinutes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAGIC_LINK_TTL_MINUTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAGIC_LINK_TTL_MINUTES
  return Math.min(MAX_MAGIC_LINK_TTL_MINUTES, Math.max(MIN_MAGIC_LINK_TTL_MINUTES, parsed))
}

/**
 * Resolves the active magic-link configuration. `source` defaults to the
 * process environment; pass an explicit record in tests.
 */
export function getMagicLinkConfig(source?: EnvSource): MagicLinkConfig {
  const env = source ?? rawProcessEnv()
  const minutes = parseMagicLinkTtlMinutes(env[MAGIC_LINK_TTL_ENV_VAR])
  return {
    ttlMs: Math.round(minutes * MS_PER_MINUTE),
    expiresInMinutes: minutes,
  }
}

/**
 * Raw `process.env` access for a variable intentionally outside the
 * validated `ServerEnv` schema (see module docstring). This is the single
 * `process.env` touchpoint in the module; everything else takes an
 * injectable env source. Guarded so importing this module from a client
 * bundle (for the pure helpers above) never dereferences `process`.
 */
function rawProcessEnv(): EnvSource {
  // eslint-disable-next-line no-restricted-properties -- MAGIC_LINK_TTL_MINUTES is deliberately not part of ServerEnv; see module docstring
  return typeof process === "undefined" ? {} : process.env
}

/**
 * English duration phrase for email copy, e.g. "15 minutes", "1 minute",
 * "2.5 minutes". UI copy is localized separately in the screen component.
 */
export function formatMagicLinkExpiry(minutes: number): string {
  const rounded = Math.round(minutes * 10) / 10
  return `${rounded} ${rounded === 1 ? "minute" : "minutes"}`
}

/**
 * Stricter variant of the shared `sanitizeNextPath` (`schemas.ts`) for the
 * magic-link `next` parameter, used both when the request route embeds the
 * value into the emailed URL and when the `/magic-link` screen picks the
 * post-sign-in redirect target.
 *
 * The base check (`/...` but not `//...`) misses two open-redirect edges:
 *  - WHATWG URL parsing treats `\` as `/`, so `/\evil.example` navigates
 *    off-site even though it starts with a single slash;
 *  - control characters (tab, newline, DEL, …) can smuggle whitespace into
 *    the path that browsers trim or reinterpret.
 *
 * Anything rejected here falls back to the dashboard — the same behaviour
 * as a missing `next`.
 */
export function sanitizeMagicLinkNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null
  if (!value.startsWith("/") || value.startsWith("//")) return null
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    // Reject "\\" (normalized to "/" by URL parsers) and C0/DEL controls.
    if (char === "\\" || code < 0x20 || code === 0x7f) return null
  }
  return value
}
