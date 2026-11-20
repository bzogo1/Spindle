import { z } from "zod"

import { HONEYPOT_FIELD } from "./site-form-constants"
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS } from "./feedback-constants"

// Re-exported so server routes and tests can keep importing everything from
// this module; client components must import the leaf constants from
// `./feedback-constants` to stay out of the zod graph.
export {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_LIMITS,
} from "./feedback-constants"
export type { FeedbackCategory } from "./feedback-constants"

/**
 * User feedback collection.
 *
 * `feedbackSchema` validates `POST /api/feedback` submissions; the route
 * stores accepted entries in a process-local in-memory store
 * (`createFeedbackStore` / `feedbackStore`) — the same best-effort posture as
 * the other public forms: abuse is blunted by a per-IP rate limit and the
 * honeypot, not by durable persistence.
 */

/** Empty/whitespace email means "no email provided", not a validation error. */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES, "Choose a category for your feedback."),
  message: z
    .string()
    .trim()
    .min(FEEDBACK_LIMITS.messageMin, "Message must be at least 10 characters.")
    .max(FEEDBACK_LIMITS.messageMax, "Message is too long."),
  email: z.preprocess(
    emptyToUndefined,
    z.email("Enter a valid email address.").max(FEEDBACK_LIMITS.emailMax).optional(),
  ),
  // Honeypot shared with the other public forms; must stay empty.
  [HONEYPOT_FIELD]: z.string().max(500).optional().or(z.literal("")),
})

export type FeedbackInput = z.infer<typeof feedbackSchema>
/** Parsed submission minus the honeypot — what actually gets stored. */
export type FeedbackSubmission = Omit<FeedbackInput, typeof HONEYPOT_FIELD>

export interface FeedbackEntry extends FeedbackSubmission {
  id: string
  createdAt: string
}

export interface FeedbackStore {
  add(input: FeedbackSubmission): FeedbackEntry
  list(): readonly FeedbackEntry[]
  clear(): void
}

/**
 * Process-local feedback store. Entries are lost on restart and are not
 * shared across instances — intentional for now; a durable store (DB table)
 * is the upgrade path once feedback needs to reach a human reliably.
 */
export function createFeedbackStore(now: () => Date = () => new Date()): FeedbackStore {
  const entries: FeedbackEntry[] = []
  let sequence = 0

  return {
    add(input) {
      sequence += 1
      const entry: FeedbackEntry = {
        ...input,
        id: `feedback-${now().getTime().toString(36)}-${sequence}`,
        createdAt: now().toISOString(),
      }
      entries.push(entry)
      return entry
    },
    list() {
      return entries
    },
    clear() {
      entries.length = 0
    },
  }
}

/** Shared store used by `POST /api/feedback`. */
export const feedbackStore = createFeedbackStore()
