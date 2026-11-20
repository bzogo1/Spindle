import { z } from "zod"

import { SPAM_TIMESTAMP_FIELD } from "./contact-spam"
import { CONTACT_LIMITS, CONTACT_TOPICS, HONEYPOT_FIELD } from "./site-form-constants"

// Re-exported so server routes and tests can keep importing everything from
// this module; client components should import the leaf constants from
// `./site-form-constants` to stay out of the zod graph.
export {
  CONTACT_LIMITS,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  HONEYPOT_FIELD,
  NEWSLETTER_SOURCE,
} from "./site-form-constants"
export { SPAM_TIMESTAMP_FIELD } from "./contact-spam"
export type { ContactTopic } from "./site-form-constants"

/**
 * Shared validation and abuse controls for the public site forms
 * (contact + newsletter).
 *
 * Both forms carry a `website` honeypot: it is rendered off-screen for humans
 * and must stay empty. Bots that fill every field get a silent success so they
 * cannot distinguish a blocked submission from a real one.
 */

/** Empty/whitespace strings mean "not provided" for optional fields. */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(CONTACT_LIMITS.nameMax),
  email: z.email("Enter a valid email address.").max(320),
  topic: z.enum(CONTACT_TOPICS, "Please choose a topic."),
  // Optional order/account/company reference; lets support tie the message
  // to an existing record without making it a required field.
  reference: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(CONTACT_LIMITS.referenceMax, "Reference is too long.").optional(),
  ),
  subject: z.string().trim().min(1, "Subject is required.").max(CONTACT_LIMITS.subjectMax),
  message: z
    .string()
    .trim()
    .min(CONTACT_LIMITS.messageMin, "Message must be at least 10 characters.")
    .max(CONTACT_LIMITS.messageMax, "Message is too long."),
  [HONEYPOT_FIELD]: z.string().max(500).optional().or(z.literal("")),
  // Hidden render timestamp for the contact spam time-trap. Optional so
  // non-browser clients still parse; missing/invalid values are themselves
  // scored by `assessContactSpam`.
  [SPAM_TIMESTAMP_FIELD]: z.string().max(40).optional(),
})

export const newsletterSchema = z.object({
  email: z.email("Enter a valid email address.").max(320),
  source: z.string().max(100).optional(),
  // The form requires the checkbox, so a submission must carry explicit
  // consent; this is an audit-trail signal, not persisted anywhere.
  consent: z.literal(true, "Please agree to the Privacy Policy to subscribe."),
  [HONEYPOT_FIELD]: z.string().max(500).optional().or(z.literal("")),
})

export type ContactInput = z.infer<typeof contactSchema>
export type NewsletterInput = z.infer<typeof newsletterSchema>

/**
 * Human-quotable reference id for a contact submission, e.g. `CT-4F2A9C1D`.
 * Derived from a UUID so collisions are effectively impossible; it is shown
 * to the visitor on success and quoted in the notification email so support
 * and the sender can refer to the same thread.
 */
export function createContactReference(): string {
  const hex = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()
  return `CT-${hex}`
}

/** True when a bot filled the honeypot. */
export function isHoneypotTriggered(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export type FieldErrors = Record<string, string>

/** Flattens a failed zod parse into per-field messages for inline display. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form")
    errors[key] ??= issue.message
  }
  return errors
}

/**
 * Best-effort fixed-window rate limiter keyed by client IP.
 *
 * State lives in this process only: on serverless/multi-instance deploys each
 * instance keeps its own counters, so this blunts casual abuse rather than
 * providing a hard guarantee. A shared store (Redis/DB) is the upgrade path
 * if abuse becomes a real problem.
 */
export type RateLimiter = {
  /** Returns true when the request is allowed; false when over the limit. */
  check(key: string): boolean
  /** Number of tracked keys; primarily for tests and diagnostics. */
  size(): number
}

/** Above this many tracked keys, expired entries are swept on the next write. */
const RATE_LIMITER_PRUNE_THRESHOLD = 500

export function createRateLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
}: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()

  // Opportunistic cleanup so the map cannot grow without bound: once it
  // exceeds the threshold, the next write sweeps every expired entry first.
  function prune() {
    const at = now()
    for (const [key, entry] of hits) {
      if (entry.resetAt <= at) hits.delete(key)
    }
  }

  return {
    check(key: string) {
      const at = now()
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= at) {
        if (hits.size >= RATE_LIMITER_PRUNE_THRESHOLD) prune()
        hits.set(key, { count: 1, resetAt: at + windowMs })
        return true
      }
      if (entry.count >= limit) return false
      entry.count += 1
      return true
    },
    size() {
      return hits.size
    },
  }
}

/** First address in `x-forwarded-for`, falling back to a single bucket. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  return first || "unknown"
}
