import { beforeEach, describe, expect, it } from "vitest"

import { aggregateRunAnalytics } from "./analytics"

import {
  AUTO_BACKUP_STORAGE_KEY,
  buildBackupManifest,
  buildRunBackup,
  clearRunsAutoBackup,
  downloadRunBackup,
  loadRunsAutoBackup,
  parseRunBackup,
  RUN_BACKUP_VERSION,
  saveRunsAutoBackup,
  serializeRunBackup,
} from "./backup"
import { buildOpsRun } from "./fixtures"

describe("backup manifest + document", () => {
  it("builds a manifest with run ids and counts", () => {
    const runs = [buildOpsRun({ id: "a" }), buildOpsRun({ id: "b" })]
    const manifest = buildBackupManifest(runs, { now: new Date("2026-04-01T00:00:00Z") })
    expect(manifest.version).toBe(RUN_BACKUP_VERSION)
    expect(manifest.kind).toBe("agent-run-backup")
    expect(manifest.runCount).toBe(2)
    expect(manifest.runIds).toEqual(["a", "b"])
    expect(manifest.createdAt).toBe("2026-04-01T00:00:00.000Z")
  })

  it("serializes a backup document", () => {
    const doc = buildRunBackup([buildOpsRun()])
    const text = serializeRunBackup(doc)
    const parsed = JSON.parse(text)
    expect(parsed.manifest.kind).toBe("agent-run-backup")
    expect(parsed.runs).toHaveLength(1)
  })
})

describe("parseRunBackup", () => {
  it("parses a full backup document", () => {
    const doc = buildRunBackup([buildOpsRun({ id: "x" }), buildOpsRun({ id: "y" })])
    const result = parseRunBackup(serializeRunBackup(doc))
    expect(result.ok).toBe(true)
    expect(result.runs.map((r) => r.id)).toEqual(["x", "y"])
    expect(result.manifest?.runCount).toBe(2)
  })

  it("parses a bare single run", () => {
    const run = buildOpsRun({ id: "solo" })
    const result = parseRunBackup(JSON.stringify(run))
    expect(result.ok).toBe(true)
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0].id).toBe("solo")
  })

  it("parses a bare array of runs", () => {
    const runs = [buildOpsRun({ id: "a1" }), buildOpsRun({ id: "a2" })]
    const result = parseRunBackup(JSON.stringify(runs))
    expect(result.ok).toBe(true)
    expect(result.runs).toHaveLength(2)
  })

  it("normalizes lax runs missing metrics/tags instead of crashing consumers", () => {
    const laxRun = {
      id: "lax1",
      prompt: "p",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00Z",
      steps: [],
      events: [],
      // metrics/tags absent
    }
    const result = parseRunBackup(JSON.stringify(laxRun))
    expect(result.ok).toBe(true)
    expect(result.runs[0].metrics).toEqual({})
    expect(result.runs[0].tags).toEqual([])
    // Downstream consumers must not crash on the parsed record.
    expect(() => aggregateRunAnalytics(result.runs)).not.toThrow()
  })

  it("rejects invalid JSON and malformed entries", () => {
    expect(parseRunBackup("not json").ok).toBe(false)
    expect(parseRunBackup(JSON.stringify({ foo: 1 })).ok).toBe(false)
    expect(parseRunBackup(JSON.stringify([{ id: "x" }])).ok).toBe(false)
    expect(parseRunBackup(JSON.stringify({ runs: [{ bad: true }] })).ok).toBe(false)
  })
})

describe("downloadRunBackup", () => {
  it("returns false outside a DOM environment or on failure", () => {
    // jsdom provides document; stub createObjectURL away to force the catch.
    const original = URL.createObjectURL
    // @ts-expect-error testing fallback
    URL.createObjectURL = undefined
    expect(downloadRunBackup([buildOpsRun()])).toBe(false)
    URL.createObjectURL = original
  })
})

describe("auto-backup", () => {
  beforeEach(() => {
    clearRunsAutoBackup()
  })

  it("saves and loads a snapshot", () => {
    const runs = [buildOpsRun({ id: "s1" })]
    expect(saveRunsAutoBackup(runs, { now: new Date("2026-05-01T00:00:00Z") })).toBe(true)
    const snapshot = loadRunsAutoBackup()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.savedAt).toBe("2026-05-01T00:00:00.000Z")
    expect(snapshot!.runs[0].id).toBe("s1")
  })

  it("caps the snapshot at maxRuns keeping the newest", () => {
    const runs = Array.from({ length: 5 }, (_, i) => buildOpsRun({ id: `r${i}` }))
    saveRunsAutoBackup(runs, { maxRuns: 3 })
    const snapshot = loadRunsAutoBackup()
    expect(snapshot!.runs.map((r) => r.id)).toEqual(["r2", "r3", "r4"])
  })

  it("returns null when nothing is stored", () => {
    expect(loadRunsAutoBackup()).toBeNull()
  })

  it("uses a stable storage key", () => {
    expect(AUTO_BACKUP_STORAGE_KEY).toContain("agent-runs")
  })
})
