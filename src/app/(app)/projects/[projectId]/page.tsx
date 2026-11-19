import type { Metadata } from "next"

import { ProjectHomeScreen } from "@/components/app/project-home-screen"

export const metadata: Metadata = { title: "Project" }

export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectHomeScreen projectId={projectId} />
}
