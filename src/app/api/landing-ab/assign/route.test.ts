// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  concludeExperiment,
  createExperiment,
  DEFAULT_LANDING_EXPERIMENT_NAME,
  listExperiments,
  resetLandingAbForTests,
  updateExperiment,
} from "@/lib/landing-ab"

import { POST } from "./route"

let ipCounter = 0

function request(body: unknown, ip?: string) {
  ipCounter += 1
  return new Request("http://localhost/api/landing-ab/assign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? `10.7.0.${ipCounter}`,
    },
    body: JSON.stringify(body),
  })
}

function post(body: unknown, ip?: string) {
  return POST(request(body, ip))
}

async function assignmentOf(response: Response) {
  const body = await response.json()
  expect(body.ok).toBe(true)
  return body.assignment as {
    experimentId: string
    variantId: string
    config: Record<string, unknown>
  } | null
}

beforeEach(() => {
  resetLandingAbForTests()
})

describe("POST /api/landing-ab/assign", () => {
  it("auto-creates the seeded experiment on first visit", async () => {
    const assignment = await assignmentOf(await post({ experiment: "referral-landing" }))
    expect(assignment).not.toBeNull()
    expect(assignment?.variantId === "control" || assignment?.variantId === "treatment").toBe(true)
    const experiments = listExperiments()
    expect(experiments).toHaveLength(1)
    expect(experiments[0]?.name).toBe(DEFAULT_LANDING_EXPERIMENT_NAME)
    expect(experiments[0]?.status).toBe("running")
  })

  it("serves the winner after the experiment is concluded — no new experiment", async () => {
    const first = await assignmentOf(await post({ experiment: "referral-landing" }))
    expect(first).not.toBeNull()

    // Admin concludes the seeded experiment picking the treatment variant.
    const seeded = listExperiments()[0]!
    const treatment = seeded.variants.find((v) => v.id === "treatment")!
    concludeExperiment(seeded.id, treatment.id)

    const second = await assignmentOf(await post({ experiment: "referral-landing" }))
    expect(second).not.toBeNull()
    expect(second?.experimentId).toBe(seeded.id)
    expect(second?.variantId).toBe("treatment")
    expect(second?.config.headline).toBe("Your invite to Spindle is ready.")

    // Crucially: no replacement experiment was auto-created.
    expect(listExperiments()).toHaveLength(1)
    expect(listExperiments()[0]?.status).toBe("completed")
  })

  it("falls back to control (assignment null) for paused/draft without auto-creating", async () => {
    const seeded = createExperiment({
      name: DEFAULT_LANDING_EXPERIMENT_NAME,
      variants: [
        { id: "a", weight: 1 },
        { id: "b", weight: 1 },
      ],
    })
    updateExperiment(seeded.id, { status: "running" })
    updateExperiment(seeded.id, { status: "paused" })

    const assignment = await assignmentOf(await post({ experiment: "referral-landing" }))
    expect(assignment).toBeNull()
    expect(listExperiments()).toHaveLength(1)
  })

  it("prefers a newer running experiment over an older completed one", async () => {
    const older = createExperiment({
      name: DEFAULT_LANDING_EXPERIMENT_NAME,
      variants: [
        { id: "old-a", weight: 1 },
        { id: "old-b", weight: 1 },
      ],
    })
    updateExperiment(older.id, { status: "running" })
    concludeExperiment(older.id, "old-b")

    // Admin starts a fresh test for the same surface.
    const newer = createExperiment({
      name: DEFAULT_LANDING_EXPERIMENT_NAME,
      variants: [
        { id: "new-a", weight: 1 },
        { id: "new-b", weight: 1 },
      ],
    })
    updateExperiment(newer.id, { status: "running" })

    const assignment = await assignmentOf(await post({ experiment: "referral-landing" }))
    expect(assignment?.experimentId).toBe(newer.id)
    expect(["new-a", "new-b"]).toContain(assignment?.variantId)
  })

  it("returns assignment null for unknown non-default surfaces", async () => {
    const assignment = await assignmentOf(await post({ experiment: "other-surface" }))
    expect(assignment).toBeNull()
    expect(listExperiments()).toHaveLength(0)
  })

  it("assigns by explicit experimentId regardless of name resolution", async () => {
    const experiment = createExperiment({
      name: "custom-surface",
      variants: [
        { id: "x", weight: 1, config: { headline: "X" } },
        { id: "y", weight: 1, config: { headline: "Y" } },
      ],
    })
    updateExperiment(experiment.id, { status: "running" })
    const assignment = await assignmentOf(await post({ experimentId: experiment.id }))
    expect(assignment?.experimentId).toBe(experiment.id)
  })
})
