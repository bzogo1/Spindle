import { describe, expect, it } from "vitest"

import type { ChannelMessage, ChatChannel } from "./types"
import {
  chatNotificationInput,
  chatNotificationKind,
  chatNotificationSnippet,
} from "./chat-notifications"

const CURRENT_USER_ID = "user-bogdan"

function message(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "msg-1",
    channelId: "channel-field-notes",
    authorId: "user-mara",
    authorName: "Mara",
    anonymous: false,
    body: "Hello there",
    createdAt: "2026-11-19T09:14:00.000Z",
    status: "sent",
    ...overrides,
  }
}

const channel: ChatChannel = {
  id: "channel-field-notes",
  name: "field-notes",
  kind: "channel",
  memberCount: 8,
}

describe("chatNotificationKind", () => {
  it("classifies a message mentioning the current user as a mention", () => {
    const incoming = message({ mentions: [{ id: CURRENT_USER_ID, name: "You" }] })
    expect(chatNotificationKind(incoming, [incoming], CURRENT_USER_ID)).toBe("mention")
  })

  it("classifies a reply to the current user's message as a reply", () => {
    const own = message({ id: "msg-own", authorId: CURRENT_USER_ID, authorName: "You" })
    const incoming = message({ id: "msg-reply", replyToId: "msg-own" })
    expect(chatNotificationKind(incoming, [own, incoming], CURRENT_USER_ID)).toBe("reply")
  })

  it("prefers mention over reply when both apply", () => {
    const own = message({ id: "msg-own", authorId: CURRENT_USER_ID, authorName: "You" })
    const incoming = message({
      id: "msg-both",
      replyToId: "msg-own",
      mentions: [{ id: CURRENT_USER_ID, name: "You" }],
    })
    expect(chatNotificationKind(incoming, [own, incoming], CURRENT_USER_ID)).toBe("mention")
  })

  it("ignores the current user's own messages", () => {
    const own = message({
      authorId: CURRENT_USER_ID,
      authorName: "You",
      mentions: [{ id: CURRENT_USER_ID, name: "You" }],
    })
    expect(chatNotificationKind(own, [own], CURRENT_USER_ID)).toBeNull()
  })

  it("ignores messages that are not fully sent", () => {
    const incoming = message({
      status: "sending",
      mentions: [{ id: CURRENT_USER_ID, name: "You" }],
    })
    expect(chatNotificationKind(incoming, [incoming], CURRENT_USER_ID)).toBeNull()
  })

  it("ignores unrelated chatter", () => {
    const incoming = message()
    expect(chatNotificationKind(incoming, [incoming], CURRENT_USER_ID)).toBeNull()
  })

  it("ignores replies to someone else's message", () => {
    const other = message({ id: "msg-other", authorId: "user-theo", authorName: "Theo" })
    const incoming = message({ replyToId: "msg-other" })
    expect(chatNotificationKind(incoming, [other, incoming], CURRENT_USER_ID)).toBeNull()
  })
})

describe("chatNotificationSnippet", () => {
  it("returns the trimmed body", () => {
    expect(chatNotificationSnippet(message({ body: "  hi  " }))).toBe("hi")
  })

  it("truncates long bodies", () => {
    const body = "x".repeat(120)
    expect(chatNotificationSnippet(message({ body }))).toBe(`${"x".repeat(90)}…`)
  })

  it("falls back to the first attachment name", () => {
    const incoming = message({
      body: "",
      attachments: [{ id: "att-1", name: "survey.csv", sizeBytes: 10 }],
    })
    expect(chatNotificationSnippet(incoming)).toBe("Attachment: survey.csv")
  })
})

describe("chatNotificationInput", () => {
  it("builds a mention payload linking to the project chat", () => {
    const incoming = message({ mentions: [{ id: CURRENT_USER_ID, name: "You" }] })
    const input = chatNotificationInput(incoming, "mention", channel, "prj_01")
    expect(input.id).toBe("chat_mention_msg-1")
    expect(input.type).toBe("info")
    expect(input.title).toBe("Mara mentioned you in #field-notes")
    expect(input.body).toBe("Hello there")
    expect(input.href).toBe("/projects/prj_01/chat")
    expect(input.category).toBe("mentions")
    expect(input.projectId).toBe("prj_01")
  })

  it("builds a reply payload under the activity category", () => {
    const incoming = message({ authorName: "Theo" })
    const input = chatNotificationInput(incoming, "reply", channel, "prj_01")
    expect(input.id).toBe("chat_reply_msg-1")
    expect(input.title).toBe("Theo replied to your message in #field-notes")
    expect(input.category).toBe("activity")
  })

  it("falls back to the channel id when the channel is gone", () => {
    const input = chatNotificationInput(message(), "reply", undefined, "prj_01")
    expect(input.title).toContain("#channel-field-notes")
  })
})
