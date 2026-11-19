"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"

import { useMockStore } from "@/components/app/mock-store-provider"
import type { ChatChannel, ChatMessage } from "@/lib/project-store"

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
  messages: ChatMessage[]
  showHeader: boolean
}

function groupMessages(messages: ChatMessage[]) {
  const groups: MessageGroup[] = []
  let previous: ChatMessage | null = null

  messages.forEach((message) => {
    const day = dayLabel(message.createdAt)
    const sameDay = previous ? dayLabel(previous.createdAt) === day : false
    const closeInTime =
      previous &&
      previous.authorId === message.authorId &&
      previous.anonymous === message.anonymous &&
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
      className={`app-chat-channel${active ? " is-active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <Icon name={channel.kind === "dm" ? "i-users" : "i-message"} />
      <span className="app-chat-channel-name">{channel.name}</span>
      <span className="app-chat-channel-meta">{channel.memberCount}</span>
    </button>
  )
}

export function ChatScreen({ projectId }: { projectId: string }) {
  const { store, state, ready } = useMockStore()
  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState("")
  const messagesEnd = useRef<HTMLDivElement>(null)

  const channels = state.chat.channels
  const activeChannel = useMemo(
    () =>
      channels.find((channel) => channel.id === state.chat.activeChannelId) ?? channels[0] ?? null,
    [channels, state.chat.activeChannelId],
  )
  const messages = useMemo(() => {
    if (!activeChannel) return []
    return state.chat.messages
      .filter((message) => message.channelId === activeChannel.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [activeChannel, state.chat.messages])
  const groups = useMemo(() => groupMessages(messages), [messages])

  useEffect(() => {
    const interval = window.setInterval(() => {
      state.chat.messages.forEach((message) => {
        if (message.status === "sending") store.settleChatMessage(message.id)
      })
    }, 700)
    return () => window.clearInterval(interval)
  }, [state.chat.messages, store])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" })
  }, [messages.length, activeChannel?.id])

  const send = () => {
    const body = draft.trim()
    if (!body || !activeChannel) return
    const id = store.sendChatMessage(activeChannel.id, body, state.chat.anonymous)
    if (!id) {
      setNotice("The message could not be sent.")
      return
    }
    setDraft("")
    setNotice("")
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  if (!ready) {
    return (
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Chat</h1>
            <p className="app-page-subtitle">Loading mock channels…</p>
          </div>
        </div>
        <div className="app-loading" aria-label="Loading chat">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  return (
    <div className="app-page app-page--chat">
      <div className="app-page-head">
        <div>
          <h1>Chat</h1>
          <p className="app-page-subtitle">
            Project {projectId} channels for {state.project.name}. Messages stay in the session
            mock.
          </p>
        </div>
      </div>

      {notice ? (
        <div className="app-alert app-alert--error" role="alert">
          {notice}
        </div>
      ) : null}

      <div className="app-chat-layout">
        <aside className="app-chat-channels" aria-label="Channels">
          <div className="app-chat-channels-head">Channels</div>
          {channels.length === 0 ? (
            <div className="app-state app-state--compact">
              <Icon name="i-message" className="icon" />
              <h2>No channels</h2>
              <p>The mock store has no chat channels for this project.</p>
            </div>
          ) : (
            channels.map((channel) => (
              <ChannelButton
                key={channel.id}
                channel={channel}
                active={channel.id === activeChannel?.id}
                onSelect={() => {
                  const result = store.setActiveChatChannel(channel.id)
                  if (!result.ok) setNotice(result.error)
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
                  <span>
                    {activeChannel.kind === "dm"
                      ? "Direct message"
                      : `${activeChannel.memberCount} members`}
                  </span>
                </div>
                <label className="app-chat-anon">
                  <input
                    type="checkbox"
                    checked={state.chat.anonymous}
                    onChange={(event) => store.setChatAnonymous(event.target.checked)}
                  />
                  <span>Anonymous mode</span>
                </label>
              </div>

              <div className="app-chat-messages" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="app-state app-state--compact">
                    <Icon name="i-message" className="icon" />
                    <h2>No messages yet</h2>
                    <p>
                      Say hello in {activeChannel.name} — the first message is stored in the mock.
                    </p>
                  </div>
                ) : (
                  groups.map((group) => (
                    <div key={group.key} className="app-chat-group">
                      {group.showHeader ? <div className="app-chat-day">{group.day}</div> : null}
                      {group.messages.map((message) => {
                        const mine = message.authorId === "user-bogdan"
                        const isFirst = group.messages[0]?.id === message.id
                        return (
                          <article
                            key={message.id}
                            className={`app-chat-message${mine ? " is-mine" : ""}`}
                          >
                            {isFirst && group.showHeader ? (
                              <header className="app-chat-message-head">
                                <strong>{message.authorName}</strong>
                                {message.anonymous ? (
                                  <span className="app-chat-anon-badge">anon</span>
                                ) : null}
                                <time dateTime={message.createdAt}>
                                  {formatTime(message.createdAt)}
                                </time>
                              </header>
                            ) : null}
                            <div className="app-chat-message-body">
                              <p>{message.body}</p>
                              {message.status === "sending" ? (
                                <span className="app-chat-status">Sending…</span>
                              ) : null}
                              {message.status === "failed" ? (
                                <span className="app-chat-status is-failed">
                                  Failed{" "}
                                  <button
                                    type="button"
                                    onClick={() => store.retryChatMessage(message.id)}
                                  >
                                    Retry
                                  </button>
                                </span>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEnd} />
              </div>

              <div className="app-chat-composer">
                <div className="app-chat-posting-as">
                  Posting as <strong>{state.chat.anonymous ? "Anonymous surveyor" : "You"}</strong>
                  {state.chat.anonymous ? " · identity hidden in this thread" : ""}
                </div>
                <div className="app-chat-input-row">
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
                  <button
                    type="button"
                    className="fm-btn fm-btn--solid"
                    onClick={send}
                    disabled={!draft.trim()}
                  >
                    <Icon name="i-send" /> Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="app-state">
              <Icon name="i-message" className="icon" />
              <h2>No channel selected</h2>
              <p>Select a channel to start a mock conversation.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
