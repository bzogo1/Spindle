import { AgentScreen } from "@/components/app/agent-screen"

export default async function ProjectAgentPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <AgentScreen projectId={projectId} />
}
