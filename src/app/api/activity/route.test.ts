import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  publishActivityEvent,
  resetActivityHubForTests,
  subscribeActivityEvents,
} from "@/lib/activity/hub"
import type { ActivityStreamEvent } from "@/lib/activity/events"

import { POST } from "./route"
import { GET } from "./stream/route"

const UID = "user-activity-stream-test"
const PRINCIPAL = `user:${UID}`

function authCookie() {
  const { token } = createAccessToken({ sid: "sid-1", uid: UID, email: "a@b.c", name: "A" })
  return `spindle_at=${token}`
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/activity", {
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
    new Request("http://localhost/api/activity/stream", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

const activityEvent: ActivityStreamEvent = {
  type: "activity",
  activity: {
    id: "act_live_1",
    projectId: "prj_01",
    kind: "chat",
    actor: { id: "user-1", name: "Bogdan" },
    summary: "sent a message",
    createdAt: "2026-11-19T12:00:00.000Z",
  },
}

beforeEach(() => {
  resetActivityHubForTests()
})

describe("POST /api/activity", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const listener = vi.fn()
    subscribeActivityEvents(PRINCIPAL, listener)

    const response = await post(activityEvent, authCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(listener).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post(activityEvent)
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON and invalid events", async () => {
    const cookie = authCookie()
    expect((await post("{nope", cookie)).status).toBe(400)
    expect((await post({ type: "bogus" }, cookie)).status).toBe(400)
    expect((await post({ type: "activity", activity: { id: "x" } }, cookie)).status).toBe(400)
  })

  it("publishes valid events to the caller's principal only", async () => {
    const cookie = authCookie()
    const mine = vi.fn()
    const other = vi.fn()
    subscribeActivityEvents(PRINCIPAL, mine)
    subscribeActivityEvents("user:someone-else", other)

    const response = await post(activityEvent, cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    expect(mine).toHaveBeenCalledWith(activityEvent)
    expect(other).not.toHaveBeenCalled()
  })
})

describe("GET /api/activity/stream", () => {
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

    publishActivityEvent(PRINCIPAL, activityEvent)
    const second = await reader.read()
    const frame = decoder.decode(second.value)
    expect(frame).toContain("data: ")
    expect(JSON.parse(frame.replace(/^data: /, "").trim())).toEqual(activityEvent)

    await reader.cancel()
  })
})
