import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { ProjectSectionScreen } from "@/components/app/project-section-screen"

export const metadata: Metadata = { title: "Files" }

export default function FilesPage() {
  return (
    <AppPage
      title="Files"
      lede="The workspace file library — uploads, folders, and previews across projects."
    >
      <ProjectSectionScreen section="files" />
    </AppPage>
  )
}
