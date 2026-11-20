import { describe, expect, it } from "vitest"

import {
  formatCostUsd,
  formatDurationMs,
  formatTokenCount,
  isActiveRun,
  runCostUsd,
  runDurationMs,
  runTotalTokens,
  statusLabel,
  stepKindLabel,
} from "./agent-run-log-utils"

describe("statusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(statusLabel("waiting_approval")).toBe("waiting approval")
    expect(statusLabel("succeeded")).toBe("succeeded")
  })
})

describe("stepKindLabel", () => {
  it("maps known kinds and defaults to Result", () => {
    expect(stepKindLabel("thought")).toBe("Thought")
    expect(stepKindLabel("tool_call")).toBe("Tool call")
    expect(stepKindLabel("result")).toBe("Result")
  })
})

describe("formatDurationMs", () => {
  it("returns an em dash for non-finite or negative input", () => {
    expect(formatDurationMs(Number.NaN)).toBe("—")
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe("—")
    expect(formatDurationMs(-1)).toBe("—")
  })

  it("formats sub-second durations in milliseconds", () => {
    expect(formatDurationMs(0)).toBe("0ms")
    expect(formatDurationMs(999)).toBe("999ms")
    // Rounds before appending the unit.
    expect(formatDurationMs(12.4)).toBe("12ms")
    expect(formatDurationMs(12.6)).toBe("13ms")
  })

  it("formats seconds, minutes, and hours", () => {
    expect(formatDurationMs(1000)).toBe("1s")
    expect(formatDurationMs(59_999)).toBe("59s")
    expect(formatDurationMs(60_000)).toBe("1m")
    expect(formatDurationMs(61_000)).toBe("1m 1s")
    expect(formatDurationMs(3_600_000)).toBe("1h")
    expect(formatDurationMs(3_660_000)).toBe("1h 1m")
    expect(formatDurationMs(90_000)).toBe("1m 30s")
  })
})

describe("runDurationMs", () => {
  const base = {
    createdAt: "2025-06-10T12:00:00Z",
    startedAt: "2025-06-10T12:00:05Z",
    finishedAt: "2025-06-10T12:00:35Z",
  }

  it("measures startedAt to finishedAt for finished runs", () => {
    expect(runDurationMs(base)).toBe(30_000)
  })

  it("falls back to createdAt when startedAt is null", () => {
    expect(runDurationMs({ ...base, startedAt: null })).toBe(35_000)
  })

  it("uses `now` as the end for active runs", () => {
    const now = new Date("2025-06-10T12:01:05Z").getTime()
    expect(runDurationMs({ ...base, finishedAt: null }, now)).toBe(60_000)
  })

  it("clamps negative spans to zero", () => {
    expect(
      runDurationMs({
        ...base,
        startedAt: "2025-06-10T12:00:40Z",
        finishedAt: "2025-06-10T12:00:30Z",
      }),
    ).toBe(0)
  })

  it("returns null for unparseable timestamps", () => {
    expect(runDurationMs({ ...base, startedAt: "not-a-date" })).toBeNull()
    expect(runDurationMs({ ...base, finishedAt: "not-a-date" })).toBeNull()
  })
})

describe("runCostUsd", () => {
  it("returns the reported cost or null", () => {
    expect(runCostUsd({ usage: { costUsd: 0.05 } })).toBe(0.05)
    expect(runCostUsd({ usage: {} })).toBeNull()
    expect(runCostUsd({})).toBeNull()
    expect(runCostUsd({ usage: { costUsd: Number.NaN } })).toBeNull()
  })
})

describe("runTotalTokens", () => {
  it("prefers totalTokens and falls back to input+output", () => {
    expect(runTotalTokens({ usage: { totalTokens: 5000, inputTokens: 1 } })).toBe(5000)
    expect(runTotalTokens({ usage: { inputTokens: 300, outputTokens: 200 } })).toBe(500)
    expect(runTotalTokens({ usage: { inputTokens: 300 } })).toBe(300)
    expect(runTotalTokens({ usage: {} })).toBeNull()
    expect(runTotalTokens({})).toBeNull()
  })
})

describe("formatCostUsd", () => {
  it("uses four decimals for sub-cent amounts", () => {
    expect(formatCostUsd(0.0042)).toBe("$0.0042")
    expect(formatCostUsd(0)).toBe("$0.00")
    expect(formatCostUsd(1.5)).toBe("$1.50")
    expect(formatCostUsd(Number.NaN)).toBe("—")
  })
})

describe("formatTokenCount", () => {
  it("compacts thousands and millions", () => {
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(1200)).toBe("1.2k")
    expect(formatTokenCount(2_500_000)).toBe("2.5M")
    expect(formatTokenCount(Number.NaN)).toBe("—")
  })
})

describe("isActiveRun", () => {
  it("treats queued, running, and waiting_approval as active", () => {
    expect(isActiveRun("queued")).toBe(true)
    expect(isActiveRun("running")).toBe(true)
    expect(isActiveRun("waiting_approval")).toBe(true)
  })

  it("treats terminal statuses as inactive", () => {
    expect(isActiveRun("succeeded")).toBe(false)
    expect(isActiveRun("failed")).toBe(false)
    expect(isActiveRun("cancelled")).toBe(false)
    expect(isActiveRun("rejected")).toBe(false)
  })
})
