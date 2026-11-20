import { describe, expect, it } from "vitest"

import { normalizeAgentRunRecord } from "./types"
import { buildOpsRun } from "./fixtures"

describe("normalizeAgentRunRecord", () => {
  it("fills missing collections with safe defaults", () => {
    const lax = {
      ...buildOpsRun(),
      metrics: undefined,
      tags: undefined,
      steps: undefined,
      events: undefined,
      createdAt: "",
    } as unknown as Parameters<typeof normalizeAgentRunRecord>[0]
    const normalized = normalizeAgentRunRecord(lax)
    expect(normalized.metrics).toEqual({})
    expect(normalized.tags).toEqual([])
    expect(normalized.steps).toEqual([])
    expect(normalized.events).toEqual([])
    expect(normalized.createdAt).toBe("1970-01-01T00:00:00.000Z")
  })

  it("drops non-string tags and non-object metrics", () => {
    const run = buildOpsRun({ tags: ["ok", 42, null] as unknown as string[] })
    const normalized = normalizeAgentRunRecord({ ...run, metrics: [1, 2] as never })
    expect(normalized.tags).toEqual(["ok"])
    expect(normalized.metrics).toEqual({})
  })

  it("passes well-formed runs through unchanged", () => {
    const run = buildOpsRun()
    const normalized = normalizeAgentRunRecord(run)
    expect(normalized).toEqual(run)
  })
})
