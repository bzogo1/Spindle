import { beforeEach, describe, expect, it } from "vitest"

import {
  applyOnboardingProgress,
  clampStepIndex,
  completeOnboarding,
  firstIncompleteStepIndex,
  getCompletedStepIds,
  getOnboardingRecord,
  isFirstStep,
  isLastStep,
  isOnboardingComplete,
  isOnboardingRecord,
  isOnboardingStepId,
  mergeOnboardingRecords,
  nextStepIndex,
  normalizeOnboardingRecord,
  ONBOARDING_MAX_STEP_HISTORY,
  ONBOARDING_STEP_IDS,
  onboardingProgressPercent,
  onboardingProgressSnapshot,
  onboardingStorageKey,
  parseOnboardingAnswers,
  previousStepIndex,
  readStoredOnboarding,
  resetOnboardingStoreForTests,
  resumeStepIndex,
  saveOnboardingProgress,
  stepIdAt,
  stepIndexFromId,
  wizardProgressPercent,
  writeStoredOnboarding,
} from "./onboarding"

beforeEach(() => {
  resetOnboardingStoreForTests()
  window.localStorage.clear()
})

describe("step definitions", () => {
  it("defines four ordered steps", () => {
    expect(ONBOARDING_STEP_IDS).toEqual(["welcome", "profile", "preferences", "tour"])
  })

  it("validates step ids", () => {
    expect(isOnboardingStepId("welcome")).toBe(true)
    expect(isOnboardingStepId("nope")).toBe(false)
    expect(isOnboardingStepId(3)).toBe(false)
  })

  it("maps ids to indexes and back", () => {
    expect(stepIndexFromId("tour")).toBe(3)
    expect(stepIdAt(0)).toBe("welcome")
    expect(stepIdAt(99)).toBe("tour")
    expect(stepIdAt(-5)).toBe("welcome")
  })
})

describe("step navigation logic", () => {
  it("clamps indexes into range", () => {
    expect(clampStepIndex(-1)).toBe(0)
    expect(clampStepIndex(2)).toBe(2)
    expect(clampStepIndex(42)).toBe(3)
    expect(clampStepIndex(Number.NaN)).toBe(0)
  })

  it("computes next/previous with bounds", () => {
    expect(nextStepIndex(0)).toBe(1)
    expect(nextStepIndex(3)).toBe(3)
    expect(previousStepIndex(0)).toBe(0)
    expect(previousStepIndex(2)).toBe(1)
  })

  it("detects first and last steps", () => {
    expect(isFirstStep(0)).toBe(true)
    expect(isFirstStep(1)).toBe(false)
    expect(isLastStep(3)).toBe(true)
    expect(isLastStep(2)).toBe(false)
  })
})

describe("progress tracking", () => {
  it("derives completed steps, percent, and resume index", () => {
    const record = applyOnboardingProgress(null, { stepIndex: 0 })
    expect(getCompletedStepIds(record)).toEqual([])
    expect(onboardingProgressPercent(record)).toBe(0)
    expect(firstIncompleteStepIndex(record)).toBe(0)
    expect(resumeStepIndex(record)).toBe(0)

    const advanced = applyOnboardingProgress(record, {
      stepIndex: 1,
      completedStep: "welcome",
    })
    expect(getCompletedStepIds(advanced)).toEqual(["welcome"])
    expect(onboardingProgressPercent(advanced)).toBe(25)
    expect(resumeStepIndex(advanced)).toBe(1)
  })

  it("resumes at the first incomplete step after Back navigation", () => {
    let record = applyOnboardingProgress(null, { stepIndex: 0 })
    record = applyOnboardingProgress(record, { stepIndex: 1, completedStep: "welcome" })
    record = applyOnboardingProgress(record, { stepIndex: 2, completedStep: "profile" })
    // User goes Back to review welcome — stepIndex moves, completedSteps stay.
    record = applyOnboardingProgress(record, { stepIndex: 0 })

    expect(record.stepIndex).toBe(0)
    expect(getCompletedStepIds(record)).toEqual(["welcome", "profile"])
    expect(onboardingProgressPercent(record)).toBe(50)
    expect(firstIncompleteStepIndex(record)).toBe(2)
    expect(resumeStepIndex(record)).toBe(2)
  })

  it("treats completed records as 100% and resumes at the stored step", () => {
    const done = completeOnboarding("user:a")
    expect(onboardingProgressPercent(done)).toBe(100)
    expect(getCompletedStepIds(done)).toEqual([...ONBOARDING_STEP_IDS])
    expect(resumeStepIndex(done)).toBe(ONBOARDING_STEP_IDS.length - 1)
  })

  it("counts the current step as in-progress for the wizard percent only", () => {
    expect(wizardProgressPercent([], 0)).toBe(25)
    expect(wizardProgressPercent(["welcome"], 1)).toBe(50)
    expect(wizardProgressPercent(["welcome", "profile", "preferences"], 3)).toBe(100)
    // Revisiting a completed step doesn't double count it: current step is
    // welcome (already completed), so only the two finished steps count.
    expect(wizardProgressPercent(["welcome", "profile"], 0)).toBe(50)
  })

  it("records startedAt and an append-only step history", () => {
    const first = applyOnboardingProgress(null, { stepIndex: 0, at: "2026-01-01T00:00:00.000Z" })
    expect(first.startedAt).toBe("2026-01-01T00:00:00.000Z")
    const second = applyOnboardingProgress(first, {
      stepIndex: 1,
      completedStep: "welcome",
      at: "2026-01-01T00:05:00.000Z",
    })
    expect(second.startedAt).toBe(first.startedAt)
    expect(second.stepHistory).toEqual([
      { stepId: "welcome", at: "2026-01-01T00:00:00.000Z" },
      { stepId: "profile", at: "2026-01-01T00:05:00.000Z" },
    ])
  })

  it("caps step history and dedupes completed steps", () => {
    let record = applyOnboardingProgress(null, { stepIndex: 0 })
    for (let i = 0; i < ONBOARDING_MAX_STEP_HISTORY + 10; i += 1) {
      record = applyOnboardingProgress(record, {
        stepIndex: i % ONBOARDING_STEP_IDS.length,
        completedStep: "welcome",
      })
    }
    expect(record.stepHistory.length).toBe(ONBOARDING_MAX_STEP_HISTORY)
    expect(record.completedSteps).toEqual(["welcome"])
  })

  it("normalizes legacy records without progress fields", () => {
    // Shape written before progress tracking existed — no startedAt,
    // completedSteps, or stepHistory.
    const legacy = {
      stepIndex: 2,
      answers: {},
      completedAt: null,
      skipped: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const normalized = normalizeOnboardingRecord(legacy as never)
    expect(normalized.completedSteps).toEqual(["welcome", "profile"])
    expect(normalized.startedAt).toBeNull()
    expect(normalized.stepHistory).toEqual([])
    expect(onboardingProgressPercent(normalized)).toBe(50)
    expect(resumeStepIndex(normalized)).toBe(2)
  })

  it("ships a progress snapshot for the API", () => {
    const record = applyOnboardingProgress(null, { stepIndex: 1, completedStep: "welcome" })
    expect(onboardingProgressSnapshot(record)).toEqual({
      percent: 25,
      completedSteps: ["welcome"],
      resumeStepIndex: 1,
      currentStepId: "profile",
      isComplete: false,
    })
    expect(onboardingProgressSnapshot(null)).toBeNull()
  })
})

describe("mergeOnboardingRecords", () => {
  const t1 = "2026-01-01T00:00:00.000Z"
  const t2 = "2026-01-02T00:00:00.000Z"

  function inProgress(overrides: Partial<Parameters<typeof applyOnboardingProgress>[1]> = {}) {
    return applyOnboardingProgress(null, { stepIndex: 0, at: t1, ...overrides })
  }

  it("returns the only record when one side is missing", () => {
    const record = inProgress({ stepIndex: 1 })
    expect(mergeOnboardingRecords(record, null)).toMatchObject({ stepIndex: 1 })
    expect(mergeOnboardingRecords(null, record)).toMatchObject({ stepIndex: 1 })
    expect(mergeOnboardingRecords(null, null)).toBeNull()
  })

  it("prefers the newer in-progress record but unions completed steps", () => {
    // Server went stale at t1 with only "welcome" done; localStorage kept
    // working offline and finished "profile" at t2.
    const server = inProgress({
      stepIndex: 1,
      completedStep: "welcome",
      answers: { displayName: "Server" },
      at: t1,
    })
    const stored = applyOnboardingProgress(server, {
      stepIndex: 2,
      answers: { displayName: "Stored", role: "lab" },
      completedStep: "profile",
      replaceAnswers: true,
      at: t2,
    })
    // Simulate divergence: stored has t2 progress the server never saw.
    const serverCopy = { ...server, updatedAt: t1 }

    const merged = mergeOnboardingRecords(serverCopy, stored)
    expect(merged).not.toBeNull()
    expect(merged?.stepIndex).toBe(2)
    expect(merged?.answers).toEqual({ displayName: "Stored", role: "lab" })
    expect(merged?.completedSteps).toEqual(["welcome", "profile"])
    expect(merged?.updatedAt).toBe(t2)
    expect(merged?.startedAt).toBe(t1)
    expect(onboardingProgressPercent(merged)).toBe(50)
  })

  it("keeps server progress when the server record is newer", () => {
    const stored = inProgress({ stepIndex: 1, completedStep: "welcome", at: t1 })
    const server = applyOnboardingProgress(stored, {
      stepIndex: 2,
      completedStep: "profile",
      at: t2,
    })
    const merged = mergeOnboardingRecords(server, { ...stored, updatedAt: t1 })
    expect(merged?.stepIndex).toBe(2)
    expect(merged?.completedSteps).toEqual(["welcome", "profile"])
    expect(merged?.updatedAt).toBe(t2)
  })

  it("keeps completion when either side is complete", () => {
    const incomplete = inProgress({ stepIndex: 1, at: t1 })
    const done = completeOnboarding("user:a", { at: t2 })
    const merged = mergeOnboardingRecords(incomplete, done)
    expect(isOnboardingComplete(merged)).toBe(true)
    expect(merged?.completedAt).toBe(done.completedAt)
    expect(onboardingProgressPercent(merged)).toBe(100)
  })

  it("merges step history without duplicates, oldest first", () => {
    const server = applyOnboardingProgress(null, {
      stepIndex: 0,
      at: t1,
    })
    const stored = applyOnboardingProgress(server, {
      stepIndex: 1,
      completedStep: "welcome",
      at: t2,
    })
    const merged = mergeOnboardingRecords(server, stored)
    expect(merged?.stepHistory).toEqual(stored.stepHistory)
  })
})

describe("parseOnboardingAnswers", () => {
  it("returns an empty object for non-objects", () => {
    expect(parseOnboardingAnswers(null)).toEqual({})
    expect(parseOnboardingAnswers("x")).toEqual({})
    expect(parseOnboardingAnswers(undefined)).toEqual({})
  })

  it("keeps a valid display name and role", () => {
    expect(
      parseOnboardingAnswers({ displayName: "  Ada   Lovelace ", role: "lab", extra: 1 }),
    ).toEqual({ displayName: "Ada Lovelace", role: "lab" })
  })

  it("drops invalid display names and unknown roles", () => {
    expect(parseOnboardingAnswers({ displayName: "x".repeat(81), role: "wizard" })).toEqual({})
    expect(parseOnboardingAnswers({ displayName: 42 })).toEqual({})
  })
})

describe("server-side progress store", () => {
  it("returns null for unknown principals", () => {
    expect(getOnboardingRecord("user:nobody")).toBeNull()
  })

  it("saves and reads progress per principal", () => {
    const saved = saveOnboardingProgress("user:a", {
      stepIndex: 1,
      answers: { displayName: "Ada" },
    })
    expect(saved.stepIndex).toBe(1)
    expect(saved.completedAt).toBeNull()

    const fetched = getOnboardingRecord("user:a")
    expect(fetched).toMatchObject({ stepIndex: 1, answers: { displayName: "Ada" } })
    expect(getOnboardingRecord("user:b")).toBeNull()
  })

  it("merges answers across saves and clamps step indexes", () => {
    saveOnboardingProgress("user:a", { stepIndex: 1, answers: { displayName: "Ada" } })
    const saved = saveOnboardingProgress("user:a", {
      stepIndex: 99,
      answers: { role: "team" },
    })
    expect(saved.stepIndex).toBe(3)
    expect(saved.answers).toEqual({ displayName: "Ada", role: "team" })
  })

  it("replaceAnswers deletes keys absent from the new answers", () => {
    saveOnboardingProgress("user:a", {
      stepIndex: 1,
      answers: { displayName: "Ada", role: "lab" },
    })
    const cleared = saveOnboardingProgress("user:a", {
      stepIndex: 1,
      answers: { role: "team" },
      replaceAnswers: true,
    })
    expect(cleared.answers).toEqual({ role: "team" })

    const emptied = saveOnboardingProgress("user:a", {
      stepIndex: 1,
      answers: {},
      replaceAnswers: true,
    })
    expect(emptied.answers).toEqual({})
  })

  it("completes with and without the skipped flag", () => {
    saveOnboardingProgress("user:a", { stepIndex: 0 })
    const done = completeOnboarding("user:a", { skipped: true })
    expect(done.skipped).toBe(true)
    expect(done.completedAt).not.toBeNull()
    expect(isOnboardingComplete(done)).toBe(true)

    const finished = completeOnboarding("user:b")
    expect(finished.skipped).toBe(false)
  })

  it("keeps completion sticky across later progress saves", () => {
    completeOnboarding("user:a")
    const after = saveOnboardingProgress("user:a", { stepIndex: 0 })
    expect(after.completedAt).not.toBeNull()
  })

  it("treats the first completion as final (completed-then-skipped precedence)", () => {
    // Finish normally, then a stray skip POST arrives (double-click, retry,
    // offline re-sync): the original completion must win — skipped stays
    // false and completedAt does not move.
    const finished = completeOnboarding("user:a", { at: "2026-01-01T00:00:00.000Z" })
    const afterSkip = completeOnboarding("user:a", {
      skipped: true,
      at: "2026-01-02T00:00:00.000Z",
    })
    expect(afterSkip.skipped).toBe(false)
    expect(afterSkip.completedAt).toBe(finished.completedAt)
    expect(afterSkip.updatedAt).toBe(finished.updatedAt)
    expect(getOnboardingRecord("user:a")?.skipped).toBe(false)

    // Same in the other direction: skip first, then finish — skipped stays.
    completeOnboarding("user:b", { skipped: true, at: "2026-01-01T00:00:00.000Z" })
    const afterFinish = completeOnboarding("user:b", { at: "2026-01-02T00:00:00.000Z" })
    expect(afterFinish.skipped).toBe(true)
    expect(afterFinish.completedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  it("persists completedStep, startedAt, and step history per principal", () => {
    const first = saveOnboardingProgress("user:a", {
      stepIndex: 0,
      at: "2026-01-01T00:00:00.000Z",
    })
    expect(first.startedAt).toBe("2026-01-01T00:00:00.000Z")
    expect(first.stepHistory).toEqual([{ stepId: "welcome", at: "2026-01-01T00:00:00.000Z" }])

    const second = saveOnboardingProgress("user:a", {
      stepIndex: 1,
      completedStep: "welcome",
      at: "2026-01-01T00:01:00.000Z",
    })
    expect(second.completedSteps).toEqual(["welcome"])
    expect(second.startedAt).toBe(first.startedAt)
    expect(second.stepHistory).toHaveLength(2)
    expect(getOnboardingRecord("user:a")?.completedSteps).toEqual(["welcome"])
  })
})

describe("localStorage fallback", () => {
  it("namespaces storage keys by identity", () => {
    expect(onboardingStorageKey("Ada@Example.com")).toBe("spindle_onboarding:ada@example.com")
    expect(onboardingStorageKey(null)).toBe("spindle_onboarding")
    expect(onboardingStorageKey("  ")).toBe("spindle_onboarding")
  })

  it("round-trips a record", () => {
    const record = saveOnboardingProgress("user:a", {
      stepIndex: 2,
      answers: { role: "individual" },
    })
    writeStoredOnboarding("spindle_onboarding:test", record)
    expect(readStoredOnboarding("spindle_onboarding:test")).toMatchObject({
      stepIndex: 2,
      answers: { role: "individual" },
    })
  })

  it("returns null for missing or malformed payloads", () => {
    expect(readStoredOnboarding("spindle_onboarding:missing")).toBeNull()
    window.localStorage.setItem("spindle_onboarding:bad", "{nope")
    expect(readStoredOnboarding("spindle_onboarding:bad")).toBeNull()
    window.localStorage.setItem("spindle_onboarding:shape", JSON.stringify({ stepIndex: "x" }))
    expect(readStoredOnboarding("spindle_onboarding:shape")).toBeNull()
  })

  it("sanitizes stored records on read", () => {
    writeStoredOnboarding("spindle_onboarding:test", {
      stepIndex: 99,
      answers: { displayName: "x".repeat(81), role: "bogus" },
      completedAt: null,
      skipped: false,
      updatedAt: new Date().toISOString(),
    } as never)
    const stored = readStoredOnboarding("spindle_onboarding:test")
    expect(stored?.stepIndex).toBe(3)
    expect(stored?.answers).toEqual({})
  })

  it("isOnboardingRecord validates the shape", () => {
    expect(isOnboardingRecord({})).toBe(false)
    expect(
      isOnboardingRecord({
        stepIndex: 0,
        answers: {},
        completedAt: null,
        skipped: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true)
  })
})
