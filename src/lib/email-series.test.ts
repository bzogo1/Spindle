import { beforeEach, describe, expect, it, vi } from "vitest"

const sendSeriesEmail = vi.fn()

vi.mock("@/lib/auth/mailer", () => ({
  sendSeriesEmail: (...args: unknown[]) => sendSeriesEmail(...args),
}))

import { clearUnsubscribeStore, unsubscribeAddress } from "@/lib/email-unsubscribe"
import {
  resetCommunicationPreferencesForTests,
  updateCommunicationPreferences,
} from "@/lib/communication-preferences"
import {
  cancelEmailSeriesForEmail,
  EMAIL_SERIES_MAX_STEP_FAILURES,
  EMAIL_SERIES_RETRY_DELAY_MS,
  EMAIL_SERIES_UNSUBSCRIBE_SCOPE,
  EMAIL_SERIES_UNSUBSCRIBE_SCOPE as SCOPE,
  enrollEmailSeries,
  getEmailSeriesEnrollment,
  processEmailSeriesQueue,
  resetEmailSeriesForTests,
  WELCOME_SERIES_ID,
  WELCOME_SERIES_STEPS,
} from "./email-series"

const T0 = Date.parse("2025-06-01T00:00:00Z")
const DAY = 24 * 60 * 60 * 1000

function tick(now: number, send = sendSeriesEmail) {
  return processEmailSeriesQueue({ now, send })
}

beforeEach(() => {
  resetEmailSeriesForTests()
  clearUnsubscribeStore()
  resetCommunicationPreferencesForTests()
  sendSeriesEmail.mockReset()
  sendSeriesEmail.mockResolvedValue("sent")
})

describe("enrollEmailSeries", () => {
  it("creates an active enrollment due immediately for step 0", () => {
    const { enrollment, alreadyEnrolled } = enrollEmailSeries({
      email: "Ada@Example.com",
      name: "Ada",
      principal: "user:u1",
      now: T0,
    })
    expect(alreadyEnrolled).toBe(false)
    expect(enrollment.email).toBe("ada@example.com")
    expect(enrollment.status).toBe("active")
    expect(enrollment.nextStepIndex).toBe(0)
    expect(enrollment.nextSendAt).toBe(T0)
    expect(enrollment.sentSteps).toEqual([])
  })

  it("is idempotent — repeat enrollment returns the same record untouched", () => {
    const first = enrollEmailSeries({ email: "a@b.c", now: T0 })
    const second = enrollEmailSeries({ email: "A@B.C", now: T0 + DAY })
    expect(second.alreadyEnrolled).toBe(true)
    expect(second.enrollment.enrolledAt).toBe(first.enrollment.enrolledAt)
    expect(second.enrollment.nextSendAt).toBe(T0)
  })

  it("never resurrects a finished or cancelled enrollment", () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    cancelEmailSeriesForEmail("a@b.c")
    const again = enrollEmailSeries({ email: "a@b.c", now: T0 + 100 })
    expect(again.alreadyEnrolled).toBe(true)
    expect(again.enrollment.status).toBe("cancelled")
  })

  it("rejects unknown series ids and empty emails", () => {
    expect(() => enrollEmailSeries({ email: "a@b.c", seriesId: "nope" })).toThrow(
      /Unknown email series/,
    )
    expect(() => enrollEmailSeries({ email: "   " })).toThrow(/email/)
  })
})

describe("processEmailSeriesQueue — state machine", () => {
  it("sends due steps in order and spaces them by the defined delays", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })

    // Tick at T0: day-0 welcome goes out; next step due at T0 + 3d.
    const first = await tick(T0)
    expect(first.sent).toBe(1)
    let state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.sentSteps).toEqual(["welcome"])
    expect(state.nextStepIndex).toBe(1)
    expect(state.nextSendAt).toBe(T0 + 3 * DAY)
    expect(state.status).toBe("active")

    // Before the delay elapses nothing sends.
    const early = await tick(T0 + 3 * DAY - 1)
    expect(early.checked).toBe(0)
    expect(early.sent).toBe(0)

    // At the delay the tips email sends; next is +7d from that send.
    const second = await tick(T0 + 3 * DAY)
    expect(second.sent).toBe(1)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.sentSteps).toEqual(["welcome", "tips"])
    expect(state.nextSendAt).toBe(T0 + 3 * DAY + 7 * DAY)

    // Finish the series: checklist due T0+10d, upgrade due T0+24d.
    await tick(T0 + 10 * DAY)
    await tick(T0 + 24 * DAY)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.status).toBe("completed")
    expect(state.sentSteps).toEqual(["welcome", "tips", "checklist", "upgrade"])
    expect(state.nextSendAt).toBe(Number.POSITIVE_INFINITY)
  })

  it("does not send anything before enrollment or before nextSendAt", async () => {
    const summary = await tick(T0)
    expect(summary).toMatchObject({ checked: 0, sent: 0 })
  })

  it("processes multiple enrollments and respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      enrollEmailSeries({ email: `u${i}@b.c`, now: T0 })
    }
    const limited = await processEmailSeriesQueue({ now: T0, limit: 2, send: sendSeriesEmail })
    expect(limited.checked).toBe(2)
    expect(limited.sent).toBe(2)
    expect(sendSeriesEmail).toHaveBeenCalledTimes(2)

    const rest = await tick(T0 + 1)
    expect(rest.sent).toBe(3)
  })
})

describe("processEmailSeriesQueue — gating", () => {
  it("stops the series when the address unsubscribed from the series scope", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    unsubscribeAddress("a@b.c", EMAIL_SERIES_UNSUBSCRIBE_SCOPE)

    const summary = await tick(T0)
    expect(summary.sent).toBe(0)
    expect(summary.skipped).toBe(1)
    const state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.status).toBe("unsubscribed")
    expect(sendSeriesEmail).not.toHaveBeenCalled()
  })

  it("stops the series on a catch-all 'all' unsubscribe", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    unsubscribeAddress("a@b.c", "all")
    await tick(T0)
    expect(getEmailSeriesEnrollment("a@b.c")!.status).toBe("unsubscribed")
  })

  it("still sends to addresses unsubscribed from unrelated scopes", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    unsubscribeAddress("a@b.c", "newsletter")
    const summary = await tick(T0)
    expect(summary.sent).toBe(1)
  })

  it("skips productUpdates-gated steps when the preference is off", async () => {
    enrollEmailSeries({ email: "a@b.c", principal: "user:u1", now: T0 })
    updateCommunicationPreferences("user:u1", { productUpdates: false })

    // day-0 welcome is not gated; tips/checklist/upgrade are.
    await tick(T0)
    let state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.sentSteps).toEqual(["welcome"])

    await tick(T0 + 3 * DAY)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.skippedSteps).toContain("tips")
    expect(state.sentSteps).toEqual(["welcome"])
    expect(sendSeriesEmail).toHaveBeenCalledTimes(1)

    await tick(T0 + 10 * DAY)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.skippedSteps).toEqual(["tips", "checklist"])

    // upgrade was due T0+24d (14d after the checklist skip at T0+10d).
    await tick(T0 + 24 * DAY)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.status).toBe("completed")
    expect(state.skippedSteps).toEqual(["tips", "checklist", "upgrade"])
    expect(sendSeriesEmail).toHaveBeenCalledTimes(1)
  })

  it("sends gated steps when no principal is known (preference unreadable)", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 }) // no principal
    await tick(T0)
    await tick(T0 + 3 * DAY)
    const state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.sentSteps).toEqual(["welcome", "tips"])
  })

  it("embeds a signed unsubscribe URL in every sent email", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    await tick(T0)
    const message = sendSeriesEmail.mock.calls[0][0]
    expect(message.html).toContain("/unsubscribe?token=")
    expect(message.html).toContain("Unsubscribe")
    expect(message.text).toContain("Unsubscribe: http")
  })
})

describe("processEmailSeriesQueue — failures", () => {
  it("retries a failed send after the retry delay, then abandons after max failures", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    sendSeriesEmail.mockRejectedValue(new Error("resend down"))

    const first = await tick(T0)
    expect(first.sent).toBe(0)
    let state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.stepFailures).toBe(1)
    expect(state.nextSendAt).toBe(T0 + EMAIL_SERIES_RETRY_DELAY_MS)
    expect(state.sentSteps).toEqual([])

    // Still failing — two more attempts exhaust the step.
    await tick(T0 + EMAIL_SERIES_RETRY_DELAY_MS)
    await tick(T0 + 2 * EMAIL_SERIES_RETRY_DELAY_MS)
    state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.failedSteps).toEqual(["welcome"])
    // Abandoned step advances the series: next step due per its delay.
    expect(state.nextStepIndex).toBe(1)
    expect(state.status).toBe("active")
  })

  it("resets the failure counter after a successful send", async () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    sendSeriesEmail.mockRejectedValueOnce(new Error("boom"))
    await tick(T0)
    expect(getEmailSeriesEnrollment("a@b.c")!.stepFailures).toBe(1)

    sendSeriesEmail.mockResolvedValue("sent")
    await tick(T0 + EMAIL_SERIES_RETRY_DELAY_MS)
    const state = getEmailSeriesEnrollment("a@b.c")!
    expect(state.sentSteps).toEqual(["welcome"])
    expect(state.stepFailures).toBe(0)
  })
})

describe("cancelEmailSeriesForEmail", () => {
  it("cancels an active enrollment and is a no-op otherwise", () => {
    enrollEmailSeries({ email: "a@b.c", now: T0 })
    expect(cancelEmailSeriesForEmail("a@b.c")).toBe(1)
    expect(getEmailSeriesEnrollment("a@b.c")!.status).toBe("cancelled")
    expect(cancelEmailSeriesForEmail("a@b.c")).toBe(0)
    expect(cancelEmailSeriesForEmail("nobody@b.c")).toBe(0)
  })
})

describe("series definition sanity", () => {
  it("has four ordered steps with increasing delays", () => {
    expect(WELCOME_SERIES_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "tips",
      "checklist",
      "upgrade",
    ])
    const delays = WELCOME_SERIES_STEPS.map((s) => s.delayMs)
    expect(delays[0]).toBe(0)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1])
    }
    expect(WELCOME_SERIES_ID).toBe("welcome")
    expect(EMAIL_SERIES_UNSUBSCRIBE_SCOPE).toBe(SCOPE)
    expect(EMAIL_SERIES_MAX_STEP_FAILURES).toBe(3)
  })
})
