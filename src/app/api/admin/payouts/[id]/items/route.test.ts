// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { approveCommission, recordCommission, resetCommissionsForTests } from "@/lib/commissions"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  createPayoutRun,
  processRun,
  resetPayoutsForTests,
  upsertPayoutSettings,
} from "@/lib/payouts"

import { POST } from "./route"

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

function post(runId: string, options: { cookie?: string; origin?: string; body?: unknown } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.9.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return POST(
    new Request(`http://localhost/api/admin/payouts/${runId}/items`, {
      method: "POST",
      headers,
      ...(options.body !== undefined
        ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }
        : {}),
    }),
    { params: Promise.resolve({ id: runId }) },
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function approvedCommission(affiliateId: string) {
  const record = recordCommission({ affiliateId, amountCents: 500 })
  approveCommission(record.id)
  return record
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === "admin-1"
      ? adminUser
      : {
          id,
          email: "user@example.com",
          name: "User",
          emailVerified: true,
          createdAt: new Date().toISOString(),
        },
  )
  setAdminEmailsForTests(["admin@example.com"])
  resetPayoutsForTests()
  resetCommissionsForTests()
})

describe("POST /api/admin/payouts/[id]/items", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })
    const response = await post(run.id, { body: { affiliateId: "aff_1", amountCents: 100 } })
    expect(response.status).toBe(401)
  })

  it("rejects non-admin users with 403", async () => {
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })
    const response = await post(run.id, {
      cookie: cookieFor("user@example.com"),
      body: { affiliateId: "aff_1", amountCents: 100 },
    })
    expect(response.status).toBe(403)
  })

  it("rejects cross-origin requests with 403", async () => {
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })
    const response = await post(run.id, {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
      body: { affiliateId: "aff_1", amountCents: 100 },
    })
    expect(response.status).toBe(403)
  })

  it("returns 404 for an unknown run id", async () => {
    const response = await post("pay_missing", {
      cookie: adminCookie(),
      body: { affiliateId: "aff_1", amountCents: 100 },
    })
    expect(response.status).toBe(404)
  })

  it("returns 400 for invalid bodies", async () => {
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })
    for (const body of [
      {},
      { affiliateId: "aff_1" },
      { affiliateId: "aff_1", amountCents: 0 },
      { affiliateId: "aff_1", amountCents: 1.5 },
      { affiliateId: "aff_1", amountCents: 100, commissionIds: "com_x" },
    ]) {
      const response = await post(run.id, { cookie: adminCookie(), body })
      expect(response.status).toBe(400)
    }
  })

  it("adds a pending item to a draft run, including commission links", async () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const commission = approvedCommission("aff_1")
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })

    const response = await post(run.id, {
      cookie: adminCookie(),
      body: {
        affiliateId: "aff_1",
        amountCents: 2500,
        commissionIds: [commission.id],
      },
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.item.status).toBe("pending")
    expect(data.item.payoutId).toBe(run.id)
    expect(data.item.commissionIds).toEqual([commission.id])
  })

  it("returns 400 when a linked commission is not approved or already claimed", async () => {
    const pendingCommission = recordCommission({ affiliateId: "aff_1", amountCents: 100 })
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })

    const badStatus = await post(run.id, {
      cookie: adminCookie(),
      body: { affiliateId: "aff_1", amountCents: 100, commissionIds: [pendingCommission.id] },
    })
    expect(badStatus.status).toBe(400)

    const approved = approvedCommission("aff_1")
    const first = await post(run.id, {
      cookie: adminCookie(),
      body: { affiliateId: "aff_1", amountCents: 100, commissionIds: [approved.id] },
    })
    expect(first.status).toBe(200)

    const secondRun = createPayoutRun({ periodStart: "2025-03-01", periodEnd: "2025-04-01" })
    const claimed = await post(secondRun.id, {
      cookie: adminCookie(),
      body: { affiliateId: "aff_1", amountCents: 100, commissionIds: [approved.id] },
    })
    expect(claimed.status).toBe(400)
    expect((await claimed.json()).message).toMatch(/already claimed/)
  })

  it("returns 409 once the run is no longer draft", async () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const run = createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-02-01" })
    processRun(run.id) // empty draft run → completed (terminal)

    const response = await post(run.id, {
      cookie: adminCookie(),
      body: { affiliateId: "aff_1", amountCents: 100 },
    })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("invalid_transition")
  })
})
