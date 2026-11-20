import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  publishNotificationEvent,
  resetNotificationHubForTests,
  subscribeNotificationEvents,
} from "@/lib/notifications/hub"
import type { NotificationStreamEvent } from "@/lib/notifications/events"

import { POST } from "./route"
import { GET } from "./stream/route"

const UID = "user-stream-test"
const PRINCIPAL = `user:${UID}`

function authCookie() {
  const { token } = createAccessToken({ sid: "sid-1", uid: UID, email: "a@b.c", name: "A" })
  return `spindle_at=${token}`
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/notifications", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function stream(cookie?: string) {
  return GET(
    new Request("http://localhost/api/notifications/stream", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

const notificationEvent: NotificationStreamEvent = {
  type: "notification",
  notification: { type: "success", title: "Live", body: "Update" },
}

beforeEach(() => {
  resetNotificationHubForTests()
})

describe("POST /api/notifications", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const listener = vi.fn()
    subscribeNotificationEvents(PRINCIPAL, listener)

    const response = await post(notificationEvent, authCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(listener).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post(notificationEvent)
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON and invalid events", async () => {
    const cookie = authCookie()
    expect((await post("{nope", cookie)).status).toBe(400)
    expect((await post({ type: "bogus" }, cookie)).status).toBe(400)
    expect(
      (await post({ type: "notification", notification: { type: "info" } }, cookie)).status,
    ).toBe(400)
  })

  it("publishes valid events to the caller's principal only", async () => {
    const cookie = authCookie()
    const mine = vi.fn()
    const other = vi.fn()
    subscribeNotificationEvents(PRINCIPAL, mine)
    subscribeNotificationEvents("user:someone-else", other)

    const response = await post(notificationEvent, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    expect(mine).toHaveBeenCalledWith(notificationEvent)
    expect(other).not.toHaveBeenCalled()
  })
})

describe("GET /api/notifications/stream", () => {
  it("rejects unauthenticated requests", () => {
    const response = stream()
    expect(response.status).toBe(401)
  })

  it("streams published events as SSE frames", async () => {
    const response = stream(authCookie())
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    // First frame is the immediate ": connected" comment.
    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain(": connected")

    publishNotificationEvent(PRINCIPAL, notificationEvent)
    const second = await reader.read()
    const frame = decoder.decode(second.value)
    expect(frame).toContain("data: ")
    expect(JSON.parse(frame.replace(/^data: /, "").trim())).toEqual(notificationEvent)

    await reader.cancel()
  })
})
