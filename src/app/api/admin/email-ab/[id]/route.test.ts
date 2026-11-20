// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { createExperiment, resetEmailAbForTests } from "@/lib/email-ab"

import { GET, PATCH } from "./route"

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

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

function call(method: "GET" | "PATCH", id: string, body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.7.1.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const request = new Request(`http://localhost/api/admin/email-ab/${id}`, init)
  return method === "GET" ? GET(request, context(id)) : PATCH(request, context(id))
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function makeExperiment() {
  return createExperiment({
    name: "Test",
    emailKey: "welcome-day-0",
    variants: [
      { key: "control", subject: "A" },
      { key: "b", subject: "B" },
    ],
  })
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailAbForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-ab/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const experiment = makeExperiment()
    const response = await call("GET", experiment.id)
    expect(response.status).toBe(401)
  })

  it("returns the experiment for an admin and 404 for unknown ids", async () => {
    const experiment = makeExperiment()
    const response = await call("GET", experiment.id, undefined, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiment.id).toBe(experiment.id)

    const missing = await call("GET", "exp_missing", undefined, adminCookie())
    expect(missing.status).toBe(404)
  })
})

describe("PATCH /api/admin/email-ab/[id]", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    const experiment = makeExperiment()
    expect((await call("PATCH", experiment.id, { status: "running" })).status).toBe(401)
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await call(
      "PATCH",
      experiment.id,
      { status: "running" },
      cookieFor("user@example.com", "u9"),
    )
    expect(response.status).toBe(403)
  })

  it("starts a draft experiment", async () => {
    const experiment = makeExperiment()
    const response = await call("PATCH", experiment.id, { status: "running" }, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiment.status).toBe("running")
  })

  it("pauses and resumes a running experiment", async () => {
    const experiment = makeExperiment()
    await call("PATCH", experiment.id, { status: "running" }, adminCookie())
    const paused = await call("PATCH", experiment.id, { status: "paused" }, adminCookie())
    expect((await paused.json()).experiment.status).toBe("paused")
    const resumed = await call("PATCH", experiment.id, { status: "running" }, adminCookie())
    expect((await resumed.json()).experiment.status).toBe("running")
  })

  it("rejects invalid transitions", async () => {
    const experiment = makeExperiment()
    // draft → paused is not allowed.
    const response = await call("PATCH", experiment.id, { status: "paused" }, adminCookie())
    expect(response.status).toBe(400)
    // running → draft is not allowed.
    await call("PATCH", experiment.id, { status: "running" }, adminCookie())
    const back = await call("PATCH", experiment.id, { status: "draft" }, adminCookie())
    expect(back.status).toBe(400)
  })

  it("concludes with a valid winnerKey", async () => {
    const experiment = makeExperiment()
    await call("PATCH", experiment.id, { status: "running" }, adminCookie())
    const response = await call(
      "PATCH",
      experiment.id,
      { status: "concluded", winnerKey: "b" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiment.status).toBe("concluded")
    expect(body.experiment.winnerKey).toBe("b")
    expect(body.experiment.concludedAt).toBeTruthy()
  })

  it("rejects conclude without winnerKey, with a bad winner, and on drafts", async () => {
    const experiment = makeExperiment()
    await call("PATCH", experiment.id, { status: "running" }, adminCookie())

    const noWinner = await call("PATCH", experiment.id, { status: "concluded" }, adminCookie())
    expect(noWinner.status).toBe(400)

    const badWinner = await call(
      "PATCH",
      experiment.id,
      { status: "concluded", winnerKey: "nope" },
      adminCookie(),
    )
    expect(badWinner.status).toBe(400)

    const draft = makeExperiment()
    const draftConclude = await call(
      "PATCH",
      draft.id,
      { status: "concluded", winnerKey: "control" },
      adminCookie(),
    )
    expect(draftConclude.status).toBe(400)
  })

  it("rejects unknown statuses, empty bodies, and winnerKey without conclude", async () => {
    const experiment = makeExperiment()
    for (const body of [{}, { status: "bogus" }, { winnerKey: "control" }]) {
      const response = await call("PATCH", experiment.id, body, adminCookie())
      expect(response.status).toBe(400)
    }
  })

  it("returns 404 for unknown ids", async () => {
    const response = await call("PATCH", "exp_missing", { status: "running" }, adminCookie())
    expect(response.status).toBe(404)
  })

  it("returns 400 for a non-JSON body", async () => {
    ipCounter += 1
    const response = await PATCH(
      new Request("http://localhost/api/admin/email-ab/exp_x", {
        method: "PATCH",
        headers: {
          "x-forwarded-for": `10.7.1.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
        },
        body: "not json",
      }),
      context("exp_x"),
    )
    expect(response.status).toBe(400)
  })
})
