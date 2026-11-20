import type { Metadata } from "next"

import { ProjectAnalyticsScreen } from "@/components/app/project-analytics-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export const metadata: Metadata = { title: "Project analytics" }

export default function ProjectAnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  return (
    <PaneBoundary screen="project">
      {params.then(({ projectId }) => (
        <ProjectAnalyticsScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
