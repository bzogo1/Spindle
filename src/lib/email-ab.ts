import { createHash } from "node:crypto"

import { normalizeEmail } from "@/lib/email-unsubscribe"
import { logger } from "@/lib/logger"

/**
 * Email A/B experiment store + deterministic variant assignment.
 *
 * An "experiment" targets an `emailKey` — a free-form identifier for the
 * email template or campaign it applies to (e.g. `"welcome-day-0"`,
 * `"newsletter-spring-launch"`). Each experiment has 2–4 variants with a
 * stable `key`, a `subject`, and an optional `bodyPreview` (the first
 * BODY_PREVIEW_LENGTH characters of the variant body; the full body is not
 * persisted).
 *
 * DEVELOPMENT SEAM: experiments live in a process-local `Map`, the same
 * interim-store pattern as `email-series.ts` and `newsletter-store.ts`. On
 * multi-instance/serverless deploys each instance keeps its own copy —
 * assignment is still stable per instance (the hash depends only on
 * emailKey + experimentId + normalized recipient email), but different
 * instances may disagree if the store content diverges. The upgrade path
 * is an `EmailExperiment` table; the exported function signatures are
 * already shaped for that swap.
 *
 * NOT WIRED INTO SEND PATHS: nothing in `email-series.ts`, the mailer, or
 * templates reads this store. The intended wiring point is the send-time
 * call site — for series emails that is `processEmailSeriesQueue` in
 * `src/lib/email-series.ts` (before `renderWelcomeSeriesEmail`, call
 * `pickVariant({ emailKey: <series-or-step-key> }, enrollment.email)` and
 * render the winning variant's subject/body instead of the template
 * default); for one-off sends it is whatever calls `sendSeriesEmail` /
 * the mailer directly. Assignment is content-free: variants carry a
 * subject + body preview only; rendering the variant body is the send
 * path's job once templates learn to accept overrides.
 *
 * Metrics: opens/clicks are NOT tracked — this module only assigns
 * variants. Recording sends/impressions is a follow-up task.
 */

export const EMAIL_AB_MAX_EXPERIMENTS = 100
export const EMAIL_AB_MIN_VARIANTS = 2
export const EMAIL_AB_MAX_VARIANTS = 4
/** Variant bodies are not persisted; only this many characters are kept. */
const BODY_PREVIEW_LENGTH = 160

export type EmailAbStatus = "draft" | "running" | "paused" | "concluded"

export const EMAIL_AB_STATUSES: readonly EmailAbStatus[] = [
  "draft",
  "running",
  "paused",
  "concluded",
]

export interface EmailAbVariant {
  /** Stable variant key, unique within the experiment (e.g. "control", "b"). */
  key: string
  subject: string
  /** First BODY_PREVIEW_LENGTH chars of the variant body; absent when unset. */
  bodyPreview?: string
}

export interface EmailAbExperiment {
  id: string
  name: string
  /** Free-form identifier of the email template/campaign this experiment applies to. */
  emailKey: string
  variants: EmailAbVariant[]
  status: EmailAbStatus
  /** Variant key chosen at conclusion; absent until concluded. */
  winnerKey?: string
  /** ISO timestamps. */
  createdAt: string
  concludedAt?: string
}

export interface VariantAssignment {
  variant: EmailAbVariant
  experimentId: string
}

const experiments = new Map<string, EmailAbExperiment>() // id → record

function experimentId(): string {
  return `exp_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneVariant(variant: EmailAbVariant): EmailAbVariant {
  return { ...variant }
}

function cloneExperiment(experiment: EmailAbExperiment): EmailAbExperiment {
  return {
    ...experiment,
    variants: experiment.variants.map(cloneVariant),
  }
}

/** Valid status transitions. `concluded` is terminal and only reachable via `concludeExperiment`. */
const ALLOWED_TRANSITIONS: Record<EmailAbStatus, readonly EmailAbStatus[]> = {
  draft: ["running"],
  running: ["paused"],
  paused: ["running"],
  concluded: [],
}

export function isEmailAbStatus(value: string): value is EmailAbStatus {
  return (EMAIL_AB_STATUSES as readonly string[]).includes(value)
}

/**
 * Creates a draft experiment. Throws on invalid input (the API layer
 * validates with zod first; this is defense in depth for direct callers).
 */
export function createExperiment(input: {
  name: string
  emailKey: string
  variants: Array<{ key: string; subject: string; body?: string }>
}): EmailAbExperiment {
  const name = input.name.trim()
  const emailKey = input.emailKey.trim()
  if (!name) throw new Error("createExperiment requires a name")
  if (!emailKey) throw new Error("createExperiment requires an emailKey")
  if (
    input.variants.length < EMAIL_AB_MIN_VARIANTS ||
    input.variants.length > EMAIL_AB_MAX_VARIANTS
  ) {
    throw new Error(
      `createExperiment requires ${EMAIL_AB_MIN_VARIANTS}-${EMAIL_AB_MAX_VARIANTS} variants`,
    )
  }

  const seen = new Set<string>()
  const variants: EmailAbVariant[] = input.variants.map((variant) => {
    const key = variant.key.trim()
    const subject = variant.subject.trim()
    if (!key) throw new Error("variant key is required")
    if (!subject) throw new Error("variant subject is required")
    if (seen.has(key)) throw new Error(`duplicate variant key: ${key}`)
    seen.add(key)
    const body = variant.body?.trim()
    return {
      key,
      subject,
      ...(body ? { bodyPreview: body.slice(0, BODY_PREVIEW_LENGTH) } : {}),
    }
  })

  const experiment: EmailAbExperiment = {
    id: experimentId(),
    name,
    emailKey,
    variants,
    status: "draft",
    createdAt: nowIso(),
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion
  // order) so a flood of experiments cannot grow memory without limit.
  if (experiments.size >= EMAIL_AB_MAX_EXPERIMENTS) {
    const oldest = experiments.keys().next().value
    if (oldest !== undefined) experiments.delete(oldest)
  }
  experiments.set(experiment.id, experiment)
  logger.info(
    {
      event: "email.ab.created",
      experimentId: experiment.id,
      emailKey,
      variantCount: variants.length,
    },
    "Email A/B experiment created",
  )
  return cloneExperiment(experiment)
}

/** Returns a snapshot of the experiment, or null when the id is unknown. */
export function getExperiment(id: string): EmailAbExperiment | null {
  const experiment = experiments.get(id)
  return experiment ? cloneExperiment(experiment) : null
}

/** Lists experiments newest-first; `status` filters when provided. */
export function listExperiments(filter?: { status?: EmailAbStatus }): EmailAbExperiment[] {
  return [...experiments.values()]
    .filter((experiment) => !filter?.status || experiment.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map(cloneExperiment)
}

/**
 * Transitions an experiment's status along the allowed edges
 * (draft→running, running↔paused). Returns the updated experiment, or null
 * when the id is unknown or the transition is not allowed.
 * Concluded experiments are immutable — use `concludeExperiment`.
 */
export function updateExperimentStatus(
  id: string,
  status: Exclude<EmailAbStatus, "concluded">,
): EmailAbExperiment | null {
  const experiment = experiments.get(id)
  if (!experiment) return null
  if (!ALLOWED_TRANSITIONS[experiment.status].includes(status)) return null
  experiment.status = status
  return cloneExperiment(experiment)
}

/**
 * Concludes an experiment, recording the winning variant key. Allowed from
 * `running` or `paused` (a draft has never assigned anyone). `winnerKey`
 * must match one of the experiment's variant keys. After conclusion
 * `pickVariant` always returns the winner.
 */
export function concludeExperiment(id: string, winnerKey: string): EmailAbExperiment | null {
  const experiment = experiments.get(id)
  if (!experiment) return null
  if (experiment.status !== "running" && experiment.status !== "paused") return null
  if (!experiment.variants.some((variant) => variant.key === winnerKey)) return null

  experiment.status = "concluded"
  experiment.winnerKey = winnerKey
  experiment.concludedAt = nowIso()
  logger.info(
    { event: "email.ab.concluded", experimentId: id, winnerKey },
    "Email A/B experiment concluded",
  )
  return cloneExperiment(experiment)
}

/**
 * Deterministic variant assignment.
 *
 * `selector` is either an experiment id or an `emailKey`. Resolution:
 *  - exact id match wins;
 *  - otherwise experiments with `emailKey === selector` are considered —
 *    the first `running` one (newest-first order) is used; when none is
 *    running, a single matching experiment is used so concluded winners
 *    still resolve.
 *
 * Assignment is stable: `sha256(emailKey + experimentId + normalizedEmail)`
 * bucketed modulo the variant count — the same recipient always lands on
 * the same variant for a given experiment, across restarts and instances.
 *
 * Only `running` experiments assign variants (hash bucket). A `concluded`
 * experiment always returns its winner. `draft`/`paused` return null —
 * callers should fall back to the default content.
 */
export function pickVariant(selector: string, recipientEmail: string): VariantAssignment | null {
  const target = experiments.get(selector) ?? resolveByEmailKey(selector)
  if (!target) return null

  if (target.status === "concluded") {
    const winner = target.variants.find((variant) => variant.key === target.winnerKey)
    return winner ? { variant: cloneVariant(winner), experimentId: target.id } : null
  }
  if (target.status !== "running") return null

  const normalized = normalizeEmail(recipientEmail)
  if (!normalized) return null

  const digest = createHash("sha256").update(`${target.emailKey}${target.id}${normalized}`).digest()
  const bucket = digest.readUInt32BE(0) % target.variants.length
  return {
    variant: cloneVariant(target.variants[bucket]),
    experimentId: target.id,
  }
}

function resolveByEmailKey(emailKey: string): EmailAbExperiment | null {
  const matches = listExperiments().filter((experiment) => experiment.emailKey === emailKey)
  if (matches.length === 0) return null
  return matches.find((experiment) => experiment.status === "running") ?? matches[0]
}

/** Test hook: clears all experiments. */
export function resetEmailAbForTests(): void {
  experiments.clear()
}
