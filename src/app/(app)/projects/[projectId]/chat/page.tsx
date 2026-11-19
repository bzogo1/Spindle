import { ChatScreen } from "@/components/app/chat-screen"

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ChatScreen projectId={projectId} />
}
