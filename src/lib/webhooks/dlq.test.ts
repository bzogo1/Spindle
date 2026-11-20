import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createJsonlDlqStore,
  createMemoryDlqStore,
  createWebhookDlq,
  type DeadLetterInput,
  type WebhookDeliverFn,
} from "./dlq"

const baseInput: DeadLetterInput = {
  endpointId: "whk_123",
  eventId: "evt_abc",
  url: "https://receiver.example.com/hooks/spindle",
  rawBody: JSON.stringify({ id: "evt_abc", type: "newsletter.subscribed" }),
  headers: {
    "webhook-id": "evt_abc",
    "webhook-signature": "t=1700000000,v1=deadbeef",
    "content-type": "application/json",
    "idempotency-key": "idem_1",
  },
  attempts: 5,
  lastError: "HTTP 503",
  lastStatus: 503,
  reason: "max-attempts",
}

function makeDlq() {
  return createWebhookDlq({ store: createMemoryDlqStore() })
}

describe("createWebhookDlq — deadLetter", () => {
  it("stores a failed delivery with generated id and timestamp", async () => {
    const dlq = makeDlq()
    const entry = await dlq.deadLetter(baseInput)

    expect(entry.id).toMatch(/^dlq_/)
    expect(entry.deadLetteredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.replayAttempts).toBe(0)
    expect(entry.url).toBe(baseInput.url)
    expect(entry.rawBody).toBe(baseInput.rawBody)
    expect(entry.headers?.["webhook-signature"]).toBe("t=1700000000,v1=deadbeef")

    expect(await dlq.inspect(entry.id)).toEqual(entry)
    expect(await dlq.list()).toHaveLength(1)
  })

  it("honours injected id generator and explicit timestamp", async () => {
    const dlq = createWebhookDlq({
      store: createMemoryDlqStore(),
      idGenerator: () => "dlq_fixed",
    })
    const entry = await dlq.deadLetter({ ...baseInput, deadLetteredAt: "2026-01-01T00:00:00.000Z" })
    expect(entry.id).toBe("dlq_fixed")
    expect(entry.deadLetteredAt).toBe("2026-01-01T00:00:00.000Z")
  })
})

describe("createWebhookDlq — replay", () => {
  const okDeliver: WebhookDeliverFn = async () => ({ ok: true, status: 200 })
  const failDeliver =
    (error = "HTTP 500", status = 500): WebhookDeliverFn =>
    async () => ({ ok: false, error, status })

  it("replayed entries are removed from the queue", async () => {
    const dlq = makeDlq()
    const entry = await dlq.deadLetter(baseInput)

    const result = await dlq.replay(entry.id, okDeliver)
    expect(result).toEqual({ status: "replayed", id: entry.id })
    expect(await dlq.inspect(entry.id)).toBeNull()
    expect(await dlq.list()).toHaveLength(0)
  })

  it("failed replays keep the entry and update bookkeeping", async () => {
    const dlq = makeDlq()
    const entry = await dlq.deadLetter(baseInput)
    const nowSpy = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2026-02-02T00:00:00.000Z")

    const result = await dlq.replay(entry.id, failDeliver("receiver exploded", 502))
    expect(result.status).toBe("failed")
    if (result.status !== "failed") throw new Error("unreachable")
    expect(result.error).toBe("receiver exploded")
    expect(result.entry.replayAttempts).toBe(1)
    expect(result.entry.lastReplayOk).toBe(false)
    expect(result.entry.lastReplayAt).toBe("2026-02-02T00:00:00.000Z")
    expect(result.entry.lastStatus).toBe(502)
    expect(result.entry.lastError).toBe("receiver exploded")

    const stored = await dlq.inspect(entry.id)
    expect(stored?.replayAttempts).toBe(1)
    nowSpy.mockRestore()
  })

  it("deliver exceptions are captured as failed replays, not thrown", async () => {
    const dlq = makeDlq()
    const entry = await dlq.deadLetter(baseInput)

    const throwing: WebhookDeliverFn = async () => {
      throw new Error("socket hangup")
    }
    const result = await dlq.replay(entry.id, throwing)
    expect(result.status).toBe("failed")
    if (result.status === "failed") expect(result.error).toBe("socket hangup")
    expect(await dlq.inspect(entry.id)).not.toBeNull()
  })

  it("returns missing for unknown ids", async () => {
    const dlq = makeDlq()
    expect(await dlq.replay("dlq_nope", okDeliver)).toEqual({ status: "missing", id: "dlq_nope" })
  })

  it("replayAll replays oldest first and summarizes outcomes", async () => {
    const dlq = makeDlq()
    const e1 = await dlq.deadLetter({ ...baseInput, eventId: "evt_1" })
    const e2 = await dlq.deadLetter({ ...baseInput, eventId: "evt_2" })
    const e3 = await dlq.deadLetter({ ...baseInput, eventId: "evt_3" })

    const seen: string[] = []
    const deliver: WebhookDeliverFn = async (entry) => {
      seen.push(entry.id)
      return entry.id === e2.id ? { ok: false, error: "still down" } : { ok: true }
    }

    const summary = await dlq.replayAll(deliver)
    expect(seen).toEqual([e1.id, e2.id, e3.id])
    expect(summary.attempted).toBe(3)
    expect(summary.replayed).toBe(2)
    expect(summary.failed).toBe(1)
    expect(await dlq.list()).toHaveLength(1)
    expect((await dlq.list())[0].id).toBe(e2.id)
  })

  it("replayAll respects the limit option", async () => {
    const dlq = makeDlq()
    await dlq.deadLetter(baseInput)
    await dlq.deadLetter(baseInput)

    const summary = await dlq.replayAll(async () => ({ ok: true }), { limit: 1 })
    expect(summary.attempted).toBe(1)
    expect(await dlq.list()).toHaveLength(1)
  })
})

describe("createWebhookDlq — remove and prune", () => {
  it("remove deletes an entry and reports absence", async () => {
    const dlq = makeDlq()
    const entry = await dlq.deadLetter(baseInput)
    expect(await dlq.remove(entry.id)).toBe(true)
    expect(await dlq.remove(entry.id)).toBe(false)
    expect(await dlq.list()).toHaveLength(0)
  })

  it("prune removes entries older than the cutoff", async () => {
    const dlq = makeDlq()
    const old = await dlq.deadLetter({ ...baseInput, deadLetteredAt: "2020-01-01T00:00:00.000Z" })
    const recent = await dlq.deadLetter({ ...baseInput, deadLetteredAt: new Date().toISOString() })

    const removed = await dlq.prune({ before: Date.now() - 24 * 60 * 60 * 1000 })
    expect(removed).toBe(1)
    const remaining = await dlq.list()
    expect(remaining.map((e) => e.id)).toEqual([recent.id])
    expect(remaining.map((e) => e.id)).not.toContain(old.id)
  })

  it("prune keepLatest retains only the newest N entries", async () => {
    const dlq = makeDlq()
    for (let i = 0; i < 5; i++) {
      await dlq.deadLetter({ ...baseInput, eventId: `evt_${i}` })
    }
    const removed = await dlq.prune({ keepLatest: 2 })
    expect(removed).toBe(3)
    expect(await dlq.list()).toHaveLength(2)
  })
})

describe("createJsonlDlqStore", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "spindle-dlq-"))
    path = join(dir, "nested", "dlq.jsonl")
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("appends, lists, updates and removes entries on disk", async () => {
    const store = createJsonlDlqStore(path)
    const dlq = createWebhookDlq({ store })

    const e1 = await dlq.deadLetter(baseInput)
    const e2 = await dlq.deadLetter({ ...baseInput, eventId: "evt_second" })

    // A fresh store instance over the same file sees persisted entries.
    const reopened = createJsonlDlqStore(path)
    expect((await reopened.list()).map((e) => e.id)).toEqual([e1.id, e2.id])

    await reopened.update({ ...e2, replayAttempts: 3, lastReplayOk: false })
    expect((await reopened.get(e2.id))?.replayAttempts).toBe(3)

    expect(await reopened.remove(e1.id)).toBe(true)
    expect(await reopened.remove(e1.id)).toBe(false)
    expect((await reopened.list()).map((e) => e.id)).toEqual([e2.id])
  })

  it("returns an empty list for a missing file", async () => {
    const store = createJsonlDlqStore(path)
    expect(await store.list()).toEqual([])
  })

  it("skips corrupt lines and drops them on rewrite", async () => {
    const dlq = createWebhookDlq({ store: createJsonlDlqStore(path) })
    await dlq.deadLetter(baseInput)
    // Simulate a torn write by hand.
    await writeFile(path, `${await readFile(path, "utf8")}{not json\n`, "utf8")

    const store = createJsonlDlqStore(path)
    const entries = await store.list()
    expect(entries).toHaveLength(1)
    expect(store.skippedLines()).toBe(1)

    await store.remove(entries[0].id)
    expect(await readFile(path, "utf8")).toBe("")
  })

  it("round-trips entries through replay with the real file", async () => {
    const dlq = createWebhookDlq({ store: createJsonlDlqStore(path) })
    const entry = await dlq.deadLetter(baseInput)

    const result = await dlq.replay(entry.id, async () => ({ ok: true }))
    expect(result.status).toBe("replayed")
    expect(await dlq.list()).toHaveLength(0)
  })
})
