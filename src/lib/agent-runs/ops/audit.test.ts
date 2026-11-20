import { describe, expect, it } from "vitest"

import {
  appendAuditEvent,
  auditEntriesForRun,
  auditEntryPayload,
  AUDIT_GENESIS_HASH,
  clearAuditLog,
  createAuditLog,
  defaultAuditHash,
  loadAuditLog,
  recordRunLifecycleEvents,
  saveAuditLog,
  verifyAuditChain,
} from "./audit"
import { buildOpsRun } from "./fixtures"

describe("audit log", () => {
  it("appends entries with a genesis-linked hash chain", async () => {
    const log = createAuditLog()
    const e1 = await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    expect(e1.seq).toBe(1)
    expect(e1.prevHash).toBe(AUDIT_GENESIS_HASH)
    expect(e1.hash).toMatch(/^[0-9a-f]{16,64}$/)
    const e2 = await appendAuditEvent(log, { type: "run.started", runId: "r1" })
    expect(e2.seq).toBe(2)
    expect(e2.prevHash).toBe(e1.hash)
    expect(log.entries).toHaveLength(2)
  })

  it("verifies a clean chain", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.finished", runId: "r1" })
    const result = await verifyAuditChain(log)
    expect(result.ok).toBe(true)
    expect(result.entriesChecked).toBe(2)
  })

  it("detects tampering with an entry's content", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.finished", runId: "r1" })
    // Tamper: rewrite history.
    log.entries[0].detail = { status: "succeeded" }
    const result = await verifyAuditChain(log)
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe("hash mismatch")
  })

  it("detects a broken prevHash link", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.finished", runId: "r1" })
    log.entries[1].prevHash = "deadbeef"
    const result = await verifyAuditChain(log)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("prevHash mismatch")
  })

  it("detects a seq gap from a middle deletion", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.started", runId: "r1" })
    await appendAuditEvent(log, { type: "run.finished", runId: "r1" })
    // Remove the middle entry — remaining chain is hash-consistent but gapped.
    log.entries.splice(1, 1)
    const result = await verifyAuditChain(log)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("seq gap")
  })

  it("supports an injected synchronous hash function", async () => {
    const hashFn = (input: string) => `h:${input.length}`
    const log = createAuditLog()
    const entry = await appendAuditEvent(log, { type: "run.created", runId: "r1" }, { hashFn })
    expect(entry.hash).toMatch(/^h:\d+$/)
    const result = await verifyAuditChain(log, { hashFn })
    expect(result.ok).toBe(true)
  })

  it("records lifecycle events from run timestamps", async () => {
    const log = createAuditLog()
    const run = buildOpsRun()
    const appended = await recordRunLifecycleEvents(log, run)
    expect(appended.map((e) => e.type)).toEqual(["run.created", "run.started", "run.finished"])
    expect(appended[0].at).toBe(run.createdAt)
    expect((await verifyAuditChain(log)).ok).toBe(true)
  })

  it("filters entries per run", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.created", runId: "r2" })
    await appendAuditEvent(log, { type: "run.shared", runId: "r1" })
    expect(auditEntriesForRun(log, "r1")).toHaveLength(2)
    expect(auditEntriesForRun(log, "r2")).toHaveLength(1)
  })

  it("produces a stable payload for verification", () => {
    const payload = auditEntryPayload({
      seq: 1,
      at: "2026-01-01T00:00:00.000Z",
      type: "run.created",
      runId: "r1",
      prevHash: AUDIT_GENESIS_HASH,
    })
    expect(JSON.parse(payload)).toMatchObject({ seq: 1, runId: "r1", prevHash: "GENESIS" })
  })

  it("persists to localStorage and loads back", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    expect(saveAuditLog(log)).toBe(true)
    const loaded = loadAuditLog()
    expect(loaded.entries).toHaveLength(1)
    expect((await verifyAuditChain(loaded)).ok).toBe(true)
    clearAuditLog()
    expect(loadAuditLog().entries).toHaveLength(0)
  })

  it("defaultAuditHash produces sha256-length hex", async () => {
    const hash = await defaultAuditHash("hello")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
