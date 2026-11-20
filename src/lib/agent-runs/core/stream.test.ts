import { describe, expect, it } from "vitest"

import {
  collectRunEvents,
  createRunEventQueue,
  iterateRunEvents,
  ResumableRunStream,
  type RunEventPage,
} from "./stream"
import { makeEvent, makeRun } from "./fixtures"
import type { AgentRunEvent } from "./types"

function event(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return makeEvent(overrides)
}

describe("createRunEventQueue", () => {
  it("yields pushed events in order then completes on close", async () => {
    const queue = createRunEventQueue()
    const seen: string[] = []
    const done = (async () => {
      for await (const e of queue) seen.push(e.id)
    })()
    queue.push(event({ id: "a", seq: 1 }))
    queue.push(event({ id: "b", seq: 2 }))
    queue.close()
    await done
    expect(seen).toEqual(["a", "b"])
  })

  it("buffers events pushed before iteration starts", async () => {
    const queue = createRunEventQueue()
    queue.push(event({ id: "a", seq: 1 }))
    queue.push(event({ id: "b", seq: 2 }))
    queue.close()
    const collected = await collectRunEvents(queue)
    expect(collected.map((e) => e.id)).toEqual(["a", "b"])
  })

  it("applies backpressure: drops oldest beyond maxBuffer", async () => {
    const queue = createRunEventQueue({ maxBuffer: 3 })
    for (let i = 0; i < 5; i += 1) queue.push(event({ id: `e${i}`, seq: i + 1 }))
    queue.close()
    const collected = await collectRunEvents(queue)
    expect(collected.map((e) => e.id)).toEqual(["e2", "e3", "e4"])
    expect((queue as unknown as { droppedCount: number }).droppedCount).toBe(2)
  })

  it("supports drop-newest overflow policy", async () => {
    const queue = createRunEventQueue({ maxBuffer: 2, onOverflow: "drop-newest" })
    for (let i = 0; i < 4; i += 1) queue.push(event({ id: `e${i}`, seq: i + 1 }))
    queue.close()
    const collected = await collectRunEvents(queue)
    expect(collected.map((e) => e.id)).toEqual(["e0", "e1"])
  })

  it("ignores pushes after close", async () => {
    const queue = createRunEventQueue()
    queue.close()
    queue.push(event({ id: "late", seq: 1 }))
    expect(await collectRunEvents(queue)).toHaveLength(0)
  })
})

describe("iterateRunEvents", () => {
  it("yields events sorted by seq", async () => {
    const run = makeRun({
      events: [event({ id: "c", seq: 3 }), event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 })],
    })
    const collected = await collectRunEvents(iterateRunEvents(run.events))
    expect(collected.map((e) => e.id)).toEqual(["a", "b", "c"])
  })
})

describe("ResumableRunStream", () => {
  function pagedLoader(pages: RunEventPage[]) {
    let index = 0
    return (cursor: string | null): RunEventPage => {
      const pageIndex = cursor === null ? 0 : Number(cursor)
      void index
      index = pageIndex + 1
      return pages[pageIndex] ?? { events: [], nextCursor: null }
    }
  }

  const pages: RunEventPage[] = [
    { events: [event({ id: "a", seq: 1 }), event({ id: "b", seq: 2 })], nextCursor: "1" },
    { events: [event({ id: "c", seq: 3 })], nextCursor: null },
  ]

  it("iterates all pages in order", async () => {
    const stream = new ResumableRunStream({ load: pagedLoader(pages) })
    const collected = await collectRunEvents(stream)
    expect(collected.map((e) => e.id)).toEqual(["a", "b", "c"])
    // Cursor is event-granular: page token + last yielded event id.
    const cursor = JSON.parse(stream.resumeCursor!) as { t: string | null; e: string }
    expect(cursor).toEqual({ t: "1", e: "c" })
  })

  it("resumes from a saved page cursor", async () => {
    const stream = new ResumableRunStream({ load: pagedLoader(pages) }, "1")
    const collected = await collectRunEvents(stream)
    expect(collected.map((e) => e.id)).toEqual(["c"])
  })

  it("resumeFrom creates a continuing stream", async () => {
    const first = new ResumableRunStream({ load: pagedLoader(pages) })
    const it = first[Symbol.asyncIterator]()
    await it.next() // "a"
    await it.next() // "b"
    const cursor = first.resumeCursor
    const resumed = first.resumeFrom(cursor)
    const rest = await collectRunEvents(resumed)
    expect(rest.map((e) => e.id)).toEqual(["c"])
  })

  it("resume mid-page does not drop unconsumed events", async () => {
    const first = new ResumableRunStream({ load: pagedLoader(pages) })
    const it = first[Symbol.asyncIterator]()
    await it.next() // "a" only — "b" is still buffered in page 0
    const cursor = first.resumeCursor
    const resumed = first.resumeFrom(cursor)
    const rest = await collectRunEvents(resumed)
    // Page 0 is re-fetched and skipped through "a", so "b" survives.
    expect(rest.map((e) => e.id)).toEqual(["b", "c"])
  })

  it("resume after the last event of a page yields the next page", async () => {
    const first = new ResumableRunStream({ load: pagedLoader(pages) })
    const it = first[Symbol.asyncIterator]()
    await it.next() // "a"
    await it.next() // "b" — last event of page 0
    const resumed = first.resumeFrom(first.resumeCursor)
    const rest = await collectRunEvents(resumed)
    expect(rest.map((e) => e.id)).toEqual(["c"])
  })

  it("resuming a fully consumed stream yields nothing", async () => {
    const first = new ResumableRunStream({ load: pagedLoader(pages) })
    await collectRunEvents(first)
    const resumed = first.resumeFrom(first.resumeCursor)
    expect(await collectRunEvents(resumed)).toHaveLength(0)
  })

  it("stops when nextCursor does not advance", async () => {
    let calls = 0
    const stream = new ResumableRunStream(
      {
        load: (cursor) => {
          calls += 1
          return {
            events: [event({ id: `e${calls}`, seq: calls })],
            // Echo the request cursor back — the loader is stuck.
            nextCursor: cursor ?? "stuck",
          }
        },
      },
      "stuck",
    )
    const collected = await collectRunEvents(stream)
    expect(collected).toHaveLength(1)
    expect(calls).toBe(1)
  })
})
