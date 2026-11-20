import { beforeEach, describe, expect, it, vi } from "vitest"

import { trackEvent } from "@/lib/analytics"

import { JOURNEYS, JOURNEY_IDS, getJourney, isJourneyStep, journeyStepIndex } from "./definitions"
import { getJourneySessionId, resetJourneySession } from "./session"
import { JOURNEY_EVENT_NAME, trackJourneyStart, trackJourneyStep } from "./tracker"

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}))

const trackEventMock = vi.mocked(trackEvent)

describe("journey definitions", () => {
  it("declares unique journey ids and non-empty ordered steps", () => {
    const ids = JOURNEYS.map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual([...JOURNEY_IDS].sort())
    for (const journey of JOURNEYS) {
      expect(journey.steps.length).toBeGreaterThan(0)
      const stepIds = journey.steps.map((s) => s.step)
      expect(new Set(stepIds).size).toBe(stepIds.length)
      for (const step of journey.steps) {
        expect(step.label.length).toBeGreaterThan(0)
        expect(step.location.length).toBeGreaterThan(0)
      }
    }
  })

  it("resolves journeys and step indexes", () => {
    const signup = getJourney("signup_to_first_project")
    expect(signup).toBeDefined()
    expect(journeyStepIndex("signup_to_first_project", "signup_submitted")).toBe(2)
    expect(journeyStepIndex("signup_to_first_project", "nope")).toBe(-1)
    expect(isJourneyStep("invite_to_accept", "invite_sent")).toBe(true)
    expect(isJourneyStep("invite_to_accept", "signup_submitted")).toBe(false)
    expect(getJourney("does_not_exist")).toBeUndefined()
  })
})

describe("journey session", () => {
  beforeEach(() => {
    resetJourneySession()
  })

  it("mints a stable id per tab session and resets on demand", () => {
    const first = getJourneySessionId()
    expect(first).toBeTruthy()
    expect(getJourneySessionId()).toBe(first)
    resetJourneySession()
    const second = getJourneySessionId()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
  })
})

describe("trackJourneyStep", () => {
  beforeEach(() => {
    trackEventMock.mockClear()
    resetJourneySession()
  })

  it("emits a journey_step feature_use event with journey, step, and index", () => {
    trackJourneyStep("signup_to_first_project", "signup_submitted", { provider: "email" })

    expect(trackEventMock).toHaveBeenCalledTimes(1)
    const [name, props, type] = trackEventMock.mock.calls[0]
    expect(name).toBe(JOURNEY_EVENT_NAME)
    expect(type).toBe("feature_use")
    expect(props).toMatchObject({
      journey: "signup_to_first_project",
      step: "signup_submitted",
      stepIndex: 2,
      provider: "email",
    })
    expect(typeof props?.journeySessionId).toBe("string")
  })

  it("drops unknown journeys and steps silently", () => {
    // @ts-expect-error — intentionally invalid journey id
    trackJourneyStep("not_a_journey", "signup_submitted")
    trackJourneyStep("signup_to_first_project", "not_a_step")
    // Valid journey id, but "signup_submitted" belongs to a different journey.
    trackJourneyStep("invite_to_accept", "signup_submitted")
    expect(trackEventMock).not.toHaveBeenCalled()
  })

  it("strips reserved and excess props", () => {
    trackJourneyStep("agent_task", "prompt_submitted", {
      journey: "hijack",
      step: "hijack",
      stepIndex: 99,
      journeySessionId: "fake",
      ok: true,
    })
    const props = trackEventMock.mock.calls[0][1]
    expect(props).toMatchObject({ journey: "agent_task", step: "prompt_submitted", ok: true })
    expect(props?.journeySessionId).not.toBe("fake")
  })

  it("omits journeySessionId when storage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    trackJourneyStep("feedback_submission", "feedback_submitted")
    const props = trackEventMock.mock.calls[0][1]
    expect(props).not.toHaveProperty("journeySessionId")
    spy.mockRestore()
  })

  it("trackJourneyStart is an alias for the entry step", () => {
    trackJourneyStart("oauth_signin", "signin_view")
    const props = trackEventMock.mock.calls[0][1]
    expect(props).toMatchObject({ journey: "oauth_signin", step: "signin_view", stepIndex: 0 })
  })
})
