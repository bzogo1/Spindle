/**
 * Server-side spam heuristics for the public contact form.
 *
 * Layers on top of the honeypot (`isHoneypotTriggered`) and the per-IP rate
 * limiter: the honeypot catches bots that fill every field, the rate limiter
 * blunts submission volume, and this module scores *how spammy a
 * valid-looking submission is* so the route can pick one of three tiers:
 *
 * - `pass`       — deliver normally.
 * - `suspicious` — deliver, but log the signals for review. False positives
 *                  must still reach a human, so nothing is blocked.
 * - `drop`       — obvious spam: pretend success and send nothing, the same
 *                  posture as the honeypot so bots learn nothing.
 *
 * Checks implemented here:
 *
 * - **Time trap** — the form renders a hidden `renderedAt` timestamp; a
 *   submission faster than `minFillSeconds`, stale beyond `maxFormAgeSeconds`,
 *   or missing/invalid is flagged. Client fields are hints only; the server
 *   re-derives the verdict from the raw payload.
 * - **Content signals** — link count/density, long runs of a repeated
 *   character, and a high ratio of non-Latin letters (configurable via
 *   `limits` / `disposableDomains`).
 * - **Velocity** — enforced by the route with `createRateLimiter` (per-IP and
 *   per-email daily ceilings); over-limit submissions get a `velocity` signal.
 *
 * The module is zod-free and side-effect free so the client form can import
 * `SPAM_TIMESTAMP_FIELD` without pulling server code into the bundle.
 */

/** Hidden timestamp field rendered by the contact form for the time trap. */
export const SPAM_TIMESTAMP_FIELD = "renderedAt"

export const CONTACT_SPAM_LIMITS = {
  /** Submissions faster than this after render are flagged. */
  minFillSeconds: 3,
  /** Render timestamps older than this are flagged as stale. */
  maxFormAgeSeconds: 24 * 60 * 60,
  /** Timestamps this far in the future are flagged as forged. */
  maxClockSkewSeconds: 5 * 60,
  /** Daily per-IP submission ceiling for the velocity signal. */
  ipSubmissionsPerDay: 30,
  /** Daily per-email submission ceiling for the velocity signal. */
  emailSubmissionsPerDay: 3,
  /** More links than this in subject+message is suspicious. */
  maxLinks: 2,
  /** Link characters covering more than this fraction of the text is suspicious. */
  linkDensityMax: 0.4,
  /** Above these the submission is dropped as obvious link spam. */
  linkDensityDrop: 0.7,
  maxLinkCountDrop: 6,
  /** A run of one character at least this long is suspicious. */
  repeatedCharSuspicious: 8,
  /** A run of one character at least this long is dropped. */
  repeatedCharDrop: 15,
  /** Fewer letters than this skips the script-ratio check entirely. */
  minLettersForScriptCheck: 10,
  /** Non-Latin letter share above this is suspicious. */
  nonLatinRatioSuspicious: 0.5,
} as const

/** Widened to `number` so callers/tests can pass custom thresholds. */
export type ContactSpamLimits = { -readonly [K in keyof typeof CONTACT_SPAM_LIMITS]: number }

/**
 * Well-known throwaway-mailbox providers. Matched exactly or as a parent
 * domain (`x.mailinator.com` counts). Extendable per call via
 * `assessContactSpam` options.
 */
export const DISPOSABLE_EMAIL_DOMAINS = [
  "10minutemail.com",
  "dispostable.com",
  "getnada.com",
  "guerrillamail.com",
  "mailinator.com",
  "maildrop.cc",
  "sharklasers.com",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
] as const

export type SpamSeverity = "suspicious" | "drop"

export interface SpamSignal {
  /** Stable machine-readable code, e.g. `trap-too-fast`, `links`, `velocity`. */
  code: string
  severity: SpamSeverity
}

export type SpamVerdict = "pass" | "suspicious" | "drop"

/** The fields the heuristics inspect. All optional — missing data is itself a signal. */
export interface ContactSpamInput {
  renderedAt?: string | null
  name?: string
  email?: string
  subject?: string
  message?: string
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/giu
/** Punctuation that commonly trails a URL in prose but is not part of it. */
const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]}'"’”]+$/u
const LETTER_PATTERN = /\p{L}/gu
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/gu
// Only non-whitespace characters count: a pasted log or code block with long
// runs of spaces must not trip the repeated-character heuristic.
const REPEATED_CHAR_PATTERN = /(\S)\1*/gu

function linkStats(text: string): { count: number; chars: number } {
  const matches = (text.match(URL_PATTERN) ?? []).map((match) =>
    // Sentence punctuation glued to the URL ("see https://x.com.") is prose,
    // not link weight — strip it before measuring density.
    match.replace(TRAILING_URL_PUNCTUATION, ""),
  )
  return { count: matches.length, chars: matches.reduce((sum, m) => sum + m.length, 0) }
}

/** Length of the longest run of a single repeated character. */
function longestRepeatedRun(text: string): number {
  let longest = 0
  for (const match of text.matchAll(REPEATED_CHAR_PATTERN)) {
    if (match[0].length > longest) longest = match[0].length
  }
  return longest
}

function letterStats(text: string): { total: number; latin: number } {
  const total = text.match(LETTER_PATTERN)?.length ?? 0
  const latin = text.match(LATIN_LETTER_PATTERN)?.length ?? 0
  return { total, latin }
}

function isDisposableEmail(email: string | undefined, domains: readonly string[]): boolean {
  const domain = email?.split("@").pop()?.trim().toLowerCase()
  if (!domain) return false
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/**
 * Scores a parsed contact submission. Returns the list of triggered signals;
 * combine with `spamVerdict` (the route adds its own `velocity` signal first).
 */
export function assessContactSpam(
  input: ContactSpamInput,
  options: {
    now?: number
    limits?: Partial<ContactSpamLimits>
    disposableDomains?: readonly string[]
  } = {},
): SpamSignal[] {
  const limits = { ...CONTACT_SPAM_LIMITS, ...options.limits }
  const now = options.now ?? Date.now()
  const domains = options.disposableDomains ?? DISPOSABLE_EMAIL_DOMAINS
  const signals: SpamSignal[] = []
  const suspicious = (code: string) => signals.push({ code, severity: "suspicious" })
  const drop = (code: string) => signals.push({ code, severity: "drop" })

  // --- Time trap -------------------------------------------------------
  const renderedAt = input.renderedAt
  if (!renderedAt) {
    suspicious("trap-missing")
  } else {
    const renderedMs = Date.parse(renderedAt)
    if (Number.isNaN(renderedMs)) {
      suspicious("trap-invalid")
    } else {
      const elapsedSeconds = (now - renderedMs) / 1000
      if (elapsedSeconds < -limits.maxClockSkewSeconds) {
        suspicious("trap-future")
      } else if (elapsedSeconds >= 0 && elapsedSeconds < limits.minFillSeconds) {
        suspicious("trap-too-fast")
      } else if (elapsedSeconds > limits.maxFormAgeSeconds) {
        suspicious("trap-stale")
      }
    }
  }

  // --- Content signals ---------------------------------------------------
  // The name field is included: bots routinely hide links or script-like
  // text there, and a real name is short enough not to skew the ratios.
  const text = [input.name, input.subject, input.message].filter(Boolean).join("\n")

  const { count: linkCount, chars: linkChars } = linkStats(text)
  const textLength = text.trim().length
  const linkDensity = textLength > 0 ? linkChars / textLength : 0
  if (linkCount > limits.maxLinkCountDrop || linkDensity > limits.linkDensityDrop) {
    drop("link-spam")
  } else if (linkCount > limits.maxLinks || linkDensity > limits.linkDensityMax) {
    suspicious("links")
  }

  const run = longestRepeatedRun(text)
  if (run >= limits.repeatedCharDrop) {
    drop("repeated-chars")
  } else if (run >= limits.repeatedCharSuspicious) {
    suspicious("repeated-chars")
  }

  const { total: letters, latin } = letterStats(text)
  if (letters >= limits.minLettersForScriptCheck) {
    const nonLatinRatio = (letters - latin) / letters
    if (nonLatinRatio > limits.nonLatinRatioSuspicious) {
      suspicious("non-latin")
    }
  }

  if (isDisposableEmail(input.email, domains)) {
    suspicious("disposable-email")
  }

  return signals
}

/** Worst severity wins: any `drop` signal drops, else any signal flags. */
export function spamVerdict(signals: readonly SpamSignal[]): SpamVerdict {
  if (signals.some((s) => s.severity === "drop")) return "drop"
  if (signals.length > 0) return "suspicious"
  return "pass"
}
