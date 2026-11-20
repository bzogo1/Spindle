export { evaluateRollout, registerRolloutStrategy, rolloutStrategies } from "./registry"
export type { RolloutPlan, RolloutResult, RolloutStep, RolloutStepResult } from "./registry"

export { hashBucket, inCohort, resolveCohortIdentity } from "./hash"

export { linearPercentAt, linearStrategy } from "./linear"
export type { LinearConfig } from "./linear"

export { percentageStrategy } from "./percentage"
export type { PercentageConfig } from "./percentage"

export { scheduleStrategy } from "./schedule"
export type { ScheduleConfig, ScheduleWindow } from "./schedule"

export { segmentStrategy } from "./segment"
export type { SegmentConfig } from "./segment"

export { killSwitchStrategy } from "./kill-switch"
export type { KillSwitchConfig } from "./kill-switch"

export type {
  EvaluationContext,
  FlagAttributeValue,
  StrategyFn,
  StrategyOutcome,
  Verdict,
} from "./types"
