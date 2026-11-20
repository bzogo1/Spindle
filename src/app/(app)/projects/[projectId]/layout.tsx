import { ProjectGuard } from "@/components/app/project-guard"
import { ProjectTabs } from "@/components/app/project-tabs"

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return (
    <>
      <ProjectTabs projectId={projectId} />
      <ProjectGuard projectId={projectId}>{children}</ProjectGuard>
    </>
  )
}
