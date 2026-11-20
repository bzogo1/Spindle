import { beforeEach, describe, expect, it } from "vitest"

import {
  cancelAgentRunSchedule,
  clearScheduleStore,
  createAgentRunSchedule,
  dueAgentRunSchedules,
  fireAgentRunSchedule,
  fireDueAgentRunSchedules,
  getAgentRunSchedule,
  listAgentRunSchedules,
  loadScheduleStore,
  nextScheduleRunAt,
  pauseAgentRunSchedule,
  removeAgentRunSchedule,
  resumeAgentRunSchedule,
  saveNewAgentRunSchedule,
  updateAgentRunSchedule,
  validateScheduleInput,
  type AgentRunSchedule,
} from "./schedule"
import { getAgentRunTemplate } from "./templates"

const NOW = new Date("2026-11-20T12:00:00.000Z")
const LATER = new Date("2026-11-20T12:30:00.000Z")

function makeSchedule(overrides: Partial<AgentRunSchedule> = {}): AgentRunSchedule {
  const created = createAgentRunSchedule(
    {
      kind: "once",
      templateId: "tpl.code-review",
      at: "2026-11-21T09:00:00.000Z",
    },
    { now: NOW },
  )
  if (!created.ok || !created.schedule) throw new Error("fixture schedule failed")
  return { ...created.schedule, ...overrides }
}

describe("validateScheduleInput", () => {
  it("accepts a valid once schedule", () => {
    const result = validateScheduleInput({
      kind: "once",
      templateId: "tpl.code-review",
      at: "2026-11-21T09:00:00.000Z",
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("requires a template or prompt", () => {
    const result = validateScheduleInput({ kind: "once", at: "2026-11-21T09:00:00.000Z" })
    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toMatch(/template or an explicit prompt/)
  })

  it("rejects unknown templates", () => {
    const result = validateScheduleInput({
      kind: "once",
      templateId: "tpl.nope",
      at: "2026-11-21T09:00:00.000Z",
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toMatch(/Unknown template/)
  })

  it("validates kind-specific fields", () => {
    expect(validateScheduleInput({ kind: "once", prompt: "x" }).errors.join(" ")).toMatch(/`at`/)
    expect(validateScheduleInput({ kind: "cron", prompt: "x" }).errors.join(" ")).toMatch(/cron/)
    expect(validateScheduleInput({ kind: "cron", prompt: "x", cron: "not a cron" }).ok).toBe(false)
    expect(
      validateScheduleInput({ kind: "interval", prompt: "x", intervalMs: 500 }).errors.join(" "),
    ).toMatch(/at least/)
    expect(
      validateScheduleInput({
        kind: "interval",
        prompt: "x",
        intervalMs: 60_000,
        maxRuns: 0,
      }).ok,
    ).toBe(false)
  })

  it("accepts a prompt-only schedule without a template", () => {
    const result = validateScheduleInput({ kind: "interval", prompt: "ping", intervalMs: 60_000 })
    expect(result.ok).toBe(true)
  })
})

describe("createAgentRunSchedule", () => {
  it("computes nextRunAt for each kind", () => {
    const once = createAgentRunSchedule(
      { kind: "once", templateId: "tpl.docs-summarizer", at: "2026-11-21T09:00:00.000Z" },
      { now: NOW },
    )
    expect(once.schedule?.nextRunAt).toBe("2026-11-21T09:00:00.000Z")
    expect(once.schedule?.status).toBe("active")
    expect(once.schedule?.runCount).toBe(0)

    const cron = createAgentRunSchedule(
      { kind: "cron", templateId: "tpl.test-generator", cron: "0 9 * * 1-5" },
      { now: NOW },
    )
    expect(cron.schedule?.nextRunAt).toBeTruthy()
    expect(new Date(cron.schedule!.nextRunAt!).getTime()).toBeGreaterThan(NOW.getTime())

    const interval = createAgentRunSchedule(
      { kind: "interval", prompt: "ping", intervalMs: 60_000 },
      { now: NOW },
    )
    // First interval fire is createdAt + interval.
    expect(interval.schedule?.nextRunAt).toBe("2026-11-20T12:01:00.000Z")
  })

  it("returns an error for invalid input", () => {
    const result = createAgentRunSchedule({ kind: "cron", prompt: "x" }, { now: NOW })
    expect(result.ok).toBe(false)
    expect(result.schedule).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})

describe("nextScheduleRunAt", () => {
  it("returns null for a past one-shot", () => {
    const schedule = makeSchedule({ at: "2026-11-20T11:00:00.000Z" })
    expect(nextScheduleRunAt(schedule, NOW)).toBeNull()
  })

  it("advances cron schedules past `from`", () => {
    const schedule = makeSchedule({ kind: "cron", cron: "*/15 * * * *", at: undefined })
    const next = nextScheduleRunAt(schedule, NOW)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(NOW.getTime())
    expect(next!.getMinutes() % 15).toBe(0)
  })

  it("skips multiple elapsed interval periods", () => {
    const schedule = makeSchedule({
      kind: "interval",
      intervalMs: 60_000,
      at: undefined,
      createdAt: "2026-11-20T10:00:00.000Z",
    })
    const next = nextScheduleRunAt(schedule, NOW)
    // base 10:00, interval 1m → next strictly after 12:00 is 12:01.
    expect(next?.toISOString()).toBe("2026-11-20T12:01:00.000Z")
  })
})

describe("status transitions", () => {
  it("pauses and resumes with a recomputed nextRunAt", () => {
    const schedule = makeSchedule()
    const paused = pauseAgentRunSchedule(schedule, { now: NOW })
    expect(paused.status).toBe("paused")
    expect(paused.nextRunAt).toBe(schedule.nextRunAt)

    const resumed = resumeAgentRunSchedule(paused, { now: LATER })
    expect(resumed.status).toBe("active")
    // One-shot at 09:00 next day is still in the future from LATER.
    expect(resumed.nextRunAt).toBe("2026-11-21T09:00:00.000Z")
  })

  it("resume on an elapsed one-shot clears nextRunAt", () => {
    const schedule = makeSchedule({ at: "2026-11-20T12:10:00.000Z" })
    const paused = pauseAgentRunSchedule(schedule, { now: NOW })
    const resumed = resumeAgentRunSchedule(paused, { now: new Date("2026-11-20T13:00:00.000Z") })
    expect(resumed.status).toBe("active")
    expect(resumed.nextRunAt).toBeUndefined()
  })

  it("cancel is terminal and clears nextRunAt", () => {
    const schedule = makeSchedule()
    const cancelled = cancelAgentRunSchedule(schedule, { now: NOW })
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.nextRunAt).toBeUndefined()
    expect(cancelAgentRunSchedule(cancelled, { now: NOW }).status).toBe("cancelled")
  })
})

describe("fireAgentRunSchedule", () => {
  it("instantiates a queued run from the template and completes a one-shot", () => {
    const schedule = makeSchedule()
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.ok).toBe(true)
    expect(result.run?.status).toBe("queued")
    expect(result.run?.templateId).toBe("tpl.code-review")
    expect(result.run?.prompt).toBe(getAgentRunTemplate("tpl.code-review")!.prompt)

    const fired = result.schedule!
    expect(fired.status).toBe("completed")
    expect(fired.runCount).toBe(1)
    expect(fired.lastRunId).toBe(result.run!.id)
    expect(fired.nextRunAt).toBeUndefined()
  })

  it("honors prompt overrides and extra tags", () => {
    const schedule = makeSchedule({ prompt: "custom prompt", extraTags: ["nightly"] })
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.run?.prompt).toBe("custom prompt")
    expect(result.run?.tags).toContain("nightly")
  })

  it("advances interval schedules to now + interval", () => {
    const schedule = makeSchedule({
      kind: "interval",
      intervalMs: 300_000,
      at: undefined,
      cron: undefined,
    })
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.schedule?.status).toBe("active")
    expect(result.schedule?.nextRunAt).toBe("2026-11-20T12:05:00.000Z")
  })

  it("completes when maxRuns is reached", () => {
    const schedule = makeSchedule({
      kind: "interval",
      intervalMs: 300_000,
      at: undefined,
      maxRuns: 1,
    })
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.schedule?.status).toBe("completed")
    expect(result.schedule?.runCount).toBe(1)
  })

  it("fires prompt-only schedules without a template", () => {
    const schedule = makeSchedule({ templateId: undefined, prompt: "ping the agent" })
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.ok).toBe(true)
    expect(result.run?.prompt).toBe("ping the agent")
    expect(result.run?.templateId).toBeUndefined()
  })

  it("refuses to fire terminal schedules", () => {
    const schedule = cancelAgentRunSchedule(makeSchedule(), { now: NOW })
    const result = fireAgentRunSchedule(schedule, { now: NOW })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cancelled/)
  })

  it("keeps paused schedules paused after a manual fire", () => {
    const paused = pauseAgentRunSchedule(
      makeSchedule({ kind: "interval", intervalMs: 60_000, at: undefined }),
      {
        now: NOW,
      },
    )
    const result = fireAgentRunSchedule(paused, { now: NOW })
    expect(result.schedule?.status).toBe("paused")
    expect(result.schedule?.runCount).toBe(1)
  })
})

describe("due + fireDue", () => {
  it("selects only active schedules whose nextRunAt has passed", () => {
    const due = makeSchedule({ id: "s_due", at: "2026-11-20T11:00:00.000Z" })
    // Recompute nextRunAt for a past `at` is null, so craft it manually.
    due.nextRunAt = "2026-11-20T11:00:00.000Z"
    const future = makeSchedule({ id: "s_future" })
    const paused = pauseAgentRunSchedule(makeSchedule({ id: "s_paused" }), { now: NOW })
    const list = [future, paused, due]

    expect(dueAgentRunSchedules(list, NOW).map((s) => s.id)).toEqual(["s_due"])
  })

  it("fires due schedules and returns updated copies", () => {
    const schedule = makeSchedule({ kind: "interval", intervalMs: 60_000, at: undefined })
    schedule.nextRunAt = "2026-11-20T11:59:00.000Z"
    const results = fireDueAgentRunSchedules([schedule], { now: NOW })
    expect(results).toHaveLength(1)
    expect(results[0].result.ok).toBe(true)
    expect(results[0].result.run?.status).toBe("queued")
    expect(results[0].schedule.runCount).toBe(1)
  })
})

describe("schedule store", () => {
  beforeEach(() => {
    clearScheduleStore()
    window.localStorage.clear()
  })

  it("persists created schedules and lists them sorted", () => {
    const first = saveNewAgentRunSchedule(
      { kind: "once", templateId: "tpl.code-review", at: "2026-11-22T09:00:00.000Z" },
      { now: NOW },
    )
    const second = saveNewAgentRunSchedule(
      { kind: "once", templateId: "tpl.docs-summarizer", at: "2026-11-21T09:00:00.000Z" },
      { now: NOW },
    )
    expect(first.persisted).toBe(true)
    expect(second.persisted).toBe(true)

    const list = listAgentRunSchedules()
    expect(list).toHaveLength(2)
    // Soonest nextRunAt first.
    expect(list[0].id).toBe(second.schedule!.id)
    expect(getAgentRunSchedule(first.schedule!.id)?.kind).toBe("once")
    expect(loadScheduleStore().schedules).toHaveLength(2)
  })

  it("updates and removes schedules", () => {
    const created = saveNewAgentRunSchedule(
      { kind: "once", prompt: "x", at: "2026-11-22T09:00:00.000Z" },
      { now: NOW },
    )
    const id = created.schedule!.id
    const paused = pauseAgentRunSchedule(created.schedule!, { now: NOW })
    expect(updateAgentRunSchedule(paused)).toBe(true)
    expect(getAgentRunSchedule(id)?.status).toBe("paused")

    expect(removeAgentRunSchedule(id)).toBe(true)
    expect(getAgentRunSchedule(id)).toBeNull()
    expect(removeAgentRunSchedule(id)).toBe(false)
  })

  it("survives a storage round-trip", () => {
    saveNewAgentRunSchedule(
      {
        kind: "cron",
        templateId: "tpl.incident-triage",
        cron: "0 8 * * *",
        name: "morning triage",
      },
      { now: NOW },
    )
    const reloaded = listAgentRunSchedules()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].name).toBe("morning triage")
    expect(reloaded[0].status).toBe("active")
  })
})
