// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { changelogReleases } from "@/lib/changelog"
import { clearChangelogNotifyState } from "@/lib/changelog-notify"
import { clearInAppMessages, listInbox } from "@/lib/in-app-messages"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}
const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(uid: string, email: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(method: "GET" | "POST", who: typeof adminUser = user, body?: unknown) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.40.0.${ipCounter}`,
    "content-type": "application/json",
    cookie: `${ACCESS_COOKIE}=${cookieFor(who.id, who.email)}`,
  }
  return (method === "GET" ? GET : POST)(
    new Request(`http://localhost/api/changelog/notify`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === "admin-1" ? adminUser : id === "user-1" ? user : null,
  )
  setAdminEmailsForTests(["admin@example.com"])
  clearChangelogNotifyState()
  clearInAppMessages()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/changelog/notify", () => {
  it("rejects unauthenticated requests", async () => {
    ipCounter += 1
    const response = await GET(
      new Request("http://localhost/api/changelog/notify", {
        headers: { "x-forwarded-for": `10.40.9.${ipCounter}` },
      }),
    )
    expect(response.status).toBe(401)
  })

  it("returns the caller's unseen entries and count", async () => {
    const response = await request("GET")
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.unseenCount).toBe(changelogReleases.length)
    expect(data.unseen[0]).toMatchObject({
      id: changelogReleases[0].slug,
      title: changelogReleases[0].title,
    })
    expect(data.lastSeen).toBeNull()
  })
})

describe("POST /api/changelog/notify", () => {
  it("rejects non-admin users with 403", async () => {
    const response = await request("POST", user, {})
    expect(response.status).toBe(403)
    expect(listInbox("anyone")).toHaveLength(0)
  })

  it("rejects unauthenticated requests with 401", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/changelog/notify", {
        method: "POST",
        headers: {
          "x-forwarded-for": `10.40.9.${ipCounter}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    )
    expect(response.status).toBe(401)
  })

  it("broadcasts notifications for unnotified entries, once", async () => {
    const first = await request("POST", adminUser, {})
    expect(first.status).toBe(200)
    const data = await first.json()
    expect(data.sent).toBe(changelogReleases.length)
    expect(data.skipped).toBe(0)
    expect(listInbox("user-1")).toHaveLength(changelogReleases.length)

    const second = await request("POST", adminUser, {})
    const data2 = await second.json()
    expect(data2.sent).toBe(0)
    expect(data2.skipped).toBe(changelogReleases.length)
    expect(listInbox("user-1")).toHaveLength(changelogReleases.length)
  })
})
