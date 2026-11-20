import type { Metadata } from "next"

import { ProjectActivityScreen } from "@/components/app/project-activity-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export const metadata: Metadata = { title: "Project activity" }

export default function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  return (
    <PaneBoundary screen="project">
      {params.then(({ projectId }) => (
        <ProjectActivityScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
