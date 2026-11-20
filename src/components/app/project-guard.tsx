"use client"

import { notFound } from "next/navigation"

import { ErrorState } from "@/components/app/states/error-state"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"
import { useProjectHome } from "@/lib/api"

/**
 * Resolves the project for every `/projects/[projectId]/*` route before the
 * nested screen renders. An absent project calls `notFound()` so the group's
 * authenticated 404 renders instead of a screen built from seed data; other
 * failures keep the in-place retry. The project tabs stay outside this
 * boundary and remain usable.
 */
export function ProjectGuard({
  projectId,
  children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  const query = useProjectHome(projectId)

  if (query.status === "loading") {
    return (
      <LoadingPanel label="Loading project" className="min-h-48">
        <ScreenSkeleton variant="project" />
      </LoadingPanel>
    )
  }

  if (query.status === "error") {
    if (query.error?.status === 404) notFound()

    return (
      <ErrorState
        title="Project did not load"
        message="We could not load this project. Try again to refresh its details and tabs."
        error={query.error}
        onRetry={query.refetch}
        isRetrying={query.isRetrying}
        className="mt-6"
      />
    )
  }

  return <>{children}</>
}
