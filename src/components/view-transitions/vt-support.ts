/**
 * Feature detection and naming helpers for the View Transitions integration.
 *
 * Next.js 16 + React 19.3 drive view transitions through React's
 * `<ViewTransition>` component: route navigations are already React
 * transitions, so no manual `document.startViewTransition()` call is needed.
 * These helpers exist so call sites can degrade explicitly and so the
 * detection logic is unit-testable without a DOM.
 */

/** Minimal structural view of the browser APIs we probe. */
export interface ViewTransitionEnvironment {
  /** `document.startViewTransition` — the imperative entry point. */
  startViewTransition?: unknown
  /** `CSS.supports("view-transition-name", ...)` probe result. */
  supportsViewTransitionName?: boolean
}

function readEnvironment(): ViewTransitionEnvironment {
  if (typeof document === "undefined") return {}
  const css = typeof CSS !== "undefined" ? CSS : undefined
  return {
    startViewTransition: typeof document !== "undefined" ? document.startViewTransition : undefined,
    supportsViewTransitionName: css?.supports
      ? css.supports("view-transition-name", "none")
      : false,
  }
}

/**
 * Returns true when the browser can run view transitions. Pass an explicit
 * `env` in tests; the default reads `document`/`CSS` when available.
 *
 * React's `<ViewTransition>` already no-ops in unsupported browsers, so this
 * is used to skip extra work (and to keep tests honest) rather than as the
 * sole guard.
 */
export function canUseViewTransitions(env: ViewTransitionEnvironment = readEnvironment()): boolean {
  return typeof env.startViewTransition === "function" && env.supportsViewTransitionName === true
}

const NAME_SAFE = /[^a-zA-Z0-9_-]+/g

/**
 * Builds a `view-transition-name` for a shared element. The same (scope, id)
 * pair must be used on both the origin and destination page for the morph to
 * pair up — e.g. `viewTransitionName("project", project.id)` on the project
 * card and on the project header.
 *
 * Names only need to be unique within a single rendered page; prefixing with
 * the scope avoids collisions between different entity types.
 */
export function viewTransitionName(scope: string, id: string): string {
  const safeScope = scope.replace(NAME_SAFE, "-")
  const safeId = id.replace(NAME_SAFE, "-")
  return `spindle-${safeScope}-${safeId}`
}

/** Directional transition types understood by `PageTransition`. */
export const NAV_FORWARD = "nav-forward"
export const NAV_BACK = "nav-back"
