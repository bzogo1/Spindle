"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, KeyboardEvent } from "react"
import {
  Bot,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  Reply,
  Users,
  X,
} from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/toast"
import { getAvatarInitials } from "@/components/ui/avatar"
import { ScreenState } from "@/components/app/states/screen-state"
import { useChatWorkspace } from "@/lib/api"
import type {
  ChannelMessage,
  ChatAttachment,
  ChatChannel,
  ChatMember,
  ChatMention,
} from "@/lib/api"
import { CopyButton } from "./copy-button"
import { formatBytes } from "./format"
import { executeChatCommand, matchChatCommands, type ChatCommand } from "./chat-commands"
import { cn } from "@/lib/utils"

function Icon({ name, className = "icon icon--xs" }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

/** Coarse presence derived from the member's online/away flags. */
export type ChatPresenceStatus = "online" | "away" | "offline"

export function presenceStatus(member: ChatMember): ChatPresenceStatus {
  if (!member.online) return "offline"
  return member.away ? "away" : "online"
}

const PRESENCE_LABELS: Record<ChatPresenceStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
}

/** Short relative "last seen" for offline members; falls back to a date. */
export function formatLastSeen(value: string) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return "recently"
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} h ago`
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Tooltip/status suffix describing a member's presence for assistive tech. */
function presenceDescription(member: ChatMember) {
  const status = presenceStatus(member)
  if (status === "offline" && member.lastSeenAt) {
    return `Last seen ${formatLastSeen(member.lastSeenAt)}`
  }
  return PRESENCE_LABELS[status]
}

function initials(name: string) {
  return getAvatarInitials(name)
}

function MessageAvatar({ message }: { message: ChannelMessage }) {
  return (
    <span
      className={cn(
        "app-chat-avatar",
        message.anonymous && "is-anonymous",
        message.bot && "is-bot",
      )}
      aria-hidden="true"
    >
      {message.bot ? (
        <Bot className="size-3.5" />
      ) : message.anonymous ? (
        "?"
      ) : (
        initials(message.authorName)
      )}
    </span>
  )
}

/** Mock download stub: chat attachments have no stored bytes, so the blob
 * carries a note instead — same convention as the file-manager manifest. */
function downloadAttachment(attachment: ChatAttachment) {
  const content = [
    `Mock attachment "${attachment.name}" shared in chat.`,
    `Size: ${attachment.sizeBytes} bytes.`,
    "Note: file contents are not stored in the session mock.",
    "",
  ].join("\n")
  const blob = new Blob([content], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = attachment.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function channelSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "channel"
  )
}

/**
 * Chat export payload builders, same convention as `usageExportJson`: pure
 * functions returning file contents so they can be unit-tested without a DOM.
 *
 * Scope: only the active channel's loaded message history is exported (the
 * `messages` array already filtered to `channel.id`). Replies keep their
 * `replyToId` link, attachments/mentions/reactions are listed by name — chat
 * attachment bytes are not stored in the mock, matching the download stub.
 */
export function chatExportJson(channel: ChatChannel, messages: ChannelMessage[]) {
  return JSON.stringify(
    {
      channel: {
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        memberCount: channel.memberCount,
      },
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((message) => ({
        id: message.id,
        authorId: message.authorId,
        authorName: message.authorName,
        anonymous: message.anonymous,
        body: message.body,
        createdAt: message.createdAt,
        status: message.status,
        replyToId: message.replyToId ?? null,
        attachments: message.attachments ?? [],
        mentions: message.mentions ?? [],
        reactions: message.reactions ?? [],
      })),
    },
    null,
    2,
  )
}

/** Markdown rendering of the same active-channel export: one section per message. */
export function chatExportMarkdown(
  channel: ChatChannel,
  messages: ChannelMessage[],
  messagesById: Map<string, ChannelMessage>,
) {
  const lines = [
    `# ${channel.name}`,
    "",
    `${messages.length} ${messages.length === 1 ? "message" : "messages"} exported from Spindle chat.`,
    "",
  ]
  for (const message of messages) {
    const parent = message.replyToId ? messagesById.get(message.replyToId) : undefined
    lines.push(
      `**${message.authorName}**${message.anonymous ? " (anonymous)" : ""} — ${message.createdAt}`,
    )
    if (message.replyToId) {
      lines.push(
        parent
          ? `> Reply to ${parent.authorName}: ${messageSnippet(parent)}`
          : "> Reply to a message outside the export",
      )
    }
    if (message.body) lines.push("", message.body)
    for (const attachment of message.attachments ?? []) {
      lines.push(`- Attachment: ${attachment.name} (${formatBytes(attachment.sizeBytes)})`)
    }
    for (const mention of message.mentions ?? []) {
      lines.push(`- Mention: @${mention.name}`)
    }
    const reactions = message.reactions ?? []
    if (reactions.length > 0) {
      lines.push(
        `- Reactions: ${reactions.map((reaction) => `${reaction.emoji} (${reaction.userIds.length})`).join(", ")}`,
      )
    }
    lines.push("", "---", "")
  }
  return lines.join("\n")
}

/** Blob/createObjectURL download — same pattern as files-screen and usage-screen. */
function downloadChatExport(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function AttachmentChip({ attachment, term }: { attachment: ChatAttachment; term?: string }) {
  return (
    <span className="app-chat-attachment">
      <FileText aria-hidden="true" />
      <span className="app-chat-attachment-name">
        <HighlightedText text={attachment.name} term={term} />
      </span>
      <span className="app-chat-attachment-size">{formatBytes(attachment.sizeBytes)}</span>
      <button
        type="button"
        className="app-chat-attachment-download"
        aria-label={`Download ${attachment.name}`}
        title="Download (mock)"
        onClick={() => downloadAttachment(attachment)}
      >
        <Download aria-hidden="true" />
      </button>
    </span>
  )
}

type PendingFileStatus = "uploading" | "done" | "failed"

type PendingFile = {
  id: string
  name: string
  sizeBytes: number
  progress: number
  status: PendingFileStatus
}

const CHAT_UPLOAD_TICK_MS = 250

/** Same duration curve as the file-manager mock uploads (store.tickUploads). */
function chatUploadDurationMs(sizeBytes: number) {
  return Math.min(9000, Math.max(1200, 1200 + (sizeBytes / (1024 * 1024)) * 900))
}

const QUICK_REACTIONS = ["👍", "🎉", "❤️"] as const
const CURRENT_USER_ID = "user-bogdan"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Resolve `@Name` tokens in the draft against the presence roster. */
function parseMentions(body: string, members: ChatMember[]): ChatMention[] {
  const mentions: ChatMention[] = []
  const seen = new Set<string>()
  for (const member of members) {
    if (member.id === CURRENT_USER_ID || seen.has(member.id)) continue
    const pattern = new RegExp(`@${escapeRegExp(member.name)}\\b`, "i")
    if (pattern.test(body)) {
      mentions.push({ id: member.id, name: member.name })
      seen.add(member.id)
    }
  }
  return mentions
}

const PRESENCE_DOT_CLASSES: Record<ChatPresenceStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-muted-foreground/40",
}

function PresenceDot({ status }: { status: ChatPresenceStatus }) {
  return (
    <span
      className={`app-chat-presence-dot inline-block size-2 rounded-full ${PRESENCE_DOT_CLASSES[status]}`}
      aria-hidden="true"
    />
  )
}

function PresenceStrip({ members }: { members: ChatMember[] }) {
  if (members.length === 0) return null
  const online = members.filter((member) => member.online)
  const away = members.filter((member) => presenceStatus(member) === "away")
  return (
    <div
      className="app-chat-presence border-border text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs"
      aria-label="Workspace presence"
    >
      {members.map((member) => {
        const status = presenceStatus(member)
        const description = presenceDescription(member)
        return (
          <span
            key={member.id}
            className={`app-chat-presence-member inline-flex items-center gap-1.5 ${
              status === "offline" ? "app-chat-presence-member--offline" : ""
            }`}
            title={`${member.name} — ${description}`}
          >
            <PresenceDot status={status} />
            {member.name}
            {member.bot ? <span className="app-chat-bot-badge">bot</span> : null}
            {status === "offline" && member.lastSeenAt ? (
              <span className="app-chat-presence-seen">
                · last seen {formatLastSeen(member.lastSeenAt)}
              </span>
            ) : null}
            <span className="sr-only"> ({description.toLowerCase()})</span>
          </span>
        )
      })}
      <span className="app-chat-presence-count ml-auto">
        {online.length} of {members.length} online
        {away.length > 0 ? ` · ${away.length} away` : ""}
      </span>
    </div>
  )
}

/** Right-hand roster panel: avatar, presence status, and last-seen per member. */
function MembersPanel({
  members,
  typingMemberIds,
}: {
  members: ChatMember[]
  typingMemberIds: Set<string>
}) {
  if (members.length === 0) return null
  // Stable roster order: online first, then away, then offline; bots last
  // within their status band so people stay easy to scan.
  const rank = (member: ChatMember) => {
    const status = presenceStatus(member)
    return (status === "online" ? 0 : status === "away" ? 1 : 2) * 2 + (member.bot ? 1 : 0)
  }
  const roster = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  return (
    <aside className="app-chat-members" aria-label="Members">
      <div className="app-chat-channels-head">Members</div>
      <ul className="app-chat-member-list">
        {roster.map((member) => {
          const status = presenceStatus(member)
          return (
            <li key={member.id} className="app-chat-member">
              <span className={cn("app-chat-avatar", member.bot && "is-bot")} aria-hidden="true">
                {member.bot ? <Bot className="size-3.5" /> : initials(member.name)}
              </span>
              <span className="app-chat-member-info">
                <span className="app-chat-member-name">
                  {member.name}
                  {member.bot ? <span className="app-chat-bot-badge">bot</span> : null}
                  {typingMemberIds.has(member.id) ? (
                    <span className="app-chat-member-typing">typing…</span>
                  ) : null}
                </span>
                <span className="app-chat-member-status">
                  <PresenceDot status={status} />
                  {PRESENCE_LABELS[status].toLowerCase()}
                  {status === "offline" && member.lastSeenAt
                    ? ` · last seen ${formatLastSeen(member.lastSeenAt)}`
                    : ""}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function TypingIndicator({ entries }: { entries: { memberName: string; bot?: boolean }[] }) {
  if (entries.length === 0) return null
  const names = entries.map((entry) => entry.memberName)
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names[0]} and ${names.length - 1} others are typing…`
  return (
    <div
      className="app-chat-typing text-muted-foreground px-3 py-1 text-xs italic"
      role="status"
      aria-live="polite"
    >
      {entries.some((entry) => entry.bot) ? (
        <Bot className="mr-1 inline size-3 align-[-2px]" aria-hidden="true" />
      ) : null}
      {label}
    </div>
  )
}

function ReactionBar({
  message,
  onToggle,
}: {
  message: ChannelMessage
  onToggle: (messageId: string, emoji: string) => void
}) {
  if (message.status === "sending") return null
  const reactions = message.reactions ?? []
  const reactedEmojis = new Set(reactions.map((reaction) => reaction.emoji))
  const quick = QUICK_REACTIONS.filter((emoji) => !reactedEmojis.has(emoji))
  return (
    <div className="app-chat-reactions mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(CURRENT_USER_ID)
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={`app-chat-reaction inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              mine ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
            }`}
            aria-pressed={mine}
            aria-label={`${reaction.emoji} reaction, ${reaction.userIds.length} ${
              reaction.userIds.length === 1 ? "person" : "people"
            }`}
            onClick={() => onToggle(message.id, reaction.emoji)}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span>{reaction.userIds.length}</span>
          </button>
        )
      })}
      {quick.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="app-chat-reaction app-chat-reaction--add hover:border-border hover:bg-muted inline-flex items-center rounded-full border border-transparent px-1.5 py-0.5 text-xs opacity-60 hover:opacity-100"
          aria-label={`Add ${emoji} reaction`}
          onClick={() => onToggle(message.id, emoji)}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  )
}

/** Wrap case-insensitive occurrences of `term` in <mark> for search hits. */
function HighlightedText({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim()
  if (!needle) return <>{text}</>
  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "gi")
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="app-chat-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

type MessagePart = { type: "text"; text: string } | { type: "code"; language: string; code: string }

/**
 * Fenced ``` blocks. The opening fence must be followed by a newline so
 * inline triple-backtick mentions in prose don't start a block; an
 * unterminated fence runs to the end of the message.
 */
const FENCED_CODE_BLOCK = /```([^\n`]*)[^\S\n]*\r?\n([\s\S]*?)(?:```|$)/g
/** Inline `code` spans: single backticks, no newlines, non-empty content. */
const INLINE_CODE = /`[^`\n]+`/

/** Splits a message body into fenced code blocks and the text around them. */
function parseMessageParts(body: string): MessagePart[] {
  const parts: MessagePart[] = []
  let lastIndex = 0

  for (const match of body.matchAll(FENCED_CODE_BLOCK)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ type: "text", text: body.slice(lastIndex, index) })
    parts.push({
      type: "code",
      language: (match[1] ?? "").trim(),
      code: (match[2] ?? "").replace(/\n$/, ""),
    })
    lastIndex = index + match[0].length
  }
  if (lastIndex < body.length) parts.push({ type: "text", text: body.slice(lastIndex) })

  return parts
}

/** Renders a text segment, swapping `inline code` spans for <code> elements. */
function renderMessageText(text: string, term: string | undefined, keyPrefix: string) {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (INLINE_CODE.test(part) && part.length > 2) {
      return (
        <code key={key} className="app-chat-inline-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <HighlightedText key={key} text={part} term={term} />
  })
}

/** Fenced code block: styled <pre><code> with a language tag and copy button. */
function ChatCodeBlock({ language, code }: { language: string; code: string }) {
  const languageLabel = language || "text"
  return (
    <div className="app-chat-code" data-code-block>
      <div className="app-chat-code-head">
        <span className="app-chat-code-lang">{languageLabel}</span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="app-chat-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/**
 * Message body renderer: plain text keeps the original single-<p> output
 * (with search-term highlighting), fenced ``` blocks become copyable code
 * cards, and `inline code` spans get monospace styling. Everything renders
 * as React text nodes — no raw HTML is ever injected.
 */
function ChatMessageBody({ body, term }: { body: string; term?: string }) {
  const parts = parseMessageParts(body)

  if (parts.length === 1 && parts[0].type === "text") {
    return <p>{renderMessageText(parts[0].text, term, "body")}</p>
  }

  return (
    <div className="app-chat-message-md">
      {parts.map((part, index) =>
        part.type === "code" ? (
          <ChatCodeBlock key={index} language={part.language} code={part.code} />
        ) : part.text.trim() ? (
          <p key={index}>{renderMessageText(part.text, term, `part-${index}`)}</p>
        ) : null,
      )}
    </div>
  )
}

function messageSnippet(message: ChannelMessage) {
  const body = message.body.trim()
  if (body) return body.length > 90 ? `${body.slice(0, 90)}…` : body
  const attachment = message.attachments?.[0]?.name
  return attachment ? `Attachment: ${attachment}` : "Message"
}

/** Quoted parent shown above a reply; clicking it targets the composer at it. */
function ReplyQuote({
  parent,
  onSelect,
}: {
  parent?: ChannelMessage
  onSelect: (message: ChannelMessage) => void
}) {
  if (!parent) {
    return <div className="app-chat-reply-quote is-missing">Original message unavailable</div>
  }
  return (
    <button type="button" className="app-chat-reply-quote" onClick={() => onSelect(parent)}>
      <span className="app-chat-reply-quote-author">{parent.authorName}</span>
      <span className="app-chat-reply-quote-body">{messageSnippet(parent)}</span>
    </button>
  )
}

function MentionChips({ mentions }: { mentions?: ChatMention[] }) {
  if (!mentions || mentions.length === 0) return null
  return (
    <div className="app-chat-mentions mt-1 flex flex-wrap gap-1">
      {mentions.map((mention) => (
        <span
          key={mention.id}
          className="app-chat-mention bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium"
        >
          @{mention.name}
        </span>
      ))}
    </div>
  )
}

function dayLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Earlier"
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfMessage = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfMessage) / 86_400_000)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

type MessageGroup = {
  key: string
  day: string
  messages: ChannelMessage[]
  showHeader: boolean
}

function groupMessages(messages: ChannelMessage[]) {
  const groups: MessageGroup[] = []
  let previous: ChannelMessage | null = null

  messages.forEach((message) => {
    const day = dayLabel(message.createdAt)
    const sameDay = previous ? dayLabel(previous.createdAt) === day : false
    const closeInTime =
      previous &&
      previous.authorId === message.authorId &&
      previous.anonymous === message.anonymous &&
      !previous.replyToId &&
      !message.replyToId &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000
    const showHeader = !sameDay || !closeInTime
    const key = `${day}-${message.id}`

    if (!sameDay || showHeader || groups.length === 0) {
      groups.push({ key, day, messages: [message], showHeader })
    } else {
      groups[groups.length - 1].messages.push(message)
    }
    previous = message
  })

  return groups
}

function ChannelButton({
  channel,
  active,
  onSelect,
}: {
  channel: ChatChannel
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`app-chat-channel${active ? "is-active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <Icon name={channel.kind === "dm" ? "i-users" : "i-message"} />
      <span className="app-chat-channel-name">{channel.name}</span>
      {channel.unreadCount ? (
        <span
          className="app-chat-channel-unread bg-primary text-primary-foreground ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
          aria-label={`${channel.unreadCount} unread`}
        >
          {channel.unreadCount}
        </span>
      ) : null}
      <span className="app-chat-channel-meta">{channel.memberCount}</span>
    </button>
  )
}

function NewThreadForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <form
      className="app-chat-new-thread border-border flex items-center gap-2 border-b px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        onCreate(trimmed)
        setName("")
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New thread name"
        aria-label="New thread name"
        maxLength={60}
        autoFocus
      />
      <button type="submit" className="fm-btn fm-btn--solid" disabled={!name.trim()}>
        Create
      </button>
    </form>
  )
}

export function ChatScreen({ projectId }: { projectId: string }) {
  const chat = useChatWorkspace(projectId)
  const { data, actions } = chat
  const [draft, setDraft] = useState("")
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [creatingThread, setCreatingThread] = useState(false)
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showMembers, setShowMembers] = useState(false)
  // Slash-command palette state: `commandIndex` is the highlighted row and
  // `commandDismissed` latches Escape until the draft's command token changes.
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandDismissed, setCommandDismissed] = useState(false)
  // Client-side channel topics set via /topic, keyed by channel id.
  const [channelTopics, setChannelTopics] = useState<Record<string, string>>({})
  const { toast } = useToast()
  const messagesEnd = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingFileId = useRef(0)

  const channels = data.channels
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === data.activeChannelId) ?? channels[0] ?? null,
    [channels, data.activeChannelId],
  )
  const messages = useMemo(() => {
    if (!activeChannel) return []
    return data.messages
      .filter((message) => message.channelId === activeChannel.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [activeChannel, data.messages])
  const searchTerm = searchQuery.trim().toLowerCase()
  // Client-side search over the loaded channel history: a message matches when
  // its body or an attachment name contains the term (case-insensitive).
  const visibleMessages = useMemo(() => {
    if (!searchTerm) return messages
    return messages.filter(
      (message) =>
        message.body.toLowerCase().includes(searchTerm) ||
        (message.attachments ?? []).some((attachment) =>
          attachment.name.toLowerCase().includes(searchTerm),
        ),
    )
  }, [messages, searchTerm])
  const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages])
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  )
  const typingHere = useMemo(
    () => data.typing.filter((entry) => entry.channelId === activeChannel?.id),
    [data.typing, activeChannel?.id],
  )
  const typingMemberIds = useMemo(
    () => new Set(typingHere.map((entry) => entry.memberId)),
    [typingHere],
  )

  // Slash-command palette: open only while the draft is still the command
  // token itself ("/me"), so once arguments start the popup steps aside.
  const commandToken = useMemo(() => {
    if (!draft.startsWith("/") || /\s/.test(draft)) return null
    return draft.slice(1)
  }, [draft])
  const commandSuggestions = useMemo(
    () => (commandToken === null ? [] : matchChatCommands(commandToken)),
    [commandToken],
  )
  const commandOpen = !commandDismissed && commandToken !== null && commandSuggestions.length > 0
  const activeCommandIndex = Math.min(commandIndex, commandSuggestions.length - 1)

  // Reset palette navigation whenever the typed command token changes.
  useEffect(() => {
    setCommandIndex(0)
    setCommandDismissed(false)
  }, [commandToken])

  const channelTopic = activeChannel ? channelTopics[activeChannel.id] : undefined

  // Pending /remind toasts; cleared on unmount so they can't fire after the
  // screen is gone.
  const reminderTimers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const timer of reminderTimers.current) window.clearTimeout(timer)
    },
    [],
  )

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" })
  }, [messages.length, activeChannel?.id])

  // A reply target only makes sense inside the channel it was picked in.
  useEffect(() => {
    setReplyTo(null)
  }, [activeChannel?.id])

  const hasUploadingFiles = pendingFiles.some((file) => file.status === "uploading")

  // Simulated per-file upload progress, mirroring the file-manager mock:
  // size-based duration curve and a deterministic "fail" filename trigger.
  useEffect(() => {
    if (!hasUploadingFiles) return
    const interval = window.setInterval(() => {
      setPendingFiles((current) => {
        let changed = false
        const next = current.map((file) => {
          if (file.status !== "uploading") return file
          changed = true
          if (file.name.toLowerCase().includes("fail")) {
            return { ...file, status: "failed" as const, progress: 0 }
          }
          const progress = Math.min(
            100,
            file.progress + (CHAT_UPLOAD_TICK_MS / chatUploadDurationMs(file.sizeBytes)) * 100,
          )
          return progress >= 100
            ? { ...file, status: "done" as const, progress: 100 }
            : { ...file, progress }
        })
        return changed ? next : current
      })
    }, CHAT_UPLOAD_TICK_MS)
    return () => window.clearInterval(interval)
  }, [hasUploadingFiles])

  const readyAttachments = pendingFiles.filter((file) => file.status === "done")

  const sendInFlight = useRef(false)

  /** Insert the highlighted palette command as the draft's first token. */
  const applyCommandSuggestion = (command: ChatCommand) => {
    setDraft(`/${command.name} `)
    setCommandDismissed(true)
  }

  const send = async () => {
    const body = draft.trim()
    if ((!body && readyAttachments.length === 0) || !activeChannel || sendInFlight.current) return

    // User slash commands resolve before the message is sent. Message
    // commands rewrite the body so it no longer starts with "/" and the bot
    // trigger in the mock store stays out of it; local commands never reach
    // the channel at all. Bot commands and unknown "/..." input return null
    // and are sent verbatim (the bot answers or reports them unknown).
    const commandResult = body ? executeChatCommand(body, { anonymous: data.anonymous }) : null
    if (commandResult?.type === "usage") {
      toast({ variant: "error", title: `Usage: ${commandResult.usage}` })
      return
    }
    if (commandResult?.type === "topic") {
      setChannelTopics((current) => {
        const next = { ...current }
        if (commandResult.topic) next[activeChannel.id] = commandResult.topic
        else delete next[activeChannel.id]
        return next
      })
      setDraft("")
      toast({
        title: commandResult.topic
          ? `Topic set for #${activeChannel.name}`
          : `Topic cleared for #${activeChannel.name}`,
      })
      return
    }
    if (commandResult?.type === "remind") {
      const delayMs = Math.max(1000, commandResult.minutes * 60_000)
      reminderTimers.current.push(
        window.setTimeout(() => {
          toast({
            title: "Reminder",
            description: commandResult.text,
            duration: 10_000,
          })
        }, delayMs),
      )
      setDraft("")
      toast({
        title: "Reminder set",
        description: `“${commandResult.text}” — I'll ping you when it's due.`,
      })
      return
    }
    const outgoingBody = commandResult?.type === "send" ? commandResult.body : body

    sendInFlight.current = true
    try {
      const mentions = outgoingBody.length > 0 ? parseMentions(outgoingBody, data.members) : []
      const sentIds = new Set(readyAttachments.map((file) => file.id))
      const result = await actions.sendMessage(
        outgoingBody,
        readyAttachments.length > 0
          ? readyAttachments.map(({ name, sizeBytes }) => ({ name, sizeBytes }))
          : undefined,
        mentions.length > 0 ? mentions : undefined,
        replyTo?.id,
      )
      if (!result.ok) {
        toast({ variant: "error", title: result.error })
        return
      }
      setDraft("")
      // Remove only the files that actually rode this message. Anything still
      // uploading or failed stays pending — including a file that finished
      // uploading while sendMessage was in flight, which was never sent.
      setPendingFiles((current) => current.filter((file) => !sentIds.has(file.id)))
      setReplyTo(null)
    } finally {
      sendInFlight.current = false
    }
  }

  const onAttachFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).map((file) => ({
      id: `pending-${pendingFileId.current++}`,
      name: file.name,
      sizeBytes: file.size,
      progress: 0,
      status: "uploading" as const,
    }))
    if (files.length > 0) setPendingFiles((current) => [...current, ...files])
    event.target.value = ""
  }

  const retryPendingFile = (id: string) => {
    setPendingFiles((current) =>
      current.map((file) =>
        file.id === id ? { ...file, status: "uploading", progress: 0 } : file,
      ),
    )
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const delta = event.key === "ArrowDown" ? 1 : -1
        setCommandIndex(
          (current) => (current + delta + commandSuggestions.length) % commandSuggestions.length,
        )
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const command = commandSuggestions[activeCommandIndex]
        if (command) applyCommandSuggestion(command)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setCommandDismissed(true)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  // Export scope is the active channel's loaded history only — switching
  // channels changes what the next export contains.
  const exportChannel = (format: "json" | "markdown") => {
    if (!activeChannel) return
    const slug = channelSlug(activeChannel.name)
    if (format === "json") {
      downloadChatExport(
        `spindle-chat-${slug}.json`,
        chatExportJson(activeChannel, messages),
        "application/json",
      )
    } else {
      downloadChatExport(
        `spindle-chat-${slug}.md`,
        chatExportMarkdown(activeChannel, messages, messagesById),
        "text/markdown;charset=utf-8",
      )
    }
  }

  return (
    <ScreenState
      screen="chat"
      status={chat.status}
      error={chat.error}
      isEmpty={chat.isEmpty}
      isRetrying={chat.isRetrying}
      onRetry={chat.refetch}
    >
      <div className="app-page app-page--chat">
        <div className="app-page-head">
          <div>
            <h1>Chat</h1>
            <p className="app-page-subtitle">
              Project {projectId} channels for {data.project.name}. Messages stay in the session
              mock.
            </p>
          </div>
        </div>

        <div className={cn("app-chat-layout", showMembers && "app-chat-layout--members")}>
          <aside className="app-chat-channels" aria-label="Channels">
            <div className="app-chat-channels-head">
              <span>Channels</span>
              <button
                type="button"
                className="app-icon-button"
                aria-label="New thread"
                title="New thread"
                aria-expanded={creatingThread}
                onClick={() => setCreatingThread((current) => !current)}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
            {creatingThread ? (
              <NewThreadForm
                onCreate={(name) => {
                  void actions.createThread(name).then((result) => {
                    if (!result.ok) {
                      toast({ variant: "error", title: result.error })
                      return
                    }
                    setCreatingThread(false)
                  })
                }}
              />
            ) : null}
            {channels.length === 0 ? (
              <EmptyState
                icon={<MessageSquare aria-hidden="true" />}
                title="No channels"
                body="The mock store has no chat channels for this project."
                className="border-0 bg-transparent px-3 py-6"
              />
            ) : (
              channels.map((channel) => (
                <ChannelButton
                  key={channel.id}
                  channel={channel}
                  active={channel.id === activeChannel?.id}
                  onSelect={() => {
                    void actions.selectChannel(channel.id).then((result) => {
                      if (!result.ok) toast({ variant: "error", title: result.error })
                    })
                  }}
                />
              ))
            )}
          </aside>

          <section
            className="app-chat-thread"
            aria-label={activeChannel ? `Thread ${activeChannel.name}` : "Chat thread"}
          >
            {activeChannel ? (
              <>
                <div className="app-chat-thread-head">
                  <div>
                    <strong>{activeChannel.name}</strong>
                    <span title={channelTopic || undefined}>
                      {activeChannel.kind === "dm"
                        ? "Direct message"
                        : `${activeChannel.memberCount} members`}
                      {channelTopic ? ` · Topic: ${channelTopic}` : ""}
                    </span>
                  </div>
                  <div className="app-chat-thread-tools">
                    <label className="fm-search app-chat-search" htmlFor="chat-message-search">
                      <Icon name="i-search" />
                      <input
                        id="chat-message-search"
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setSearchQuery("")
                        }}
                        placeholder="Search messages"
                        aria-label={`Search messages in ${activeChannel.name}`}
                      />
                    </label>
                    <label className="app-chat-anon">
                      <input
                        type="checkbox"
                        checked={data.anonymous}
                        onChange={(event) => void actions.setAnonymous(event.target.checked)}
                      />
                      <span>Anonymous mode</span>
                    </label>
                    <label
                      className="app-chat-anon"
                      title="Let Spindle Bot answer @mentions and slash commands"
                    >
                      <input
                        type="checkbox"
                        checked={data.botEnabled}
                        onChange={(event) => void actions.setBotEnabled(event.target.checked)}
                      />
                      <span>Spindle Bot</span>
                    </label>
                    <button
                      type="button"
                      className="app-icon-button"
                      aria-label="Toggle members panel"
                      title="Members"
                      aria-expanded={showMembers}
                      onClick={() => setShowMembers((current) => !current)}
                    >
                      <Users aria-hidden="true" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="app-icon-button"
                        aria-label="Export channel"
                        title="Export channel"
                      >
                        <Download aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="app-menu">
                        <DropdownMenuItem
                          className="app-menu-item"
                          onSelect={() => exportChannel("json")}
                        >
                          <span className="app-menu-item-label">Export as JSON</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="app-menu-item"
                          onSelect={() => exportChannel("markdown")}
                        >
                          <span className="app-menu-item-label">Export as Markdown</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <PresenceStrip members={data.members} />

                {searchTerm ? (
                  <div className="app-chat-search-status" role="status">
                    <span>
                      {visibleMessages.length} of {messages.length}{" "}
                      {messages.length === 1 ? "message" : "messages"} match &ldquo;{searchTerm}
                      &rdquo;
                    </span>
                    <button
                      type="button"
                      className="app-chat-search-clear"
                      onClick={() => setSearchQuery("")}
                    >
                      <X className="size-3.5" aria-hidden="true" /> Clear
                    </button>
                  </div>
                ) : null}

                <div className="app-chat-messages" role="log" aria-live="polite">
                  {visibleMessages.length === 0 ? (
                    <EmptyState
                      icon={<MessageSquare aria-hidden="true" />}
                      title={searchTerm ? "No matches" : "No messages yet"}
                      body={
                        searchTerm
                          ? `No messages in ${activeChannel.name} match "${searchTerm}".`
                          : `Say hello in ${activeChannel.name} — the first message is stored in the mock.`
                      }
                      className="border-0 bg-transparent py-8"
                    />
                  ) : (
                    groups.map((group) => (
                      <div key={group.key} className="app-chat-group">
                        {group.showHeader ? <div className="app-chat-day">{group.day}</div> : null}
                        {group.messages.map((message) => {
                          const mine = message.authorId === "user-bogdan"
                          const isFirst = group.messages[0]?.id === message.id
                          const parent = message.replyToId
                            ? messagesById.get(message.replyToId)
                            : undefined
                          return (
                            <article
                              key={message.id}
                              className={cn(
                                "app-chat-message",
                                mine && "is-mine",
                                message.replyToId && "is-reply",
                              )}
                            >
                              {isFirst && group.showHeader ? (
                                <header className="app-chat-message-head">
                                  <MessageAvatar message={message} />
                                  <strong>{message.authorName}</strong>
                                  {message.anonymous ? (
                                    <span className="app-chat-anon-badge">anon</span>
                                  ) : null}
                                  {message.bot ? (
                                    <span className="app-chat-bot-badge">bot</span>
                                  ) : null}
                                  <time dateTime={message.createdAt}>
                                    {formatTime(message.createdAt)}
                                  </time>
                                </header>
                              ) : null}
                              <div className="app-chat-message-body">
                                {message.replyToId ? (
                                  <ReplyQuote parent={parent} onSelect={setReplyTo} />
                                ) : null}
                                {message.body ? (
                                  <ChatMessageBody body={message.body} term={searchTerm} />
                                ) : null}
                                <MentionChips mentions={message.mentions} />
                                {message.attachments && message.attachments.length > 0 ? (
                                  <div className="app-chat-attachments">
                                    {message.attachments.map((attachment) => (
                                      <AttachmentChip
                                        key={attachment.id}
                                        attachment={attachment}
                                        term={searchTerm}
                                      />
                                    ))}
                                  </div>
                                ) : null}
                                {message.status === "sending" ? (
                                  <span className="app-chat-status">Sending…</span>
                                ) : null}
                                {message.status === "failed" ? (
                                  <span className="app-chat-status is-failed">
                                    Failed{" "}
                                    <button
                                      type="button"
                                      onClick={() => void actions.retryMessage(message.id)}
                                    >
                                      Retry
                                    </button>
                                  </span>
                                ) : null}
                                <ReactionBar
                                  message={message}
                                  onToggle={(messageId, emoji) =>
                                    void actions.toggleReaction(messageId, emoji).then((result) => {
                                      if (!result.ok)
                                        toast({ variant: "error", title: result.error })
                                    })
                                  }
                                />
                                {message.status !== "sending" ? (
                                  <button
                                    type="button"
                                    className="app-chat-reply text-muted-foreground hover:bg-muted mt-1 inline-flex items-center gap-1 self-start rounded-full px-1.5 py-0.5 text-xs opacity-60 hover:opacity-100"
                                    onClick={() => setReplyTo(message)}
                                  >
                                    <Reply className="size-3.5" aria-hidden="true" />
                                    Reply
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ))
                  )}
                  <TypingIndicator entries={typingHere} />
                  <div ref={messagesEnd} />
                </div>

                <div className="app-chat-composer">
                  <div className="app-chat-posting-as">
                    Posting as <strong>{data.anonymous ? "Anonymous surveyor" : "You"}</strong>
                    {data.anonymous ? " · identity hidden in this thread" : ""}
                  </div>
                  {pendingFiles.length > 0 ? (
                    <div className="app-chat-pending" aria-live="polite">
                      {pendingFiles.map((file) => (
                        <span key={file.id} className="app-chat-pending-file">
                          <span
                            className={cn(
                              "app-chat-attachment",
                              file.status === "failed" && "is-failed",
                            )}
                          >
                            <Paperclip aria-hidden="true" />
                            <span className="app-chat-attachment-name">{file.name}</span>
                            <span className="app-chat-attachment-size">
                              {file.status === "failed"
                                ? "Failed"
                                : file.status === "done"
                                  ? formatBytes(file.sizeBytes)
                                  : `${Math.round(file.progress)}%`}
                            </span>
                            {file.status === "failed" ? (
                              <button
                                type="button"
                                className="app-chat-attachment-retry"
                                aria-label={`Retry ${file.name}`}
                                onClick={() => retryPendingFile(file.id)}
                              >
                                Retry
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="app-chat-attachment-remove"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setPendingFiles((current) =>
                                  current.filter((pending) => pending.id !== file.id),
                                )
                              }
                            >
                              <X aria-hidden="true" />
                            </button>
                          </span>
                          {file.status === "uploading" ? (
                            <span
                              className="app-chat-upload-track"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(file.progress)}
                              aria-label={`${file.name} upload progress`}
                            >
                              <span style={{ width: `${file.progress}%` }} />
                            </span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {replyTo ? (
                    <div className="app-chat-reply-target flex items-center gap-2 text-xs">
                      <Reply
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <strong>Replying to {replyTo.authorName}</strong>
                        <span className="text-muted-foreground"> · {messageSnippet(replyTo)}</span>
                      </span>
                      <button
                        type="button"
                        className="app-icon-button"
                        aria-label="Cancel reply"
                        title="Cancel reply"
                        onClick={() => setReplyTo(null)}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  {commandOpen ? (
                    <div className="app-chat-commands" role="listbox" aria-label="Chat commands">
                      {commandSuggestions.map((command, index) => (
                        <button
                          key={command.name}
                          type="button"
                          role="option"
                          aria-selected={index === activeCommandIndex}
                          className={cn(
                            "app-chat-command",
                            index === activeCommandIndex && "is-active",
                          )}
                          // Keep the textarea focused so typing continues.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyCommandSuggestion(command)}
                        >
                          <code className="app-chat-command-name">/{command.name}</code>
                          <span className="app-chat-command-desc">{command.description}</span>
                          {command.scope === "bot" ? (
                            <span className="app-chat-bot-badge">bot</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="app-chat-input-row">
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      className="sr-only"
                      aria-hidden="true"
                      tabIndex={-1}
                      onChange={onAttachFiles}
                    />
                    <label className="sr-only" htmlFor="chat-composer">
                      Message {activeChannel.name}
                    </label>
                    <textarea
                      id="chat-composer"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={onComposerKeyDown}
                      placeholder={`Message ${activeChannel.name} — Enter to send, Shift+Enter for a new line`}
                      rows={2}
                    />
                    <div className="app-chat-input-actions">
                      <button
                        type="button"
                        className="app-icon-button"
                        aria-label="Attach files"
                        title="Attach files"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="fm-btn fm-btn--solid"
                        onClick={() => void send()}
                        disabled={!draft.trim() && readyAttachments.length === 0}
                      >
                        <Icon name="i-send" /> Send
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<MessageSquare aria-hidden="true" />}
                title="No channel selected"
                body="Select a channel to start a mock conversation."
                className="border-0 bg-transparent"
              />
            )}
          </section>

          {showMembers ? (
            <MembersPanel members={data.members} typingMemberIds={typingMemberIds} />
          ) : null}
        </div>
      </div>
    </ScreenState>
  )
}
