/**
 * Chat → notifications bridge.
 *
 * Pure helpers that decide whether an incoming channel message should raise
 * an app notification and how to shape the payload. The diffing/polling lives
 * in `useChatWorkspace` (`./workspace-hooks`), which pushes the result through
 * `pushAppNotification` — this module stays free of React and the DOM so it
 * can be unit-tested directly.
 *
 * Scope: only messages authored by someone else qualify, and only when they
 * either @mention the current user or reply to one of the current user's
 * messages. Everything else (own echoes, presence drift, typing entries,
 * reactions) stays out of the notification feed.
 */

import { CURRENT_USER } from "../mock/store"
import type { ChannelMessage, ChatChannel } from "./types"

export type ChatNotificationKind = "mention" | "reply"

/**
 * Classify an incoming message for notification delivery. Returns `null`
 * when the message should stay silent: own messages, anything not fully
 * `sent` yet (a "sending" message may still settle), and messages that
 * neither mention the current user nor reply to one of their messages.
 *
 * A mention wins over a reply when both apply — the mention is the stronger
 * signal and produces a single feed item.
 */
export function chatNotificationKind(
  message: ChannelMessage,
  messages: readonly ChannelMessage[],
  currentUserId: string = CURRENT_USER.id,
): ChatNotificationKind | null {
  if (message.status !== "sent" || message.authorId === currentUserId) return null
  if (message.mentions?.some((mention) => mention.id === currentUserId)) return "mention"
  const parent = message.replyToId
    ? messages.find((candidate) => candidate.id === message.replyToId)
    : undefined
  if (parent?.authorId === currentUserId) return "reply"
  return null
}

/** One-line excerpt for the notification body; mirrors the chat screen's snippet. */
export function chatNotificationSnippet(message: ChannelMessage) {
  const body = message.body.trim()
  if (body) return body.length > 90 ? `${body.slice(0, 90)}…` : body
  const attachment = message.attachments?.[0]?.name
  return attachment ? `Attachment: ${attachment}` : "Message"
}

/**
 * Build the `pushAppNotification` payload for a qualifying message. The id is
 * deterministic per message so poll replays, hook remounts, and cross-tab
 * echoes dedupe to a single feed item. `channel` may be undefined when the
 * channel was deleted between polls — the raw channel id is used then.
 */
export function chatNotificationInput(
  message: ChannelMessage,
  kind: ChatNotificationKind,
  channel: ChatChannel | undefined,
  projectId: string,
) {
  const channelName = channel?.name ?? message.channelId
  return {
    id: `chat_${kind}_${message.id}`,
    type: "info" as const,
    title:
      kind === "mention"
        ? `${message.authorName} mentioned you in #${channelName}`
        : `${message.authorName} replied to your message in #${channelName}`,
    body: chatNotificationSnippet(message),
    href: `/projects/${projectId}/chat`,
    category: kind === "mention" ? ("mentions" as const) : ("activity" as const),
    projectId,
  }
}
