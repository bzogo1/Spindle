import { AgentScreen } from "@/components/app/agent-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export default function ProjectAgentPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <PaneBoundary screen="agent">
      {params.then(({ projectId }) => (
        <AgentScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
