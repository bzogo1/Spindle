import type { Metadata } from "next"

import { ProjectHomeScreen } from "@/components/app/project-home-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata: Metadata = { title: "Project" }

export default function ProjectHomePage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <PaneBoundary screen="project">
      {params.then(({ projectId }) => (
        <PageTransition>
          <ProjectHomeScreen projectId={projectId} />
        </PageTransition>
      ))}
    </PaneBoundary>
  )
}
