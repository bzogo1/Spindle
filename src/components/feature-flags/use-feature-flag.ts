"use client"

import { useContext, useEffect, useState } from "react"

import { clientEnv } from "@/lib/env"
import { evaluateFlagByName } from "@/lib/feature-flags/evaluate"
import type { FlagName } from "@/lib/feature-flags/flags"

import { FeatureFlagsContext, getAnonymousSubjectId } from "./feature-flags-provider"

/**
 * React hook for a registered feature flag.
 *
 * SSR and the first client render evaluate without a subject id so server and
 * client markup agree; after mount the hook re-evaluates with the real subject
 * (provider `subjectId`, or a persisted anonymous id), which can flip
 * percentage-rollout flags once — render rollout-gated UI so a late flip is
 * acceptable, or resolve the flag on the server and pass it as a prop.
 *
 * Wrap the tree in `<FeatureFlagsProvider>` to supply a user id, a custom
 * environment name, or explicit overrides.
 */
export function useFeatureFlag(name: FlagName | (string & {})): boolean {
  const context = useContext(FeatureFlagsContext)
  const environment = context?.environment ?? clientEnv.NODE_ENV
  const overrides = context?.overrides

  const [enabled, setEnabled] = useState(() =>
    evaluateFlagByName(name, { environment, subjectId: "", overrides }),
  )

  useEffect(() => {
    const subjectId = context?.subjectId || getAnonymousSubjectId()
    setEnabled(evaluateFlagByName(name, { environment, subjectId, overrides }))
  }, [name, environment, context?.subjectId, overrides])

  return enabled
}
