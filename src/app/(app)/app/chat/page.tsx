import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"

export const metadata: Metadata = { title: "Chat" }

export default function ChatPage() {
  return (
    <AppPage
      title="Chat"
      lede="Conversations with your workspace — human collaborators and the agent."
    >
      <div className="app-page-card">
        <h2>No conversations yet</h2>
        <p>Chat is a routing placeholder in the mock shell.</p>
      </div>
    </AppPage>
  )
}
