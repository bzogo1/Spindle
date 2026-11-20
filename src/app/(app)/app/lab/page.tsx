import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { ProjectSectionScreen } from "@/components/app/project-section-screen"

export const metadata: Metadata = { title: "Lab" }

export default function AppLabPage() {
  return (
    <AppPage title="Lab" lede="Notebooks, scripts, and live computations for the selected project.">
      <ProjectSectionScreen section="lab" />
    </AppPage>
  )
}
