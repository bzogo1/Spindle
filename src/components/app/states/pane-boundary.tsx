import { Suspense, type ReactNode } from "react"

import { appScreenCopy, type AppScreenKey } from "./copy"
import { LoadingPanel } from "./loading-panel"
import { ScreenSkeleton } from "./skeleton"

/**
 * Suspense boundary for one authenticated content pane.
 *
 * Route pages render the awaited `params` promise into this boundary, so the
 * app shell and project tabs stay usable while the pane resolves. The fallback
 * matches the pane's final layout to avoid a shift when the content swaps in.
 */
export function PaneBoundary({ screen, children }: { screen: AppScreenKey; children: ReactNode }) {
  const copy = appScreenCopy[screen]

  return (
    <Suspense
      fallback={
        <LoadingPanel label={copy.loadingLabel} className="min-h-48">
          <ScreenSkeleton variant={copy.skeleton} />
        </LoadingPanel>
      }
    >
      {children}
    </Suspense>
  )
}
