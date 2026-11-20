import type { ExperimentDefinition, ExperimentStatus } from "./types"

/**
 * The experiment registry.
 *
 * Every experiment the product knows about is declared here (or built via
 * `defineExperiment()` for validation). Assignment is pure and registry-free
 * — `assignVariant()` takes a definition directly — so tests and previews
 * can construct experiments inline without polluting the registry.
 *
 * Lifecycle: set `status: "draft"` while building, `"running"` to collect
 * data, `"stopped"` to conclude. A stopped experiment keeps assigning
 * `variant: null` so old code paths stay safe; remove the definition only
 * after the tracking pipeline no longer needs it.
 */

const STATUSES: readonly ExperimentStatus[] = ["draft", "running", "stopped"]
const MAX_NAME_LENGTH = 128
const MAX_VARIANTS = 16

/** Validates and returns an experiment definition. Throws on invalid input. */
export function defineExperiment(definition: ExperimentDefinition): ExperimentDefinition {
  const { name, variants } = definition

  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid experiment name ${JSON.stringify(name)}: must be 1–${MAX_NAME_LENGTH} characters`,
    )
  }
  if (typeof definition.description !== "string" || definition.description.trim().length === 0) {
    throw new Error(`Experiment "${name}": description is required`)
  }
  if (!Array.isArray(variants) || variants.length === 0 || variants.length > MAX_VARIANTS) {
    throw new Error(`Experiment "${name}": variants must contain 1–${MAX_VARIANTS} entries`)
  }

  const seen = new Set<string>()
  let totalWeight = 0
  for (const variant of variants) {
    if (typeof variant?.name !== "string" || variant.name.trim().length === 0) {
      throw new Error(`Experiment "${name}": every variant needs a non-empty name`)
    }
    if (seen.has(variant.name)) {
      throw new Error(`Experiment "${name}": duplicate variant name "${variant.name}"`)
    }
    seen.add(variant.name)
    if (!Number.isFinite(variant.weight) || variant.weight < 0 || variant.weight > 100) {
      throw new Error(
        `Experiment "${name}": variant "${variant.name}" weight must be 0–100, got ${variant.weight}`,
      )
    }
    totalWeight += variant.weight
  }
  if (totalWeight > 100) {
    throw new Error(`Experiment "${name}": variant weights sum to ${totalWeight} (> 100)`)
  }

  const traffic = definition.traffic ?? 100
  if (!Number.isFinite(traffic) || traffic < 0 || traffic > 100) {
    throw new Error(`Experiment "${name}": traffic must be 0–100, got ${traffic}`)
  }

  const status = definition.status ?? "running"
  if (!STATUSES.includes(status)) {
    throw new Error(
      `Experiment "${name}": status must be one of ${STATUSES.join(", ")}, got ${JSON.stringify(status)}`,
    )
  }

  return { ...definition, status }
}

/**
 * Registered experiments. Add entries with `defineExperiment({...})` so
 * invalid definitions fail at module load.
 */
export const experiments = {} as const satisfies Record<string, ExperimentDefinition>

export type ExperimentName = keyof typeof experiments

/** Looks up a registered experiment by name. Undefined for unknown names. */
export function getExperimentDefinition(name: string): ExperimentDefinition | undefined {
  return (experiments as Record<string, ExperimentDefinition>)[name]
}

export function listExperimentNames(): ExperimentName[] {
  return Object.keys(experiments) as ExperimentName[]
}
