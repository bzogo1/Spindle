// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import {
  clearAnnouncementsForTests,
  createAnnouncement,
  listActiveAnnouncements,
} from "@/lib/announcements"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "../route"
import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = { id: "u1", email: "user@example.com", name: "User" }

function cookieFor(uid = "u1", email = "user@example.com") {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function post(body: unknown, options: { cookie?: string; origin?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.4.${ipCounter}`,
    "content-type": "application/json",
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return POST(
    new Request("http://localhost/api/announcements/dismiss", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(user)
  setAdminEmailsForTests(["admin@example.com"])
  clearAnnouncementsForTests()
})

describe("POST /api/announcements/dismiss", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post(
      { id: "ann_1" },
      {
        cookie: cookieFor(),
        origin: "https://evil.example.com",
      },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await post({ id: "ann_1" })
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON and invalid bodies", async () => {
    const cookie = cookieFor()
    expect((await post("{oops", { cookie })).status).toBe(400)
    expect((await post({}, { cookie })).status).toBe(400)
    expect((await post({ id: "" }, { cookie })).status).toBe(400)
  })

  it("dismisses an announcement for the caller and is idempotent", async () => {
    const announcement = createAnnouncement({
      title: "Bye",
      body: "Body",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const cookie = cookieFor()

    const first = await post({ id: announcement.id }, { cookie })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, dismissed: true })

    // Second dismiss of the same id still succeeds.
    const second = await post({ id: announcement.id }, { cookie })
    expect(second.status).toBe(200)

    // Unknown ids are accepted too (idempotent).
    const third = await post({ id: "ann_missing" }, { cookie })
    expect(third.status).toBe(200)

    // The announcement no longer shows up for this user…
    expect(listActiveAnnouncements("user:u1", false)).toEqual([])
    // …but another user still sees it.
    expect(listActiveAnnouncements("user:u2", false)).toHaveLength(1)
  })

  it("dismissal via the API hides the announcement from GET /api/announcements", async () => {
    const announcement = createAnnouncement({
      title: "Hidden",
      body: "Body",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const cookie = cookieFor()

    ipCounter += 1
    const before = await GET(
      new Request("http://localhost/api/announcements", {
        headers: { "x-forwarded-for": `10.9.4.${ipCounter}`, cookie: `${ACCESS_COOKIE}=${cookie}` },
      }),
    )
    expect((await before.json()).announcements).toHaveLength(1)

    await post({ id: announcement.id }, { cookie })

    ipCounter += 1
    const after = await GET(
      new Request("http://localhost/api/announcements", {
        headers: { "x-forwarded-for": `10.9.4.${ipCounter}`, cookie: `${ACCESS_COOKIE}=${cookie}` },
      }),
    )
    expect((await after.json()).announcements).toEqual([])
  })
})
