// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { changelogReleases } from "@/lib/changelog"
import {
  clearChangelogNotifyState,
  getLastSeenDate,
  getUnseenEntries,
} from "@/lib/changelog-notify"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function post(body?: unknown, authenticated = true) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.41.0.${ipCounter}`,
    "content-type": "application/json",
  }
  if (authenticated) {
    headers.cookie = `${ACCESS_COOKIE}=${
      createAccessToken({
        sid: "s1",
        uid: user.id,
        email: user.email,
        name: user.name,
      }).token
    }`
  }
  return POST(
    new Request("http://localhost/api/changelog/seen", {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(user)
  clearChangelogNotifyState()
})

describe("POST /api/changelog/seen", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post({ all: true }, false)
    expect(response.status).toBe(401)
  })

  it("marks a specific entry seen", async () => {
    const entry = changelogReleases[changelogReleases.length - 1]
    const response = await post({ entryId: entry.slug })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.lastSeen).toBe(entry.date)
    expect(getUnseenEntries("user-1").map((e) => e.id)).not.toContain(entry.slug)
  })

  it("marks everything seen with { all: true }", async () => {
    const response = await post({ all: true })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.lastSeen).toBe(changelogReleases[0].date)
    expect(getUnseenEntries("user-1")).toEqual([])
    expect(getLastSeenDate("user-1")).toBe(changelogReleases[0].date)
  })

  it("400s on an empty body", async () => {
    const response = await post()
    expect(response.status).toBe(400)
    expect(getLastSeenDate("user-1")).toBeNull()
  })

  it("404s on an unknown entryId", async () => {
    const response = await post({ entryId: "does-not-exist" })
    expect(response.status).toBe(404)
    expect(getLastSeenDate("user-1")).toBeNull()
  })

  it("400s on a missing entryId and all flag", async () => {
    const response = await post({})
    expect(response.status).toBe(400)
  })
})
