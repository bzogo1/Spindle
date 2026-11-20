// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearBetaAccessForTests, createProgram, enrollUser } from "@/lib/beta-access"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

function cookieFor(uid: string, email = `${uid}@example.com`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function get(cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.6.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request("http://localhost/api/beta", { headers }))
}

beforeEach(() => {
  getUserById.mockReset()
  clearBetaAccessForTests()
})

describe("GET /api/beta", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns open programs plus enrolled closed ones, with enrollment flags", async () => {
    getUserById.mockResolvedValue({ id: "u1", email: "u1@example.com" })
    const open = createProgram({ name: "Open one", description: "" })
    const other = createProgram({ name: "Other", description: "" })
    const closed = createProgram({ name: "Closed", description: "" })
    const closedJoined = createProgram({ name: "Closed joined", description: "" })
    const { updateProgramStatus } = await import("@/lib/beta-access")
    updateProgramStatus(closed.id, "closed")
    updateProgramStatus(closedJoined.id, "closed")
    enrollUser(open.id, "user:u1")
    enrollUser(other.id, "user:u2")
    enrollUser(closedJoined.id, "user:u1")

    const response = await get(cookieFor("u1"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    const byId = Object.fromEntries(body.programs.map((p: { id: string }) => [p.id, p]))
    expect(byId[open.id]).toMatchObject({ name: "Open one", enrolled: true })
    expect(byId[other.id]).toMatchObject({ enrolled: false })
    // Closed + not enrolled stays hidden; closed + enrolled is returned so
    // the caller can still unenroll.
    expect(byId[closed.id]).toBeUndefined()
    expect(byId[closedJoined.id]).toMatchObject({
      name: "Closed joined",
      status: "closed",
      enrolled: true,
    })
    // enrolledCount reflects all enrollees, not just the caller.
    expect(byId[other.id].enrolledCount).toBe(1)
  })

  it("returns an empty list when the user has no programs", async () => {
    getUserById.mockResolvedValue({ id: "u1", email: "u1@example.com" })
    const response = await get(cookieFor("u1"))
    expect(response.status).toBe(200)
    expect((await response.json()).programs).toEqual([])
  })
})
