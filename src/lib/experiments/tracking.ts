/**
 * Experiment lifecycle tracking — pure domain module.
 *
 * No I/O, no `process.env`, no React — safe to import from server code,
 * scripts (via tsx), and tests. Persistence lives in the registry JSON
 * managed by `scripts/experiments/track.mjs`; this module owns the record
 * shape, the status-transition rules, and validation.
 *
 * Lifecycle:
 *
 *   draft ──start──▶ running ──conclude──▶ concluded (terminal)
 *     │                │
 *     └──stop──▶ stopped ◀──stop──┘
 *          │
 *          └──resume──▶ running
 *
 * `concluded` is terminal: a concluded experiment can never re-open. A
 * `stopped` experiment may resume into `running`. Transitions into
 * `concluded` require a conclusion (result + summary) so results are always
 * recorded at decision time — see `docs/experiments/tracking.md`.
 */

export type ExperimentStatus = "draft" | "running" | "concluded" | "stopped"

export type ExperimentResult = "win" | "loss" | "inconclusive"

export interface ExperimentVariant {
  /** Stable variant key, e.g. "control" / "treatment". */
  name: string
  /**
   * Relative traffic weight within the experiment. Weights are normalized
   * at analysis time, so `50`/`50` and `1`/`1` are equivalent. Optional —
   * omit for an even split.
   */
  weight?: number
  description?: string
}

/**
 * A pointer to a measured metric. `name` should match the metric id used in
 * the analytics/metrics pipeline (see docs/experiments/tracking.md); `link`
 * can point at a dashboard or report for drill-down.
 */
export interface ExperimentMetric {
  name: string
  value?: string | number
  link?: string
}

export interface ExperimentConclusion {
  result: ExperimentResult
  /** One-paragraph summary of what was learned and why this result. */
  summary: string
  /** ISO-8601 timestamp of the decision. */
  decidedAt: string
  /** Metrics that drove the decision, for later analysis linkage. */
  metrics?: ExperimentMetric[]
}

export interface ExperimentRecord {
  /** Stable slug id, e.g. "checkout-button-copy". Drives filenames/links. */
  id: string
  /** The falsifiable claim being tested. Required even in draft. */
  hypothesis: string
  variants: ExperimentVariant[]
  status: ExperimentStatus
  /** Person/team accountable for the experiment. Free-form string. */
  owner: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
  startedAt?: string
  concludedAt?: string
  stoppedAt?: string
  /** Required once status is "concluded". */
  conclusion?: ExperimentConclusion
}

// --- transitions ------------------------------------------------------------

/**
 * Allowed status transitions. MUST stay in sync with the copy in
 * `scripts/experiments/track.mjs` — the CLI cannot import this TS module
 * directly, so both encode the same table.
 */
export const EXPERIMENT_TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ["running", "stopped"],
  running: ["concluded", "stopped"],
  stopped: ["running"],
  concluded: [],
}

export class ExperimentTransitionError extends Error {
  constructor(
    public readonly from: ExperimentStatus,
    public readonly to: ExperimentStatus,
  ) {
    super(
      `Invalid experiment transition: ${from} -> ${to}. ` +
        `Allowed from ${from}: ${EXPERIMENT_TRANSITIONS[from].join(", ") || "(none — terminal)"}.`,
    )
    this.name = "ExperimentTransitionError"
  }
}

export function isValidTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return EXPERIMENT_TRANSITIONS[from].includes(to)
}

// --- validation -------------------------------------------------------------

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const RESULTS: readonly ExperimentResult[] = ["win", "loss", "inconclusive"]

/** Slug rules shared by the CLI (`--id`) and any UI that creates records. */
export function isValidExperimentId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value)
}

/**
 * Returns a list of human-readable problems; empty means the record is
 * well-formed. Pure — never throws, so callers (CLI, tests, importers) can
 * collect every issue at once.
 */
export function validateExperiment(experiment: unknown): string[] {
  const errors: string[] = []
  if (typeof experiment !== "object" || experiment === null) {
    return ["experiment must be an object"]
  }
  const e = experiment as Partial<ExperimentRecord>

  if (!isNonEmptyString(e.id) || !isValidExperimentId(e.id)) {
    errors.push(`id must be a lowercase slug matching ${ID_PATTERN} (got ${JSON.stringify(e.id)})`)
  }
  if (!isNonEmptyString(e.hypothesis)) {
    errors.push("hypothesis is required and must be non-empty")
  }
  if (!isNonEmptyString(e.owner)) {
    errors.push("owner is required and must be non-empty")
  }
  if (!isValidIsoDate(e.createdAt)) {
    errors.push("createdAt must be an ISO-8601 timestamp")
  }

  const statuses: readonly string[] = ["draft", "running", "concluded", "stopped"]
  if (typeof e.status !== "string" || !statuses.includes(e.status)) {
    errors.push(`status must be one of: ${statuses.join(", ")}`)
  }

  if (!Array.isArray(e.variants) || e.variants.length === 0) {
    errors.push("variants must be a non-empty array")
  } else {
    const seen = new Set<string>()
    e.variants.forEach((v, i) => {
      const variant = v as Partial<ExperimentVariant> | null
      if (typeof variant !== "object" || variant === null || !isNonEmptyString(variant.name)) {
        errors.push(`variants[${i}].name is required`)
        return
      }
      if (seen.has(variant.name)) {
        errors.push(`duplicate variant name: ${variant.name}`)
      }
      seen.add(variant.name)
      if (
        variant.weight !== undefined &&
        (typeof variant.weight !== "number" ||
          !Number.isFinite(variant.weight) ||
          variant.weight <= 0)
      ) {
        errors.push(`variants[${i}].weight must be a positive number`)
      }
    })
    if (e.variants.length === 1) {
      errors.push("an experiment needs at least 2 variants (e.g. control + treatment)")
    }
  }

  if (e.status === "running" && !isValidIsoDate(e.startedAt)) {
    errors.push("startedAt is required once status is running")
  }
  if (e.status === "concluded") {
    if (!isValidIsoDate(e.concludedAt)) {
      errors.push("concludedAt is required once status is concluded")
    }
    const c = e.conclusion as Partial<ExperimentConclusion> | undefined
    if (
      typeof c !== "object" ||
      c === null ||
      !RESULTS.includes(c.result as ExperimentResult) ||
      !isNonEmptyString(c.summary) ||
      !isValidIsoDate(c.decidedAt)
    ) {
      errors.push(
        "conclusion is required once status is concluded and must have result (win|loss|inconclusive), summary, and decidedAt",
      )
    }
  }
  if (e.status === "stopped" && !isValidIsoDate(e.stoppedAt)) {
    errors.push("stoppedAt is required once status is stopped")
  }

  return errors
}

// --- construction / transitions ----------------------------------------------

export interface CreateExperimentInput {
  id: string
  hypothesis: string
  owner: string
  /** Variant names, or `{ name, weight?, description? }` objects. */
  variants: Array<string | ExperimentVariant>
}

/** Normalize shorthand variant specs ("name" or "name:weight") into records. */
export function normalizeVariant(input: string | ExperimentVariant): ExperimentVariant {
  if (typeof input !== "string") return { ...input }
  const [name, weight] = input.split(":")
  const variant: ExperimentVariant = { name: name.trim() }
  if (weight !== undefined) {
    const parsed = Number(weight)
    if (Number.isFinite(parsed)) variant.weight = parsed
  }
  return variant
}

/**
 * Build a new draft experiment. Throws `Error` with all validation problems
 * if the input is unusable — drafts still need an id, hypothesis, owner, and
 * at least two variants so they are reviewable before launch.
 */
export function createExperiment(
  input: CreateExperimentInput,
  now: Date = new Date(),
): ExperimentRecord {
  const record: ExperimentRecord = {
    id: input.id,
    hypothesis: input.hypothesis,
    owner: input.owner,
    variants: input.variants.map(normalizeVariant),
    status: "draft",
    createdAt: now.toISOString(),
  }
  const errors = validateExperiment(record)
  if (errors.length > 0) {
    throw new Error(`Invalid experiment: ${errors.join("; ")}`)
  }
  return record
}

export interface TransitionOptions {
  /** Override "now" for deterministic tests. */
  now?: Date
  /**
   * Required when `to` is "concluded" — the decision record. Ignored for
   * other targets.
   */
  conclusion?: ExperimentConclusion
}

/**
 * Return a new record in the target status, stamping the relevant timestamp.
 * Does not mutate the input. Throws `ExperimentTransitionError` for illegal
 * moves and `Error` if the resulting record would be invalid (e.g. concluding
 * without a conclusion).
 */
export function transitionExperiment(
  experiment: ExperimentRecord,
  to: ExperimentStatus,
  options: TransitionOptions = {},
): ExperimentRecord {
  if (!isValidTransition(experiment.status, to)) {
    throw new ExperimentTransitionError(experiment.status, to)
  }
  const now = (options.now ?? new Date()).toISOString()
  const next: ExperimentRecord = { ...experiment, status: to }
  delete next.conclusion

  if (to === "running") next.startedAt = now
  if (to === "concluded") {
    if (!options.conclusion) {
      throw new Error("concluding an experiment requires a conclusion (result, summary, decidedAt)")
    }
    next.conclusion = options.conclusion
    next.concludedAt = now
  }
  if (to === "stopped") {
    next.stoppedAt = now
    // Keep any prior conclusion? No — a stopped experiment has no decision.
    delete next.conclusion
  }
  // Resuming a stopped experiment clears the stop marker.
  if (to === "running" && experiment.status === "stopped") {
    delete next.stoppedAt
  }

  const errors = validateExperiment(next)
  if (errors.length > 0) {
    throw new Error(`Invalid transition ${experiment.status} -> ${to}: ${errors.join("; ")}`)
  }
  return next
}
