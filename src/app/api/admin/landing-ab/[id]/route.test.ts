// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { createExperiment, resetLandingAbForTests, updateExperiment } from "@/lib/landing-ab"

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
let experimentId = ""

function context() {
  return { params: Promise.resolve({ id: experimentId }) }
}

function request(
  method: "GET" | "PATCH",
  body?: unknown,
  options: { cookie?: string; origin?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.6.3.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  const req = new Request(`http://localhost/api/admin/landing-ab/${experimentId}`, {
    method,
    headers,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  })
  return method === "GET" ? GET(req, context()) : PATCH(req, context())
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetLandingAbForTests()
  experimentId = createExperiment({
    name: "referral-landing",
    variants: [
      { id: "control", weight: 1 },
      { id: "treatment", weight: 1 },
    ],
  }).id
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("PATCH /api/admin/landing-ab/[id]", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await request(
      "PATCH",
      { name: "renamed" },
      { cookie: adminCookie(), origin: "https://evil.example.com" },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("PATCH", { name: "renamed" })
    expect(response.status).toBe(401)
  })

  it("updates a draft experiment for admins", async () => {
    const response = await request("PATCH", { name: "renamed" }, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiment.name).toBe("renamed")
  })

  it("concludes a running experiment with winnerVariantId", async () => {
    updateExperiment(experimentId, { status: "running" })
    const response = await request(
      "PATCH",
      { status: "completed", winnerVariantId: "treatment" },
      { cookie: adminCookie() },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiment.status).toBe("completed")
    expect(body.experiment.winnerVariantId).toBe("treatment")
  })
})
