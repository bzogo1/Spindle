import { createHash } from "node:crypto"

import { logger } from "@/lib/logger"

/**
 * Landing-page A/B experiment store + deterministic sticky assignment.
 *
 * An "experiment" targets a named surface — currently the referral landing
 * page (`/r/[code]`), resolved by the `name` field (e.g. `"referral-landing"`).
 * Each experiment has 2–6 weighted variants; a variant carries a free-form
 * `config` the surface interprets (`headline?`, `ctaLabel?`,
 * `showSocialProof?` for the referral landing).
 *
 * DEVELOPMENT SEAM: experiments, assignments, and events live in
 * process-local `Map`/array state, the same interim-store pattern as
 * `email-ab.ts` / `referral-program.ts`. On multi-instance/serverless
 * deploys each instance keeps its own copy — assignment is still stable
 * per instance (the hash depends only on experimentId + visitorId), but
 * different instances may disagree if store content diverges, and all
 * state is lost on restart. The upgrade path is `LandingExperiment` /
 * `LandingAssignment` / `LandingEvent` tables behind the same exported
 * signatures.
 *
 * Assignment is sticky AND deterministic: `sha256(experimentId + visitorId)`
 * is bucketed over the cumulative variant weights, and the result is
 * persisted in `assignments` so repeat calls for the same visitor return
 * the same variant even if weights later change. Name-based resolution
 * picks the NEWEST experiment for the surface regardless of status:
 * `completed` experiments resolve every visitor to their `winnerVariantId`;
 * `running` experiments assign inside their optional `startAt`/`endAt`
 * window; `draft` and `paused` return null so callers fall back to control
 * copy. This means a concluded experiment keeps serving its winner instead
 * of silently restarting the test.
 *
 * Visitor ids are client-generated anonymous ids (a random UUID in
 * localStorage) — no PII is required or stored beyond the id itself.
 * Event payloads store the visitor id verbatim (bounded length); assignment
 * keys store only its hash.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

export const LANDING_AB_MAX_EXPERIMENTS = 100
export const LANDING_AB_MIN_VARIANTS = 2
export const LANDING_AB_MAX_VARIANTS = 6
/** Hard caps so the in-memory stores cannot grow without bound. */
export const LANDING_AB_MAX_EVENTS = 50_000
export const LANDING_AB_MAX_ASSIGNMENTS = 50_000
export const LANDING_AB_MAX_WEIGHT = 1_000_000
export const LANDING_AB_MAX_NAME_LENGTH = 120
export const LANDING_AB_MAX_VARIANT_ID_LENGTH = 80
export const LANDING_AB_MAX_VISITOR_ID_LENGTH = 128
export const LANDING_AB_MAX_CONFIG_STRING_LENGTH = 500

/** Name of the seeded/default experiment the `/r/[code]` page resolves. */
export const DEFAULT_LANDING_EXPERIMENT_NAME = "referral-landing"

export const LANDING_AB_STATUSES = ["draft", "running", "paused", "completed"] as const
export type LandingAbStatus = (typeof LANDING_AB_STATUSES)[number]

export const LANDING_AB_EVENT_TYPES = ["view", "signup_click", "cta_click"] as const
export type LandingAbEventType = (typeof LANDING_AB_EVENT_TYPES)[number]

/** Free-form per-variant presentation overrides; absent keys = surface default. */
export interface LandingAbVariantConfig {
  headline?: string
  ctaLabel?: string
  showSocialProof?: boolean
  [key: string]: string | number | boolean | undefined
}

export interface LandingAbVariant {
  id: string
  /** Positive integer relative weight (not a percentage — weights are normalized). */
  weight: number
  config: LandingAbVariantConfig
}

export interface LandingAbExperiment {
  id: string
  /** Surface identifier, e.g. "referral-landing". */
  name: string
  variants: LandingAbVariant[]
  status: LandingAbStatus
  /** Optional ISO scheduling window; assignment is null outside it. */
  startAt?: string
  endAt?: string
  /** Variant id chosen at completion; absent until completed. */
  winnerVariantId?: string
  /** ISO timestamps. */
  createdAt: string
  completedAt?: string
}

export interface LandingAbEvent {
  experimentId: string
  variantId?: string
  visitorId: string
  type: LandingAbEventType
  at: string
}

export interface LandingAbAssignment {
  experimentId: string
  variantId: string
  variant: LandingAbVariant
}

export interface LandingAbVariantResult {
  variantId: string
  weight: number
  assigned: number
  views: number
  ctaClicks: number
  signupClicks: number
  /** views / assigned (0 when nobody was assigned). */
  viewRate: number
  /** (ctaClicks + signupClicks) / views (0 when no views). */
  clickRate: number
}

export interface LandingAbResults {
  experimentId: string
  status: LandingAbStatus
  winnerVariantId?: string
  variants: LandingAbVariantResult[]
  totals: {
    assigned: number
    views: number
    ctaClicks: number
    signupClicks: number
  }
}

export class LandingAbError extends Error {
  readonly code: "invalid" | "not_found" | "invalid_transition" | "limit"
  constructor(code: "invalid" | "not_found" | "invalid_transition" | "limit", message: string) {
    super(message)
    this.name = "LandingAbError"
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const experiments = new Map<string, LandingAbExperiment>() // id → record (insertion order)
/** `${experimentId}\0${visitorHash}` → variantId. Insertion-ordered for eviction. */
const assignments = new Map<string, string>()
const events: LandingAbEvent[] = []

function experimentId(): string {
  return `lab_${crypto.randomUUID()}`
}

function variantId(): string {
  return `lav_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneVariant(variant: LandingAbVariant): LandingAbVariant {
  return { ...variant, config: { ...variant.config } }
}

function cloneExperiment(experiment: LandingAbExperiment): LandingAbExperiment {
  return { ...experiment, variants: experiment.variants.map(cloneVariant) }
}

function visitorHash(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 32)
}

function assignmentKey(experimentIdValue: string, visitorIdValue: string): string {
  return `${experimentIdValue}\0${visitorHash(visitorIdValue)}`
}

/** Valid status transitions. `completed` is terminal and only reachable via `concludeExperiment`. */
const ALLOWED_TRANSITIONS: Record<LandingAbStatus, readonly LandingAbStatus[]> = {
  draft: ["running"],
  running: ["paused", "completed"],
  paused: ["running", "completed"],
  completed: [],
}

function isLandingAbStatus(value: string): value is LandingAbStatus {
  return (LANDING_AB_STATUSES as readonly string[]).includes(value)
}

function isLandingAbEventType(value: string): value is LandingAbEventType {
  return (LANDING_AB_EVENT_TYPES as readonly string[]).includes(value)
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new LandingAbError("invalid", "Experiment name is required.")
  if (trimmed.length > LANDING_AB_MAX_NAME_LENGTH) {
    throw new LandingAbError(
      "invalid",
      `Name must be at most ${LANDING_AB_MAX_NAME_LENGTH} characters.`,
    )
  }
  return trimmed
}

function validateWindow(startAt?: string, endAt?: string): { startAt?: string; endAt?: string } {
  const start = startAt?.trim() || undefined
  const end = endAt?.trim() || undefined
  if (start && Number.isNaN(Date.parse(start))) {
    throw new LandingAbError("invalid", "startAt must be an ISO timestamp.")
  }
  if (end && Number.isNaN(Date.parse(end))) {
    throw new LandingAbError("invalid", "endAt must be an ISO timestamp.")
  }
  if (start && end && Date.parse(start) >= Date.parse(end)) {
    throw new LandingAbError("invalid", "startAt must be before endAt.")
  }
  return { startAt: start, endAt: end }
}

interface VariantInput {
  id?: string
  weight?: number
  config?: LandingAbVariantConfig
}

function normalizeVariants(input: VariantInput[]): LandingAbVariant[] {
  if (input.length < LANDING_AB_MIN_VARIANTS || input.length > LANDING_AB_MAX_VARIANTS) {
    throw new LandingAbError(
      "invalid",
      `An experiment requires ${LANDING_AB_MIN_VARIANTS}-${LANDING_AB_MAX_VARIANTS} variants.`,
    )
  }
  const seen = new Set<string>()
  return input.map((variant) => {
    const id = (variant.id?.trim() || variantId()).slice(0, LANDING_AB_MAX_VARIANT_ID_LENGTH)
    if (seen.has(id)) throw new LandingAbError("invalid", `Duplicate variant id: ${id}.`)
    seen.add(id)
    const weight = variant.weight ?? 1
    if (!Number.isInteger(weight) || weight < 1 || weight > LANDING_AB_MAX_WEIGHT) {
      throw new LandingAbError(
        "invalid",
        `Variant weight must be an integer between 1 and ${LANDING_AB_MAX_WEIGHT}.`,
      )
    }
    const config = normalizeConfig(variant.config)
    return { id, weight, config }
  })
}

function normalizeConfig(config: LandingAbVariantConfig | undefined): LandingAbVariantConfig {
  if (!config) return {}
  const out: LandingAbVariantConfig = {}
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue
    if (key === "showSocialProof" && typeof value === "boolean") {
      out[key] = value
      continue
    }
    if ((key === "headline" || key === "ctaLabel") && typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed.length > LANDING_AB_MAX_CONFIG_STRING_LENGTH) {
        throw new LandingAbError(
          "invalid",
          `${key} must be at most ${LANDING_AB_MAX_CONFIG_STRING_LENGTH} characters.`,
        )
      }
      if (trimmed) out[key] = trimmed
      continue
    }
    // Unknown keys: keep only short scalar values so config stays JSON-safe.
    if (typeof value === "string" && value.length <= LANDING_AB_MAX_CONFIG_STRING_LENGTH) {
      out[key] = value
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export interface CreateLandingExperimentInput {
  name: string
  variants: VariantInput[]
  startAt?: string
  endAt?: string
}

/**
 * Creates a `draft` experiment. Throws `LandingAbError("invalid")` on bad
 * input (the API layer validates with zod first; this is defense in depth
 * for direct callers). When the experiment store is full the oldest record
 * is evicted (Map preserves insertion order).
 */
export function createExperiment(input: CreateLandingExperimentInput): LandingAbExperiment {
  const name = validateName(input.name)
  const window = validateWindow(input.startAt, input.endAt)
  const variants = normalizeVariants(input.variants)

  const experiment: LandingAbExperiment = {
    id: experimentId(),
    name,
    variants,
    status: "draft",
    createdAt: nowIso(),
    ...window,
  }

  if (experiments.size >= LANDING_AB_MAX_EXPERIMENTS) {
    const oldest = experiments.keys().next().value
    if (oldest !== undefined) {
      experiments.delete(oldest)
      evictAssignmentsFor(oldest)
    }
  }
  experiments.set(experiment.id, experiment)
  logger.info(
    {
      event: "landing.ab.created",
      experimentId: experiment.id,
      name,
      variantCount: variants.length,
    },
    "Landing A/B experiment created",
  )
  return cloneExperiment(experiment)
}

/** Returns a snapshot of the experiment, or null when the id is unknown. */
export function getExperiment(id: string): LandingAbExperiment | null {
  const experiment = experiments.get(id)
  return experiment ? cloneExperiment(experiment) : null
}

/**
 * Lists experiments newest-first; `status` filters when provided.
 *
 * `createdAt` has millisecond resolution, so several experiments can share
 * a timestamp. Map values iterate in insertion order; reversing first makes
 * same-ms ties resolve to most-recently-created first. The sort itself is
 * stable, so same-ms ordering stays deterministic (same pattern as
 * `listAffiliates` in `affiliate.ts`).
 */
export function listExperiments(filter?: { status?: LandingAbStatus }): LandingAbExperiment[] {
  return [...experiments.values()]
    .reverse()
    .filter((experiment) => !filter?.status || experiment.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(cloneExperiment)
}

/**
 * Finds the newest `running` experiment with the given surface name
 * (e.g. `"referral-landing"`). Returns null when none is running.
 *
 * Prefer `findExperimentByName` for assignment resolution — this status-
 * filtered variant is kept for callers that specifically need a live test.
 */
export function findRunningExperimentByName(name: string): LandingAbExperiment | null {
  const target = name.trim()
  if (!target) return null
  const match = listExperiments({ status: "running" }).find(
    (experiment) => experiment.name === target,
  )
  return match ?? null
}

/**
 * Finds the NEWEST experiment with the given surface name regardless of
 * status (draft/running/paused/completed). Returns null when no experiment
 * with that name has ever been created. `assignVariant` resolves names
 * through this so a concluded experiment keeps serving its winner and a
 * paused/draft experiment falls back to control instead of auto-starting
 * a new test.
 */
export function findExperimentByName(name: string): LandingAbExperiment | null {
  const target = name.trim()
  if (!target) return null
  const match = listExperiments().find((experiment) => experiment.name === target)
  return match ?? null
}

export interface UpdateLandingExperimentInput {
  name?: string
  variants?: VariantInput[]
  startAt?: string | null
  endAt?: string | null
  /** `"completed"` is rejected here — use `concludeExperiment` instead. */
  status?: LandingAbStatus
}

/**
 * Updates a `draft` experiment's editable fields (name, variants, schedule
 * window) and/or transitions its status along the allowed edges
 * (draft→running, running↔paused). Completed experiments are immutable —
 * use `concludeExperiment`. Returns the updated experiment, or throws
 * `LandingAbError` when the id is unknown, the experiment is completed, or
 * the transition/patch is invalid.
 */
export function updateExperiment(
  id: string,
  patch: UpdateLandingExperimentInput,
): LandingAbExperiment {
  const experiment = experiments.get(id)
  if (!experiment) throw new LandingAbError("not_found", "Experiment not found.")
  if (experiment.status === "completed") {
    throw new LandingAbError("invalid_transition", "Completed experiments are immutable.")
  }

  if (patch.name !== undefined) experiment.name = validateName(patch.name)
  if (patch.variants !== undefined) {
    // Variant edits are only allowed before the experiment starts assigning.
    if (experiment.status !== "draft") {
      throw new LandingAbError(
        "invalid_transition",
        "Variants can only be edited while the experiment is a draft.",
      )
    }
    experiment.variants = normalizeVariants(patch.variants)
  }
  if (patch.startAt !== undefined || patch.endAt !== undefined) {
    const current = { startAt: experiment.startAt, endAt: experiment.endAt }
    const next = validateWindow(
      patch.startAt === undefined ? current.startAt : (patch.startAt ?? undefined),
      patch.endAt === undefined ? current.endAt : (patch.endAt ?? undefined),
    )
    experiment.startAt = next.startAt
    experiment.endAt = next.endAt
  }
  if (patch.status !== undefined) {
    if (!isLandingAbStatus(patch.status) || patch.status === "completed") {
      throw new LandingAbError("invalid", "status must be draft, running, or paused here.")
    }
    if (!ALLOWED_TRANSITIONS[experiment.status].includes(patch.status)) {
      throw new LandingAbError(
        "invalid_transition",
        `Cannot transition from "${experiment.status}" to "${patch.status}".`,
      )
    }
    experiment.status = patch.status
  }
  return cloneExperiment(experiment)
}

/**
 * Completes an experiment from `running` or `paused`. `winnerVariantId`,
 * when provided, must match one of the experiment's variants. After
 * completion `assignVariant` resolves every visitor to the winner.
 */
export function concludeExperiment(id: string, winnerVariantId?: string): LandingAbExperiment {
  const experiment = experiments.get(id)
  if (!experiment) throw new LandingAbError("not_found", "Experiment not found.")
  if (experiment.status !== "running" && experiment.status !== "paused") {
    throw new LandingAbError(
      "invalid_transition",
      `Cannot conclude an experiment in status "${experiment.status}".`,
    )
  }
  if (
    winnerVariantId !== undefined &&
    !experiment.variants.some((variant) => variant.id === winnerVariantId)
  ) {
    throw new LandingAbError(
      "invalid",
      "winnerVariantId must match one of the experiment's variants.",
    )
  }
  experiment.status = "completed"
  experiment.winnerVariantId = winnerVariantId
  experiment.completedAt = nowIso()
  logger.info(
    { event: "landing.ab.completed", experimentId: id, winnerVariantId },
    "Landing A/B experiment completed",
  )
  return cloneExperiment(experiment)
}

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

function withinWindow(experiment: LandingAbExperiment, at: Date): boolean {
  if (experiment.startAt && Date.parse(experiment.startAt) > at.getTime()) return false
  if (experiment.endAt && Date.parse(experiment.endAt) <= at.getTime()) return false
  return true
}

/**
 * Deterministic sticky variant assignment.
 *
 * `selector` is either an experiment id or a surface `name` (e.g.
 * `"referral-landing"`): an exact id match wins; otherwise the NEWEST
 * experiment with that name is used, whatever its status — so a
 * `completed` experiment keeps serving its winner and a newer experiment
 * created after it takes over.
 *
 * Resolution:
 *  - `completed` → the winner variant for every visitor (no new sticky
 *    assignment recorded; events can still be attributed to the winner).
 *  - `running` inside its `startAt`/`endAt` window → hash-bucketed weighted
 *    pick, persisted so the same `visitorId` always gets the same variant.
 *  - `draft`/`paused`, outside the window, or unknown selector → null.
 *
 * The hash is `sha256(experimentId + visitorId)` bucketed over cumulative
 * variant weights; only the visitor id's hash is stored.
 */
export function assignVariant(
  selector: string,
  visitorIdValue: string,
): LandingAbAssignment | null {
  const target = experiments.get(selector) ?? findExperimentByName(selector)
  if (!target) return null

  const visitor = visitorIdValue.trim()
  if (!visitor || visitor.length > LANDING_AB_MAX_VISITOR_ID_LENGTH) return null

  if (target.status === "completed") {
    const winner = target.variants.find((variant) => variant.id === target.winnerVariantId)
    if (!winner) return null
    return { experimentId: target.id, variantId: winner.id, variant: cloneVariant(winner) }
  }
  if (target.status !== "running") return null
  if (!withinWindow(target, new Date())) return null

  const key = assignmentKey(target.id, visitor)
  let variantIdValue = assignments.get(key)
  if (!variantIdValue) {
    const totalWeight = target.variants.reduce((sum, variant) => sum + variant.weight, 0)
    const digest = createHash("sha256").update(`${target.id}${visitor}`).digest()
    let point = digest.readUInt32BE(0) % totalWeight
    variantIdValue = target.variants[target.variants.length - 1].id
    for (const variant of target.variants) {
      if (point < variant.weight) {
        variantIdValue = variant.id
        break
      }
      point -= variant.weight
    }

    // Bounded capacity: evict the oldest assignment (Map preserves insertion
    // order) so a flood of visitors cannot grow memory without limit.
    if (assignments.size >= LANDING_AB_MAX_ASSIGNMENTS) {
      const oldest = assignments.keys().next().value
      if (oldest !== undefined) assignments.delete(oldest)
    }
    assignments.set(key, variantIdValue)
  }

  const variant = target.variants.find((candidate) => candidate.id === variantIdValue)
  if (!variant) return null
  return { experimentId: target.id, variantId: variant.id, variant: cloneVariant(variant) }
}

function evictAssignmentsFor(experimentIdValue: string): void {
  const prefix = `${experimentIdValue}\0`
  for (const key of assignments.keys()) {
    if (key.startsWith(prefix)) assignments.delete(key)
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Records a landing experiment event (`view`, `signup_click`,
 * `cta_click`). `variantId`, when provided, must belong to the experiment.
 * Throws `LandingAbError` on unknown experiment/variant or invalid input.
 * Bounded: when the event log is full the oldest events are dropped.
 */
export function recordEvent(input: {
  experimentId: string
  variantId?: string
  visitorId: string
  type: LandingAbEventType | string
}): LandingAbEvent {
  const experiment = experiments.get(input.experimentId)
  if (!experiment) throw new LandingAbError("not_found", "Experiment not found.")
  if (!isLandingAbEventType(input.type)) {
    throw new LandingAbError(
      "invalid",
      `type must be one of: ${LANDING_AB_EVENT_TYPES.join(", ")}.`,
    )
  }
  const visitor = input.visitorId.trim()
  if (!visitor || visitor.length > LANDING_AB_MAX_VISITOR_ID_LENGTH) {
    throw new LandingAbError("invalid", "visitorId is required and must be reasonably short.")
  }
  if (
    input.variantId !== undefined &&
    !experiment.variants.some((variant) => variant.id === input.variantId)
  ) {
    throw new LandingAbError("invalid", "variantId does not belong to this experiment.")
  }

  const event: LandingAbEvent = {
    experimentId: experiment.id,
    ...(input.variantId ? { variantId: input.variantId } : {}),
    visitorId: visitor,
    type: input.type,
    at: nowIso(),
  }
  events.push(event)
  if (events.length > LANDING_AB_MAX_EVENTS) {
    events.splice(0, events.length - LANDING_AB_MAX_EVENTS)
  }
  return event
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/**
 * Per-variant counts and rates for an experiment. `assigned` counts sticky
 * assignments recorded by `assignVariant`; `views`/`ctaClicks`/
 * `signupClicks` count recorded events attributed to each variant. Events
 * recorded WITHOUT a `variantId` are excluded entirely — they appear in
 * neither the per-variant rows nor `totals`. Rates: `viewRate` =
 * views/assigned, `clickRate` = clicks/views.
 */
export function results(experimentIdValue: string): LandingAbResults | null {
  const experiment = experiments.get(experimentIdValue)
  if (!experiment) return null

  const prefix = `${experiment.id}\0`
  const assignedByVariant = new Map<string, number>()
  let totalAssigned = 0
  for (const [key, variantIdValue] of assignments) {
    if (!key.startsWith(prefix)) continue
    assignedByVariant.set(variantIdValue, (assignedByVariant.get(variantIdValue) ?? 0) + 1)
    totalAssigned += 1
  }

  const viewsByVariant = new Map<string, number>()
  const ctaByVariant = new Map<string, number>()
  const signupByVariant = new Map<string, number>()
  let totalViews = 0
  let totalCta = 0
  let totalSignup = 0
  for (const event of events) {
    if (event.experimentId !== experiment.id || !event.variantId) continue
    if (event.type === "view") {
      viewsByVariant.set(event.variantId, (viewsByVariant.get(event.variantId) ?? 0) + 1)
      totalViews += 1
    } else if (event.type === "cta_click") {
      ctaByVariant.set(event.variantId, (ctaByVariant.get(event.variantId) ?? 0) + 1)
      totalCta += 1
    } else if (event.type === "signup_click") {
      signupByVariant.set(event.variantId, (signupByVariant.get(event.variantId) ?? 0) + 1)
      totalSignup += 1
    }
  }

  const bump = (map: Map<string, number>, id: string) => map.get(id) ?? 0
  const variants: LandingAbVariantResult[] = experiment.variants.map((variant) => {
    const assigned = bump(assignedByVariant, variant.id)
    const views = bump(viewsByVariant, variant.id)
    const ctaClicks = bump(ctaByVariant, variant.id)
    const signupClicks = bump(signupByVariant, variant.id)
    const clicks = ctaClicks + signupClicks
    return {
      variantId: variant.id,
      weight: variant.weight,
      assigned,
      views,
      ctaClicks,
      signupClicks,
      viewRate: assigned > 0 ? views / assigned : 0,
      clickRate: views > 0 ? clicks / views : 0,
    }
  })

  return {
    experimentId: experiment.id,
    status: experiment.status,
    ...(experiment.winnerVariantId ? { winnerVariantId: experiment.winnerVariantId } : {}),
    variants,
    totals: {
      assigned: totalAssigned,
      views: totalViews,
      ctaClicks: totalCta,
      signupClicks: totalSignup,
    },
  }
}

/** Test hook: clears all experiments, assignments, and events. */
export function resetLandingAbForTests(): void {
  experiments.clear()
  assignments.clear()
  events.length = 0
}
