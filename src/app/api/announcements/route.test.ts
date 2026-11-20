// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import {
  clearAnnouncementsForTests,
  createAnnouncement,
  dismissAnnouncement,
} from "@/lib/announcements"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = { id: "u1", email: "user@example.com", name: "User" }
const adminUser = { id: "admin-1", email: "admin@example.com", name: "Admin" }

function cookieFor(uid: string, email: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function get(cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.3.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request("http://localhost/api/announcements", { headers }))
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (uid: string) => (uid === "admin-1" ? adminUser : user))
  setAdminEmailsForTests(["admin@example.com"])
  clearAnnouncementsForTests()
})

describe("GET /api/announcements", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns active announcements for a regular user", async () => {
    createAnnouncement({
      title: "Hello",
      body: "Body",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })
    createAnnouncement({
      title: "Admins only",
      body: "Body",
      audience: "admins",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })

    const response = await get(cookieFor("u1", "user@example.com"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.announcements.map((a: { title: string }) => a.title)).toEqual(["Hello"])
  })

  it("includes admin-audience announcements for admins", async () => {
    createAnnouncement({
      title: "Admins only",
      body: "Body",
      audience: "admins",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })

    const response = await get(cookieFor("admin-1", "admin@example.com"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.announcements).toHaveLength(1)
    expect(body.announcements[0].audience).toBe("admins")
  })

  it("excludes announcements the caller dismissed", async () => {
    const announcement = createAnnouncement({
      title: "Dismiss me",
      body: "Body",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    })
    dismissAnnouncement("user:u1", announcement.id)

    const response = await get(cookieFor("u1", "user@example.com"))
    expect(response.status).toBe(200)
    expect((await response.json()).announcements).toEqual([])
  })

  it("returns 401 when the token is valid but the user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(cookieFor("ghost", "ghost@example.com"))
    expect(response.status).toBe(401)
  })
})
