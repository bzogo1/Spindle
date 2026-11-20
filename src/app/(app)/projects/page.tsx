import type { Metadata } from "next"

import { ProjectsScreen } from "@/components/app/projects-screen"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata: Metadata = { title: "Projects" }

export default function ProjectsPage() {
  // PageTransition maps `nav-forward`/`nav-back` Link transition types to
  // directional slides; it must live in page.tsx, not the layout.
  return (
    <PageTransition>
      <ProjectsScreen />
    </PageTransition>
  )
}
