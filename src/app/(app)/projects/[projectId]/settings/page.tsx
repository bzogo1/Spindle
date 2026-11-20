import type { Metadata } from "next"

import { ProjectSettingsScreen } from "@/components/app/project-settings-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export const metadata: Metadata = { title: "Project settings" }

export default function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  return (
    <PaneBoundary screen="project">
      {params.then(({ projectId }) => (
        <ProjectSettingsScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
