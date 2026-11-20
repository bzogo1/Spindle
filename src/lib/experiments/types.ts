/**
 * A/B experiment types.
 *
 * An experiment assigns each subject (user id, session id, anonymous id) to
 * exactly one variant — or to no variant when the subject is outside the
 * enrolled traffic, the experiment is not running, or the variant weights
 * leave a remainder. Assignment is deterministic: the same
 * (experiment, subjectId, salt) always produces the same variant, so server
 * and client renders agree and results stay consistent across deploys.
 *
 * See `assign.ts` for resolution and `docs/experiments/framework.md` for the
 * operator workflow.
 */

/**
 * One arm of an experiment. `weight` is a percentage of enrolled subjects
 * (0–100). Weights across all variants should sum to ≤ 100; any remainder
 * is the implicit "unassigned" bucket (subjects stay enrolled/exposed but
 * receive `variant: null` — typically treated as control).
 */
export interface ExperimentVariant {
  /** Stable variant label, e.g. "control" | "treatment". */
  name: string
  /** Share of enrolled subjects, in percent. */
  weight: number
}

/**
 * Lifecycle of an experiment:
 * - `draft`   — defined but not collecting data; everyone is unassigned.
 * - `running` — actively assigning and recording exposures.
 * - `stopped` — concluded; everyone resolves to `variant: null` (control).
 *               Keep the definition in the registry so historical events
 *               remain interpretable.
 */
export type ExperimentStatus = "draft" | "running" | "stopped"

export interface ExperimentDefinition {
  /** Stable identifier, e.g. `"checkout-button-copy"`. */
  name: string
  /** Why the experiment exists and what decision it informs. */
  description: string
  /** Variant arms with percentage weights (see `ExperimentVariant`). */
  variants: ExperimentVariant[]
  /**
   * Percentage of eligible subjects enrolled in the experiment (0–100,
   * default 100). Non-enrolled subjects get `variant: null` and should not
   * be exposed — this is the standard "holdout" mechanism.
   */
  traffic?: number
  /** Lifecycle state. Defaults to `"running"`. */
  status?: ExperimentStatus
  /**
   * Optional ISO-8601 window. Outside `[startDate, endDate)` the experiment
   * assigns nobody, regardless of `status`.
   */
  startDate?: string
  endDate?: string
  /**
   * Extra salt mixed into the assignment hash. Use when the same subject
   * population must be re-randomised for a follow-up experiment, or to
   * decorrelate from another experiment on the same key.
   */
  salt?: string
  /** Metric the experiment is judged on (documentation/analysis hint). */
  primaryMetric?: string
}

/** Why an assignment resolved the way it did — surfaced in logs and tests. */
export type AssignmentReason =
  "assigned" | "unassigned-variant" | "not-enrolled" | "not-running" | "outside-window"

export interface ExperimentAssignment {
  experiment: string
  subjectId: string
  /**
   * Assigned variant name, or `null` when the subject gets no treatment
   * (not enrolled, experiment inactive, outside window, or fell into the
   * weight remainder). `null` is the control-equivalent.
   */
  variant: string | null
  /** Deterministic enrollment bucket in `[0, 10000)` (0.01% resolution). */
  bucket: number
  /** Whether the subject is inside the enrolled traffic. */
  enrolled: boolean
  reason: AssignmentReason
}
