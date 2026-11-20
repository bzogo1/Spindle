import type { FlagDefinition } from "./types"

/**
 * The feature flag registry.
 *
 * Every flag the product knows about is declared here with a stable `name`,
 * a human-readable `description`, and per-environment `defaults`. Add new
 * flags to this object — `FlagName` stays in sync automatically, so
 * `useFeatureFlag`/`getFeatureFlag` reject unknown names at compile time.
 *
 * Resolution order (see `evaluate.ts`):
 *   1. `FEATURE_FLAG_<NAME>` environment override
 *   2. `defaults[environment]`
 *   3. `defaults.fallback`
 */
export const featureFlags = {
  "new-dashboard": {
    name: "new-dashboard",
    description:
      "Experimental dashboard shell. On in development and test, off elsewhere until rollout is approved.",
    defaults: {
      fallback: false,
      development: true,
      test: true,
    },
  },
  "realtime-collab": {
    name: "realtime-collab",
    description:
      "Live collaborative editing presence. Rolled out to a deterministic 25% of subjects in production.",
    defaults: {
      fallback: false,
      development: true,
      test: true,
      production: { percentage: 25 },
    },
  },
  "docs-search-v2": {
    name: "docs-search-v2",
    description:
      "New docs search index. Off everywhere until the indexer ships; enable per environment with FEATURE_FLAG_DOCS_SEARCH_V2=on.",
    defaults: {
      fallback: false,
    },
  },
} as const satisfies Record<string, FlagDefinition>

export type FlagName = keyof typeof featureFlags

/** Looks up a flag definition by name. Returns undefined for unknown names. */
export function getFlagDefinition(name: string): FlagDefinition | undefined {
  return (featureFlags as Record<string, FlagDefinition>)[name]
}

export function listFlagNames(): FlagName[] {
  return Object.keys(featureFlags) as FlagName[]
}
