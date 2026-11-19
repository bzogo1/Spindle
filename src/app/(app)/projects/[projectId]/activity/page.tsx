import type { Metadata } from "next"

import { ProjectActivityScreen } from "@/components/app/project-activity-screen"

export const metadata: Metadata = { title: "Project activity" }

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectActivityScreen projectId={projectId} />
}
