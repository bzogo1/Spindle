"use client"

import { ErrorState } from "@/components/app/states/error-state"
import { useErrorReference } from "@/components/site/use-error-reference"

/**
 * Route-level boundary for the authenticated area. The shell (sidebar, header,
 * session provider) lives in the layout above this file, so a render error in
 * one app screen keeps the navigation usable instead of blanking the page.
 *
 * `useErrorReference` reports the error to Sentry once per error instance and
 * returns the event id or the server digest for support lookups; the error
 * message itself is never shown.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { reference } = useErrorReference(error)

  return (
    <div className="app-page">
      <ErrorState
        title="This screen did not load"
        message="Something failed while rendering this screen. The rest of the app is still available — try again, or go back to the dashboard."
        referenceId={reference}
        onRetry={() => retry()}
      />
    </div>
  )
}
