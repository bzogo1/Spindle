// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  clearBetaAccessForTests,
  createProgram,
  enrollUser,
  updateProgramStatus,
} from "@/lib/beta-access"

import { POST } from "./route"

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

const userCookie = () => cookieFor("u1")

let ipCounter = 0

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function post(id: string, body?: unknown, cookie = userCookie(), origin = "http://localhost") {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.5.0.${ipCounter}`,
    cookie: `${ACCESS_COOKIE}=${cookie}`,
    origin,
  }
  const init: RequestInit = { method: "POST", headers }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  return POST(new Request(`http://localhost/api/beta/${id}/enroll`, init), ctx(id))
}

let programId: string

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue({ id: "u1", email: "u1@example.com" })
  clearBetaAccessForTests()
  programId = createProgram({ name: "Copilot", description: "" }).id
})

describe("POST /api/beta/[id]/enroll", () => {
  it("rejects cross-origin requests with 403", async () => {
    const response = await post(programId, { enrolled: true }, userCookie(), "https://evil.example")
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests with 401", async () => {
    ipCounter += 1
    const bare = await POST(
      new Request(`http://localhost/api/beta/${programId}/enroll`, {
        method: "POST",
        headers: {
          "x-forwarded-for": `10.5.0.${ipCounter}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enrolled: true }),
      }),
      ctx(programId),
    )
    expect(bare.status).toBe(401)
    expect(await bare.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns 404 for a missing program", async () => {
    const response = await post("beta_missing", { enrolled: true })
    expect(response.status).toBe(404)
  })

  it("enrolls and unenrolls the caller", async () => {
    const enrolled = await post(programId, { enrolled: true })
    expect(enrolled.status).toBe(200)
    expect(await enrolled.json()).toMatchObject({ ok: true, programId, enrolled: true })

    // Idempotent re-enroll.
    const again = await post(programId, { enrolled: true })
    expect((await again.json()).enrolled).toBe(true)

    const unenrolled = await post(programId, { enrolled: false })
    expect((await unenrolled.json()).enrolled).toBe(false)
  })

  it("blocks enrolling into a closed program but allows leaving", async () => {
    updateProgramStatus(programId, "closed")
    const blocked = await post(programId, { enrolled: true })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ ok: false, code: "program_closed" })

    enrollUser(programId, "user:u1")
    const leave = await post(programId, { enrolled: false })
    expect(leave.status).toBe(200)
    expect((await leave.json()).enrolled).toBe(false)
  })

  it("rejects invalid bodies", async () => {
    const response = await post(programId, { enrolled: "yes" })
    expect(response.status).toBe(400)

    ipCounter += 1
    const notJson = await POST(
      new Request(`http://localhost/api/beta/${programId}/enroll`, {
        method: "POST",
        headers: {
          "x-forwarded-for": `10.5.0.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${userCookie()}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: "nope",
      }),
      ctx(programId),
    )
    expect(notJson.status).toBe(400)
  })
})
