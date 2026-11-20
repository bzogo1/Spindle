/**
 * Social share targets for referral (and future shareable) links.
 *
 * Pure helpers only — no React, no fetch at module level. `buildShareUrl`
 * produces the platform's official share-intent URL with properly encoded
 * parameters; `trackShareClick` is the fire-and-forget seam that reports a
 * share attempt to `POST /api/share/track` (see `src/lib/share-tracking.ts`
 * for the bounded in-memory counter store behind that endpoint).
 *
 * Safety rules:
 *  - The shared `url` must be an absolute `https:` URL — `http:`,
 *    `javascript:`, `data:`, relative paths, etc. are rejected.
 *  - Platform endpoints are hard-coded `https:` origins (plus `mailto:` for
 *    the email target, which is a protocol handler, not a navigable page).
 *  - Hashtags are sanitized to `[A-Za-z0-9_]` and capped so they cannot
 *    smuggle markup or oversized payloads into share intents.
 */

/** Endpoint hit by {@link trackShareClick}. Implemented by `src/app/api/share/track`. */
export const SHARE_TRACK_ENDPOINT = "/api/share/track"

/** Every share surface the UI can render or track. */
export const SHARE_PLATFORM_IDS = [
  "x",
  "linkedin",
  "facebook",
  "whatsapp",
  "telegram",
  "email",
  "native",
  "copy",
] as const

export type SharePlatformId = (typeof SHARE_PLATFORM_IDS)[number]

/** Platforms that `buildShareUrl` can turn into a share-intent URL. */
export type UrlSharePlatform = Exclude<SharePlatformId, "native" | "copy">

export const URL_SHARE_PLATFORMS: readonly UrlSharePlatform[] = [
  "x",
  "linkedin",
  "facebook",
  "whatsapp",
  "telegram",
  "email",
]

export interface ShareContent {
  /** Absolute https URL being shared. Required and validated. */
  url: string
  /** Optional share text / pitch shown alongside the link. */
  text?: string
  /** Optional email subject (email platform only). */
  subject?: string
  /** Optional hashtags; sanitized, `#`-prefixes stripped, deduped, capped. */
  hashtags?: readonly string[]
}

export type ShareTarget =
  | { id: UrlSharePlatform; label: string; kind: "url" }
  | { id: "native"; label: string; kind: "native" }
  | { id: "copy"; label: string; kind: "clipboard" }

/** Ordered list of share surfaces, shared by site and app components. */
export const SHARE_TARGETS: readonly ShareTarget[] = [
  { id: "x", label: "Post on X", kind: "url" },
  { id: "linkedin", label: "Share on LinkedIn", kind: "url" },
  { id: "facebook", label: "Share on Facebook", kind: "url" },
  { id: "whatsapp", label: "Share on WhatsApp", kind: "url" },
  { id: "telegram", label: "Share on Telegram", kind: "url" },
  { id: "email", label: "Send by email", kind: "url" },
  { id: "native", label: "Share…", kind: "native" },
  { id: "copy", label: "Copy link", kind: "clipboard" },
]

const MAX_HASHTAGS = 5
const MAX_HASHTAG_LENGTH = 50
const MAX_TEXT_LENGTH = 2000
const MAX_URL_LENGTH = 2048

function cleanText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, MAX_TEXT_LENGTH)
  return trimmed.length > 0 ? trimmed : undefined
}

/** Strips `#`, keeps `[A-Za-z0-9_]`, dedupes, caps count and length. */
export function sanitizeHashtags(hashtags: readonly string[] | undefined): string[] {
  if (!hashtags) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of hashtags) {
    if (typeof raw !== "string") continue
    const tag = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/[^A-Za-z0-9_]/g, "")
      .slice(0, MAX_HASHTAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= MAX_HASHTAGS) break
  }
  return out
}

/** Appends ` #tag` tokens to a share text for text-only platforms. */
function withHashtags(text: string | undefined, tags: string[]): string | undefined {
  if (tags.length === 0) return text
  const suffix = tags.map((t) => `#${t}`).join(" ")
  return text ? `${text} ${suffix}` : suffix
}

function requireHttpsUrl(url: string): URL {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) {
    throw new Error("share url must be a non-empty string")
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("share url must be an absolute URL")
  }
  if (parsed.protocol !== "https:") {
    throw new Error("share url must use https:")
  }
  return parsed
}

/**
 * Builds the share-intent URL for a platform. Throws on invalid input
 * (non-https or malformed `url`, wrong platform id) — callers rendering
 * anchors should treat a throw as "no href".
 *
 * Hashtag handling per platform:
 *  - `x` → dedicated `hashtags` query param (comma-separated, no `#`).
 *  - `whatsapp`, `telegram`, `email`, `facebook` → appended to the text/quote.
 *  - `linkedin` → ignored (the share-offline endpoint takes only `url`).
 */
export function buildShareUrl(platform: UrlSharePlatform, content: ShareContent): string {
  const parsed = requireHttpsUrl(content.url)
  const url = parsed.toString()
  const text = cleanText(content.text)
  const tags = sanitizeHashtags(content.hashtags)

  switch (platform) {
    case "x": {
      const params = new URLSearchParams()
      if (text) params.set("text", text)
      params.set("url", url)
      if (tags.length > 0) params.set("hashtags", tags.join(","))
      return `https://twitter.com/intent/tweet?${params.toString()}`
    }
    case "linkedin": {
      const params = new URLSearchParams({ url })
      return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`
    }
    case "facebook": {
      const params = new URLSearchParams({ u: url })
      const quote = withHashtags(text, tags)
      if (quote) params.set("quote", quote)
      return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`
    }
    case "whatsapp": {
      const message = [withHashtags(text, tags), url].filter(Boolean).join("\n")
      const params = new URLSearchParams({ text: message })
      return `https://wa.me/?${params.toString()}`
    }
    case "telegram": {
      const params = new URLSearchParams({ url })
      const shareText = withHashtags(text, tags)
      if (shareText) params.set("text", shareText)
      return `https://t.me/share/url?${params.toString()}`
    }
    case "email": {
      const subject = cleanText(content.subject) ?? "Check out this link"
      const body = [withHashtags(text, tags), url].filter(Boolean).join("\n\n")
      const params = new URLSearchParams({ subject, body })
      return `mailto:?${params.toString()}`
    }
    default:
      throw new Error(`unsupported share platform: ${String(platform)}`)
  }
}

/** True when the Web Share API (`navigator.share`) is available. */
export function canUseNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { share?: unknown }).share === "function"
  )
}

/**
 * Fire-and-forget share-click report to `POST /api/share/track`.
 * Never throws and never blocks the share action — tracking is best-effort
 * analytics, matching the referral program's interim-store philosophy.
 */
export function trackShareClick(platform: SharePlatformId, code?: string | null): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return
  const payload: Record<string, string> = { platform }
  if (code) payload.code = code
  try {
    void fetch(SHARE_TRACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Tracking must never surface an error to the sharer.
    })
  } catch {
    // fetch itself threw synchronously — ignore.
  }
}
