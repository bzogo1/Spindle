// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  approveCommission,
  recordCommission,
  resetCommissionsForTests,
  voidCommission,
} from "./commissions"
import {
  DEFAULT_MINIMUM_THRESHOLD_CENTS,
  PAYOUT_ITEMS_PER_RUN_MAX,
  PAYOUT_RUNS_STORE_MAX,
  PAYOUT_RUN_STATUSES,
  PayoutTransitionError,
  PayoutValidationError,
  SIMULATED_PAYOUT_ITEM_MAX_CENTS,
  addItemToRun,
  createPayoutRun,
  getPayoutSettings,
  getRun,
  listRuns,
  processRun,
  resetPayoutsForTests,
  upsertPayoutSettings,
} from "./payouts"

const PERIOD = { periodStart: "2025-01-01", periodEnd: "2025-02-01" }

function approvedCommission(affiliateId: string, amountCents = 1000) {
  const record = recordCommission({ affiliateId, amountCents })
  approveCommission(record.id)
  return record
}

beforeEach(() => {
  resetPayoutsForTests()
  resetCommissionsForTests()
})

describe("createPayoutRun", () => {
  it("creates a draft run with normalized ISO bounds", () => {
    const run = createPayoutRun(PERIOD)
    expect(run.id).toMatch(/^pay_/)
    expect(run.status).toBe("draft")
    expect(run.periodStart).toBe("2025-01-01T00:00:00.000Z")
    expect(run.periodEnd).toBe("2025-02-01T00:00:00.000Z")
    expect(run.createdAt).toBeTruthy()
    expect(run.completedAt).toBeUndefined()
  })

  it("rejects inverted, equal, and unparseable periods", () => {
    expect(() => createPayoutRun({ periodStart: "2025-02-01", periodEnd: "2025-01-01" })).toThrow(
      PayoutValidationError,
    )
    expect(() => createPayoutRun({ periodStart: "2025-01-01", periodEnd: "2025-01-01" })).toThrow(
      /before periodEnd/,
    )
    expect(() => createPayoutRun({ periodStart: "nope", periodEnd: "2025-01-01" })).toThrow(
      /valid dates/,
    )
  })

  it("rejects periods longer than the max span", () => {
    expect(() => createPayoutRun({ periodStart: "2024-01-01", periodEnd: "2026-01-01" })).toThrow(
      /at most/,
    )
  })

  it("enforces the runs store bound", () => {
    for (let i = 0; i < PAYOUT_RUNS_STORE_MAX; i += 1) {
      createPayoutRun(PERIOD)
    }
    expect(() => createPayoutRun(PERIOD)).toThrow(/capacity/)
  })
})

describe("addItemToRun", () => {
  it("adds a pending item to a draft run", () => {
    const run = createPayoutRun(PERIOD)
    const item = addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 2500 })
    expect(item.id).toMatch(/^pai_/)
    expect(item.payoutId).toBe(run.id)
    expect(item.status).toBe("pending")
    expect(item.amountCents).toBe(2500)
    expect(item.commissionIds).toEqual([])
  })

  it("validates affiliate id and amount", () => {
    const run = createPayoutRun(PERIOD)
    expect(() => addItemToRun(run.id, { affiliateId: " ", amountCents: 100 })).toThrow(
      /affiliate id/,
    )
    expect(() => addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 0 })).toThrow(
      /positive integer/,
    )
    expect(() => addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1.5 })).toThrow(
      /positive integer/,
    )
  })

  it("links approved commissions belonging to the same affiliate", () => {
    const run = createPayoutRun(PERIOD)
    const commission = approvedCommission("aff_1", 4000)
    const item = addItemToRun(run.id, {
      affiliateId: "aff_1",
      amountCents: 4000,
      commissionIds: [commission.id, commission.id], // deduped
    })
    expect(item.commissionIds).toEqual([commission.id])
  })

  it("rejects unknown, foreign, non-approved, and double-claimed commissions", () => {
    const run = createPayoutRun(PERIOD)
    const otherRun = createPayoutRun({ periodStart: "2025-03-01", periodEnd: "2025-04-01" })
    const approved = approvedCommission("aff_1")
    const pendingOnly = recordCommission({ affiliateId: "aff_1", amountCents: 10 })
    const foreign = approvedCommission("aff_2")

    expect(() =>
      addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1, commissionIds: ["com_nope"] }),
    ).toThrow(/does not exist/)
    expect(() =>
      addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1, commissionIds: [foreign.id] }),
    ).toThrow(/different affiliate/)
    expect(() =>
      addItemToRun(run.id, {
        affiliateId: "aff_1",
        amountCents: 1,
        commissionIds: [pendingOnly.id],
      }),
    ).toThrow(/only approved/)

    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1, commissionIds: [approved.id] })
    expect(() =>
      addItemToRun(otherRun.id, {
        affiliateId: "aff_1",
        amountCents: 1,
        commissionIds: [approved.id],
      }),
    ).toThrow(/already claimed/)
  })

  it("releases commission claims when an item fails", () => {
    upsertPayoutSettings("aff_1", { method: null })
    const run = createPayoutRun(PERIOD)
    const retryRun = createPayoutRun({ periodStart: "2025-03-01", periodEnd: "2025-04-01" })
    const commission = approvedCommission("aff_1")
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1, commissionIds: [commission.id] })
    processRun(run.id)

    // First run failed (no method) → claim released → second run may claim it.
    expect(getRun(run.id)?.items[0]?.status).toBe("failed")
    const item = addItemToRun(retryRun.id, {
      affiliateId: "aff_1",
      amountCents: 1,
      commissionIds: [commission.id],
    })
    expect(item.commissionIds).toEqual([commission.id])
  })

  it("enforces the per-run item bound", () => {
    const run = createPayoutRun(PERIOD)
    for (let i = 0; i < PAYOUT_ITEMS_PER_RUN_MAX; i += 1) {
      addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1 })
    }
    expect(() => addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 1 })).toThrow(
      /item limit/,
    )
  })
})

describe("processRun (SIMULATED — no real money moves)", () => {
  it("pays items when a payout method is configured", () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 2500 })
    addItemToRun(run.id, { affiliateId: "aff_2", amountCents: 100 }) // no settings → fails

    const processed = processRun(run.id)
    expect(processed.status).toBe("failed") // aff_2 has no method
    expect(processed.completedAt).toBeTruthy()

    const detail = getRun(run.id)
    expect(detail?.items[0]?.status).toBe("paid")
    expect(detail?.items[0]?.failureReason).toBeUndefined()
    expect(detail?.items[1]?.status).toBe("failed")
    expect(detail?.items[1]?.failureReason).toMatch(/No payout method/)
  })

  it("completes when every item pays", () => {
    upsertPayoutSettings("aff_1", { method: "bank_transfer" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })
    expect(processRun(run.id).status).toBe("completed")
    expect(getRun(run.id)?.items[0]?.status).toBe("paid")
  })

  it("fails items over the simulated limit deterministically", () => {
    upsertPayoutSettings("aff_1", { method: "manual" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: SIMULATED_PAYOUT_ITEM_MAX_CENTS + 1 })
    processRun(run.id)
    const item = getRun(run.id)?.items[0]
    expect(item?.status).toBe("failed")
    expect(item?.failureReason).toMatch(/simulated payout limit/)
  })

  it("treats a cleared method as unconfigured", () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    upsertPayoutSettings("aff_1", { method: null })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })
    processRun(run.id)
    expect(getRun(run.id)?.items[0]?.failureReason).toMatch(/No payout method/)
  })

  it("is terminal once completed and rejects double-processing", () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })
    processRun(run.id)
    expect(() => processRun(run.id)).toThrow(PayoutTransitionError)
    expect(() => processRun(run.id)).toThrow(/status "completed"/)
  })

  it("retries a failed run: only failed items are re-evaluated", () => {
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_ok", amountCents: 100 })
    addItemToRun(run.id, { affiliateId: "aff_bad", amountCents: 100 })

    // Only aff_ok has a method → run fails on aff_bad.
    upsertPayoutSettings("aff_ok", { method: "paypal" })
    expect(processRun(run.id).status).toBe("failed")

    // Fix settings and retry: aff_bad pays, aff_ok stays paid (not re-run).
    upsertPayoutSettings("aff_bad", { method: "manual" })
    const retried = processRun(run.id)
    expect(retried.status).toBe("completed")
    const items = getRun(run.id)?.items ?? []
    expect(items.every((item) => item.status === "paid")).toBe(true)
    expect(items.every((item) => item.failureReason === undefined)).toBe(true)
  })

  it("stamps paidAt on paid items and preserves it across retries", () => {
    vi.useFakeTimers()
    try {
      const run = createPayoutRun(PERIOD)
      addItemToRun(run.id, { affiliateId: "aff_ok", amountCents: 100 })
      addItemToRun(run.id, { affiliateId: "aff_bad", amountCents: 100 })
      upsertPayoutSettings("aff_ok", { method: "paypal" })

      // First processing in December: aff_ok pays, aff_bad fails.
      vi.setSystemTime(new Date("2024-12-31T12:00:00.000Z"))
      expect(processRun(run.id).status).toBe("failed")
      const itemsAfterFirst = getRun(run.id)?.items ?? []
      const paidItem = itemsAfterFirst.find((item) => item.affiliateId === "aff_ok")
      const failedItem = itemsAfterFirst.find((item) => item.affiliateId === "aff_bad")
      expect(paidItem?.status).toBe("paid")
      expect(paidItem?.paidAt).toBe("2024-12-31T12:00:00.000Z")
      expect(failedItem?.status).toBe("failed")
      expect(failedItem?.paidAt).toBeUndefined()

      // Retry in January: aff_bad pays now; aff_ok's paidAt must NOT move —
      // tax reporting attributes it to the December payment, not the retry.
      vi.setSystemTime(new Date("2025-01-05T12:00:00.000Z"))
      upsertPayoutSettings("aff_bad", { method: "manual" })
      expect(processRun(run.id).status).toBe("completed")
      const itemsAfterRetry = getRun(run.id)?.items ?? []
      expect(itemsAfterRetry.find((item) => item.affiliateId === "aff_ok")?.paidAt).toBe(
        "2024-12-31T12:00:00.000Z",
      )
      expect(itemsAfterRetry.find((item) => item.affiliateId === "aff_bad")?.paidAt).toBe(
        "2025-01-05T12:00:00.000Z",
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("still fails on retry while the problem persists", () => {
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })
    processRun(run.id)
    expect(processRun(run.id).status).toBe("failed")
  })

  it("does not double-pay when a failed item's commission is claimed and paid by another run", () => {
    const commission = approvedCommission("aff_1")

    // Run A fails (no payout method) → its claim on the commission is released.
    const runA = createPayoutRun(PERIOD)
    const itemA = addItemToRun(runA.id, {
      affiliateId: "aff_1",
      amountCents: 1000,
      commissionIds: [commission.id],
    })
    expect(processRun(runA.id).status).toBe("failed")
    expect(getRun(runA.id)?.items[0]?.status).toBe("failed")

    // Run B re-claims the released commission and pays it out.
    const runB = createPayoutRun({ periodStart: "2025-03-01", periodEnd: "2025-04-01" })
    addItemToRun(runB.id, {
      affiliateId: "aff_1",
      amountCents: 1000,
      commissionIds: [commission.id],
    })
    upsertPayoutSettings("aff_1", { method: "paypal" })
    expect(processRun(runB.id).status).toBe("completed")
    expect(getRun(runB.id)?.items[0]?.status).toBe("paid")

    // Retrying run A must NOT pay the same commission a second time.
    expect(processRun(runA.id).status).toBe("failed")
    const retried = getRun(runA.id)?.items.find((item) => item.id === itemA.id)
    expect(retried?.status).toBe("failed")
    expect(retried?.failureReason).toMatch(/already claimed/)
  })

  it("fails an item at payment time when a linked commission is no longer approved", () => {
    const commission = approvedCommission("aff_1")
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, {
      affiliateId: "aff_1",
      amountCents: 1000,
      commissionIds: [commission.id],
    })

    // The commission is voided AFTER the item was added — the add-time
    // status check cannot see this, so processRun must revalidate.
    voidCommission(commission.id)

    expect(processRun(run.id).status).toBe("failed")
    const item = getRun(run.id)?.items[0]
    expect(item?.status).toBe("failed")
    expect(item?.failureReason).toMatch(/no longer approved/)
  })

  it("rejects adding items once processing has started", () => {
    upsertPayoutSettings("aff_1", { method: "paypal" })
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })
    processRun(run.id)
    expect(() => addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })).toThrow(
      PayoutTransitionError,
    )
    expect(() => addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 100 })).toThrow(
      /status "completed"/,
    )
  })

  it("throws validation for unknown run ids", () => {
    expect(() => processRun("pay_nope")).toThrow(PayoutValidationError)
    expect(() => addItemToRun("pay_nope", { affiliateId: "a", amountCents: 1 })).toThrow(
      PayoutValidationError,
    )
  })
})

describe("listRuns / getRun", () => {
  it("lists runs newest first with optional status filter", () => {
    const first = createPayoutRun(PERIOD)
    const second = createPayoutRun({ periodStart: "2025-03-01", periodEnd: "2025-04-01" })
    processRun(first.id) // draft run with no items → completed

    const all = listRuns()
    expect(all.map((run) => run.id)).toEqual([second.id, first.id])
    expect(listRuns("completed").map((run) => run.id)).toEqual([first.id])
    expect(listRuns("draft").map((run) => run.id)).toEqual([second.id])
    expect(listRuns("failed")).toEqual([])
  })

  it("returns run detail with items, or null for unknown ids", () => {
    const run = createPayoutRun(PERIOD)
    addItemToRun(run.id, { affiliateId: "aff_1", amountCents: 500 })
    const detail = getRun(run.id)
    expect(detail?.run.id).toBe(run.id)
    expect(detail?.items).toHaveLength(1)
    expect(getRun("pay_nope")).toBeNull()
  })

  it("exposes the documented status unions", () => {
    expect(PAYOUT_RUN_STATUSES).toEqual(["draft", "processing", "completed", "failed"])
  })
})

describe("payout settings", () => {
  it("returns null before configuration and defaults after first write", () => {
    expect(getPayoutSettings("aff_1")).toBeNull()
    const settings = upsertPayoutSettings("aff_1", { method: "paypal" })
    expect(settings.method).toBe("paypal")
    expect(settings.minimumThresholdCents).toBe(DEFAULT_MINIMUM_THRESHOLD_CENTS)
    expect(settings.schedule).toBe("manual")
  })

  it("partially updates only provided fields", () => {
    upsertPayoutSettings("aff_1", { method: "bank_transfer", schedule: "weekly" })
    const updated = upsertPayoutSettings("aff_1", { minimumThresholdCents: 20_000 })
    expect(updated.method).toBe("bank_transfer")
    expect(updated.schedule).toBe("weekly")
    expect(updated.minimumThresholdCents).toBe(20_000)
  })

  it("validates method, threshold, and schedule", () => {
    expect(() => upsertPayoutSettings("aff_1", { method: "crypto" as never })).toThrow(
      PayoutValidationError,
    )
    expect(() => upsertPayoutSettings("aff_1", { minimumThresholdCents: -1 })).toThrow(
      /non-negative/,
    )
    expect(() => upsertPayoutSettings("aff_1", { schedule: "daily" as never })).toThrow(/schedule/)
    expect(() => upsertPayoutSettings(" ", {})).toThrow(/affiliate id/)
  })

  it("stores method labels only — no account fields exist on the type", () => {
    const settings = upsertPayoutSettings("aff_1", { method: "manual" })
    expect(Object.keys(settings).sort()).toEqual(
      ["affiliateId", "method", "minimumThresholdCents", "schedule"].sort(),
    )
  })
})
