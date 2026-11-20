import { describe, expect, it, vi } from "vitest"

import { backoffDelayMs, UploadQueue } from "./queue"
import { MemoryUploadStore } from "./persistence"
import { MockUploadTransport } from "./transport"

const instantSleep = () => Promise.resolve()

function makeFile(name: string, size: number, lastModified = 1_700_000_000_000): File {
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) data[i] = i % 251
  return new File([data], name, { type: "application/octet-stream", lastModified })
}

async function waitFor(cond: () => boolean, timeout = 2000): Promise<void> {
  await vi.waitUntil(cond, { timeout, interval: 5 })
}

describe("backoffDelayMs", () => {
  it("grows exponentially and caps at maxMs when jitter is 0", () => {
    expect(backoffDelayMs(1, 100, 10_000, 0)).toBe(100)
    expect(backoffDelayMs(2, 100, 10_000, 0)).toBe(200)
    expect(backoffDelayMs(3, 100, 10_000, 0)).toBe(400)
    expect(backoffDelayMs(10, 100, 10_000, 0)).toBe(10_000)
  })

  it("stays within jitter bounds", () => {
    for (let i = 0; i < 50; i++) {
      const d = backoffDelayMs(2, 100, 10_000, 0.5)
      expect(d).toBeGreaterThanOrEqual(100)
      expect(d).toBeLessThanOrEqual(300)
    }
  })
})

describe("UploadQueue", () => {
  it("uploads multiple files to completion with aggregate progress", async () => {
    const transport = new MockUploadTransport()
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      concurrency: 2,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready

    const ids = queue.addFiles([makeFile("a.bin", 25), makeFile("b.bin", 30)])
    expect(ids).toHaveLength(2)

    await waitFor(() => queue.getSnapshot().totals.completedFiles === 2)

    const snap = queue.getSnapshot()
    expect(snap.totals.percent).toBe(100)
    expect(transport.stats.completes).toBe(2)
    expect(snap.files.every((f) => f.status === "completed" && f.percent === 100)).toBe(true)
  })

  it("respects the concurrency limit", async () => {
    const transport = new MockUploadTransport({ latencyMs: 10 })
    let active = 0
    let maxActive = 0
    const orig = transport.uploadPart.bind(transport)
    transport.uploadPart = async (...args) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        return await orig(...args)
      } finally {
        active -= 1
      }
    }

    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      concurrency: 2,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready
    queue.addFiles([makeFile("a", 50), makeFile("b", 50), makeFile("c", 50), makeFile("d", 50)])

    await waitFor(() => queue.getSnapshot().totals.completedFiles === 4)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(maxActive).toBeGreaterThan(0)
  })

  it("pauses mid-upload and resumes without re-uploading finished parts", async () => {
    const transport = new MockUploadTransport({ latencyMs: 15 })
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      concurrency: 1,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready

    const [id] = queue.addFiles([makeFile("big.bin", 100)])
    await waitFor(() => {
      const f = queue.getSnapshot().files[0]
      return f && f.uploadedParts >= 1 && f.status === "uploading"
    })

    queue.pause(id)
    await waitFor(() => queue.getSnapshot().files[0].status === "paused")
    const pausedParts = queue.getSnapshot().files[0].uploadedParts
    expect(pausedParts).toBeGreaterThanOrEqual(1)

    queue.resume(id)
    await waitFor(() => queue.getSnapshot().files[0].status === "completed")

    // 10 parts total; each succeeded exactly once (aborted attempts don't count).
    expect(transport.uploadCount).toBe(10)
    expect(queue.getSnapshot().files[0].uploadedParts).toBe(10)
  })

  it("retries a failed part with backoff then completes", async () => {
    const transport = new MockUploadTransport({
      shouldFail: ({ partNumber, attempt }) => partNumber === 1 && attempt === 1,
    })
    const sleep = vi.fn(instantSleep)
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      chunkSize: 10,
      sleep,
      checksums: false,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      jitter: 0,
    })
    await queue.ready

    queue.addFiles([makeFile("retry.bin", 20)])
    await waitFor(() => queue.getSnapshot().totals.completedFiles === 1)

    expect(sleep).toHaveBeenCalledWith(250) // first retry backoff, no jitter
    expect(transport.uploadCount).toBe(2) // part1 + part2, each succeeded once
  })

  it("marks the file as error after maxAttempts", async () => {
    const transport = new MockUploadTransport({
      shouldFail: ({ partNumber }) => partNumber === 1,
    })
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
      maxAttempts: 3,
      jitter: 0,
    })
    await queue.ready

    queue.addFiles([makeFile("fail.bin", 20)])
    await waitFor(() => queue.getSnapshot().files[0]?.status === "error")

    const file = queue.getSnapshot().files[0]
    expect(file.error).toContain("mock upload failure")
    expect(file.parts[0].attempts).toBe(3)
  })

  it("retry() resets failed parts and completes the file", async () => {
    let fail = true
    const transport = new MockUploadTransport({
      shouldFail: ({ partNumber, attempt }) => fail && partNumber === 1 && attempt <= 3,
    })
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
      maxAttempts: 2,
      jitter: 0,
    })
    await queue.ready

    const [id] = queue.addFiles([makeFile("flaky.bin", 20)])
    await waitFor(() => queue.getSnapshot().files[0]?.status === "error")

    fail = false
    expect(queue.retry(id)).toBe(true)
    await waitFor(() => queue.getSnapshot().files[0].status === "completed")
  })

  it("cancel stops the upload but keeps parts resumable", async () => {
    const transport = new MockUploadTransport({ latencyMs: 20 })
    const store = new MemoryUploadStore()
    const queue = new UploadQueue({
      transport,
      store,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready

    const [id] = queue.addFiles([makeFile("cancel.bin", 100)])
    await waitFor(() => queue.getSnapshot().files[0].status === "uploading")
    queue.cancel(id)
    await waitFor(() => queue.getSnapshot().files[0].status === "cancelled")

    const persisted = await store.load()
    expect(persisted).toHaveLength(1)
    expect(persisted[0].status).toBe("cancelled")

    queue.resume(id)
    await waitFor(() => queue.getSnapshot().files[0].status === "completed")
    expect(transport.stats.completes).toBe(1)
  })

  it("persists state and resumes an incomplete upload after reload", async () => {
    const transport = new MockUploadTransport({ latencyMs: 15 })
    const store = new MemoryUploadStore()
    const file = makeFile("resume.bin", 100)

    const q1 = new UploadQueue({
      transport,
      store,
      concurrency: 1,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await q1.ready
    const [id1] = q1.addFiles([file])
    await waitFor(() => {
      const f = q1.getSnapshot().files[0]
      return f && f.uploadedParts >= 1
    })
    q1.pause(id1)
    await waitFor(() => q1.getSnapshot().files[0].status === "paused")

    const persisted = await store.load()
    expect(persisted).toHaveLength(1)
    expect(persisted[0].uploadedParts.length).toBeGreaterThanOrEqual(1)

    // Simulate reload: new queue, same store + transport.
    const q2 = new UploadQueue({
      transport,
      store,
      concurrency: 1,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await q2.ready

    const restored = q2.getSnapshot().files
    expect(restored).toHaveLength(1)
    expect(restored[0].awaitingFile).toBe(true)
    expect(restored[0].status).toBe("paused")
    expect(restored[0].uploadedParts).toBe(persisted[0].uploadedParts.length)

    // Re-selecting the same file reattaches and resumes automatically.
    const id2 = q2.addFile(file)
    expect(id2).toBe(restored[0].id)
    await waitFor(() => q2.getSnapshot().files[0].status === "completed")

    // Every part uploaded exactly once across both "sessions".
    expect(transport.uploadCount).toBe(10)
    expect(transport.stats.completes).toBe(1)
    expect(await store.load()).toHaveLength(0) // completed entries are dropped
  })

  it("handles empty files", async () => {
    const transport = new MockUploadTransport()
    const queue = new UploadQueue({
      transport,
      store: new MemoryUploadStore(),
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready
    queue.addFiles([makeFile("empty.bin", 0)])
    await waitFor(() => queue.getSnapshot().totals.completedFiles === 1)
  })

  it("remove() discards the entry and aborts the remote session", async () => {
    const transport = new MockUploadTransport({ latencyMs: 20 })
    const store = new MemoryUploadStore()
    const queue = new UploadQueue({
      transport,
      store,
      chunkSize: 10,
      sleep: instantSleep,
      checksums: false,
    })
    await queue.ready

    const [id] = queue.addFiles([makeFile("gone.bin", 50)])
    await waitFor(() => queue.getSnapshot().files[0].status === "uploading")
    await queue.remove(id)

    expect(queue.getSnapshot().files).toHaveLength(0)
    expect(await store.load()).toHaveLength(0)
    expect(transport.stats.aborts).toBe(1)
  })
})
