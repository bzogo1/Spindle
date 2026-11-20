import { z } from "zod"

import { HONEYPOT_FIELD } from "./site-form-constants"

/**
 * NPS (Net Promoter Score) survey — schema, scoring, and an in-memory store.
 *
 * Responses are anonymous: the route never asks for an identity, so a "user"
 * id cannot be attached. The store lives in this process only — like
 * `createRateLimiter` in `site-forms.ts`, it blunts casual abuse and supports
 * local/dev use, but a shared store (DB/Redis) is the upgrade path if the data
 * needs to survive restarts or span instances.
 *
 * Client components must not import this module (it pulls in zod); they keep
 * their own copy of the comment limit and POST a plain JSON body.
 */

export const NPS_COMMENT_MAX = 2000
export const NPS_SOURCES = ["widget", "page", "email"] as const
export type NpsSource = (typeof NPS_SOURCES)[number]

export const npsSchema = z.object({
  score: z
    .number()
    .int("Score must be a whole number.")
    .min(0, "Score must be between 0 and 10.")
    .max(10, "Score must be between 0 and 10."),
  comment: z
    .string()
    .trim()
    .max(NPS_COMMENT_MAX, "Comment is too long.")
    .optional()
    .or(z.literal("")),
  source: z.enum(NPS_SOURCES).optional().or(z.literal("")),
  [HONEYPOT_FIELD]: z.string().max(500).optional().or(z.literal("")),
})

export type NpsInput = z.infer<typeof npsSchema>

export type NpsResponse = {
  id: string
  score: number
  comment: string
  source: string
  submittedAt: string
}

export type NpsSegment = "detractor" | "passive" | "promoter"

/** Classic NPS buckets: 0–6 detractors, 7–8 passives, 9–10 promoters. */
export function npsSegment(score: number): NpsSegment {
  if (score <= 6) return "detractor"
  if (score <= 8) return "passive"
  return "promoter"
}

// ---------------------------------------------------------------------------
// In-memory response store
// ---------------------------------------------------------------------------

const responses: NpsResponse[] = []
let nextId = 1

/** Records a validated response and returns it with server-assigned fields. */
export function recordNpsResponse(input: {
  score: number
  comment?: string
  source?: string
}): NpsResponse {
  const response: NpsResponse = {
    id: `nps-${nextId++}`,
    score: input.score,
    comment: input.comment?.trim() ?? "",
    source: input.source?.trim() || "unknown",
    submittedAt: new Date().toISOString(),
  }
  responses.push(response)
  return response
}

/** Returns a copy of all stored responses, oldest first. */
export function listNpsResponses(): NpsResponse[] {
  return responses.map((response) => ({ ...response }))
}

export type NpsSummary = {
  total: number
  promoters: number
  passives: number
  detractors: number
  /** %promoters − %detractors, rounded; null when there are no responses. */
  score: number | null
}

export function summarizeNps(): NpsSummary {
  const summary: NpsSummary = {
    total: responses.length,
    promoters: 0,
    passives: 0,
    detractors: 0,
    score: null,
  }
  for (const response of responses) {
    switch (npsSegment(response.score)) {
      case "promoter":
        summary.promoters += 1
        break
      case "passive":
        summary.passives += 1
        break
      case "detractor":
        summary.detractors += 1
        break
    }
  }
  if (summary.total > 0) {
    summary.score = Math.round(((summary.promoters - summary.detractors) / summary.total) * 100)
  }
  return summary
}

/** Test-only: clears all stored responses and resets id allocation. */
export function resetNpsStore(): void {
  responses.length = 0
  nextId = 1
}
