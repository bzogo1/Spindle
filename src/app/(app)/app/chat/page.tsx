import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { ProjectSectionScreen } from "@/components/app/project-section-screen"

export const metadata: Metadata = { title: "Chat" }

export default function ChatPage() {
  return (
    <AppPage
      title="Chat"
      lede="Conversations with your workspace — human collaborators and the agent."
    >
      <ProjectSectionScreen section="chat" />
    </AppPage>
  )
}
