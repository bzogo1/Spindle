import type { Metadata } from "next"

import { AgentRunDetailScreen } from "@/components/app/agent-run-detail-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export const metadata: Metadata = { title: "Agent run" }

export default function AppAgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  return (
    <PaneBoundary screen="agent">
      {params.then(({ runId }) => (
        <AgentRunDetailScreen runId={runId} />
      ))}
    </PaneBoundary>
  )
}
