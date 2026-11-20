import { beforeEach, describe, expect, it } from "vitest"

import {
  clearInAppMessages,
  listInbox,
  listSentMessages,
  markAllRead,
  markRead,
  sendMessage,
  unreadCount,
} from "./in-app-messages"

beforeEach(() => {
  clearInAppMessages()
})

describe("sendMessage / listInbox", () => {
  it("delivers direct messages only to their recipient", () => {
    sendMessage({ userId: "user-a", subject: "Hi", body: "For A", kind: "info" })
    sendMessage({ userId: "user-b", subject: "Hi", body: "For B", kind: "info" })

    const inboxA = listInbox("user-a")
    expect(inboxA).toHaveLength(1)
    expect(inboxA[0].body).toBe("For A")
    expect(inboxA[0].read).toBe(false)

    expect(listInbox("user-b")[0].body).toBe("For B")
    expect(listInbox("user-c")).toHaveLength(0)
  })

  it("delivers broadcasts (userId null) to every inbox", () => {
    sendMessage({ subject: "Maintenance", body: "Tonight 22:00", kind: "warning" })
    sendMessage({ userId: "user-a", subject: "Direct", body: "Only A", kind: "info" })

    expect(listInbox("user-a")).toHaveLength(2)
    expect(listInbox("user-b")).toHaveLength(1)
    expect(listInbox("user-b")[0].userId).toBeNull()
  })

  it("returns newest first and honours the limit", () => {
    sendMessage({ userId: "user-a", subject: "One", body: "1", kind: "info" })
    sendMessage({ userId: "user-a", subject: "Two", body: "2", kind: "info" })
    sendMessage({ userId: "user-a", subject: "Three", body: "3", kind: "info" })

    const inbox = listInbox("user-a", 2)
    expect(inbox.map((m) => m.subject)).toEqual(["Three", "Two"])
  })

  it("trims subject and body and normalizes empty userId to broadcast", () => {
    const message = sendMessage({
      userId: "   ",
      subject: "  Subject  ",
      body: "  Body  ",
      kind: "success",
    })
    expect(message.userId).toBeNull()
    expect(message.subject).toBe("Subject")
    expect(message.body).toBe("Body")
  })
})

describe("read state", () => {
  it("unreadCount counts only messages visible to the user that are unread", () => {
    sendMessage({ userId: "user-a", subject: "A1", body: "1", kind: "info" })
    sendMessage({ subject: "All", body: "everyone", kind: "info" })
    sendMessage({ userId: "user-b", subject: "B1", body: "1", kind: "info" })

    expect(unreadCount("user-a")).toBe(2)
    expect(unreadCount("user-b")).toBe(2)
    expect(unreadCount("user-c")).toBe(1)
  })

  it("markRead is per-user and idempotent", () => {
    const message = sendMessage({ subject: "All", body: "everyone", kind: "info" })

    expect(markRead("user-a", message.id)).toBe(true)
    expect(markRead("user-a", message.id)).toBe(true)

    const inboxA = listInbox("user-a")
    expect(inboxA[0].read).toBe(true)
    expect(inboxA[0].readAt).toBeTruthy()
    // user-b still sees it unread.
    expect(listInbox("user-b")[0].read).toBe(false)
    expect(unreadCount("user-a")).toBe(0)
    expect(unreadCount("user-b")).toBe(1)
  })

  it("markRead rejects unknown ids and messages not visible to the user", () => {
    const direct = sendMessage({ userId: "user-a", subject: "A", body: "a", kind: "info" })

    expect(markRead("user-a", "msg_missing")).toBe(false)
    expect(markRead("user-b", direct.id)).toBe(false)
  })

  it("markAllRead marks every visible unread message and reports the count", () => {
    sendMessage({ userId: "user-a", subject: "A1", body: "1", kind: "info" })
    sendMessage({ userId: "user-a", subject: "A2", body: "2", kind: "info" })
    sendMessage({ subject: "All", body: "everyone", kind: "info" })
    sendMessage({ userId: "user-b", subject: "B1", body: "1", kind: "info" })

    expect(markAllRead("user-a")).toBe(3)
    expect(unreadCount("user-a")).toBe(0)
    // Second call is a no-op; other users unaffected.
    expect(markAllRead("user-a")).toBe(0)
    expect(unreadCount("user-b")).toBe(2)
  })
})

describe("listSentMessages", () => {
  it("returns only direct messages, newest first", () => {
    sendMessage({ subject: "Broadcast", body: "all", kind: "info" })
    sendMessage({ userId: "user-a", subject: "To A", body: "a", kind: "info" })
    sendMessage({ userId: "user-b", subject: "To B", body: "b", kind: "warning" })

    const sent = listSentMessages()
    expect(sent).toHaveLength(2)
    expect(sent.every((m) => m.userId !== null)).toBe(true)
    expect(sent.map((m) => m.kind)).toEqual(["warning", "info"])

    expect(listSentMessages(1)).toHaveLength(1)
  })
})
