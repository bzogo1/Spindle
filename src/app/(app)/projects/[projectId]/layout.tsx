import { MockStoreProvider } from "@/components/app/mock-store-provider"
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
    <MockStoreProvider projectId={projectId}>
      <ProjectTabs projectId={projectId} />
      {children}
    </MockStoreProvider>
  )
}
