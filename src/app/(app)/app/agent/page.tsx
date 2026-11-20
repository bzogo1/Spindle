import type { Metadata } from "next"

import { AgentRunLogScreen } from "@/components/app/agent-run-log-screen"

export const metadata: Metadata = { title: "Agent" }

export default function AppAgentPage() {
  return <AgentRunLogScreen />
}
