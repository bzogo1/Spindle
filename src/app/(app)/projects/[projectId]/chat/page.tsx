import { ChatScreen } from "@/components/app/chat-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export default function ProjectChatPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <PaneBoundary screen="chat">
      {params.then(({ projectId }) => (
        <ChatScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
