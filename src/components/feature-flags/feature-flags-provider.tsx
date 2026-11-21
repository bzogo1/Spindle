"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

import { clientEnv } from "@/lib/env"

/**
 * Client-side feature flag context.
 *
 * The provider supplies what the browser cannot know on its own: an explicit
 * subject id (e.g. the signed-in user id), a deployment environment name, and
 * optional `FEATURE_FLAG_*` overrides. Without a provider, `useFeatureFlag`
 * evaluates against `clientEnv.NODE_ENV`, a lazily created anonymous id, and
 * no overrides.
 *
 * Env overrides are a server-side mechanism (see docs/feature-flags): the
 * browser cannot enumerate `process.env`. Pass them explicitly via `overrides`
 * when a client-evaluated flag must honor them, or evaluate the flag on the
 * server with `getFeatureFlag()` and pass the boolean down as a prop.
 */

export type FeatureFlagsContextValue = {
  /**
   * Stable subject id for percentage rollouts. When empty, the hook falls
   * back to a random anonymous id persisted in localStorage.
   */
  subjectId: string
  /** Environment name matched against `defaults[environment]`. */
  environment: string
  /** Raw `FEATURE_FLAG_*` overrides keyed by env var name. */
  overrides?: Record<string, string | undefined>
}

export const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null)

export const ANONYMOUS_SUBJECT_STORAGE_KEY = "spindle_ff_subject"

let cachedAnonymousSubjectId: string | null = null

/**
 * Returns a random, persistent anonymous subject id for percentage rollouts.
 * Stored in localStorage under `spindle_ff_subject`; returns a random value
 * (not persisted) when storage is unavailable, e.g. Safari private mode.
 */
export function getAnonymousSubjectId(): string {
  if (cachedAnonymousSubjectId) return cachedAnonymousSubjectId

  const generate = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  let id: string | null
  try {
    id = window.localStorage.getItem(ANONYMOUS_SUBJECT_STORAGE_KEY)
    if (!id) {
      id = generate()
      window.localStorage.setItem(ANONYMOUS_SUBJECT_STORAGE_KEY, id)
    }
  } catch {
    id = generate()
  }

  cachedAnonymousSubjectId = id
  return id
}

export function FeatureFlagsProvider({
  children,
  subjectId = "",
  environment = clientEnv.NODE_ENV,
  overrides,
}: {
  children: ReactNode
  subjectId?: string
  environment?: string
  overrides?: Record<string, string | undefined>
}) {
  const value = useMemo<FeatureFlagsContextValue>(
    () => ({ subjectId, environment, overrides }),
    [subjectId, environment, overrides],
  )

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
}

export function useFeatureFlagsContext(): FeatureFlagsContextValue | null {
  return useContext(FeatureFlagsContext)
}
