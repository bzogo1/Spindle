/**
 * Run-event stream consumers (task 84).
 *
 * Helpers on top of the existing stream utils (`src/lib/agent-log-stream.ts`,
 * `src/lib/use-agent-run-stream.ts`) that turn a recorded or live event log
 * into:
 *   - a pull-based async iterator with bounded buffering (backpressure),
 *   - a resumable pager that continues from a cursor/`seq`,
 *   - a reducer-friendly `push()` API mirroring `reduceAgentStreamEntries`.
 *
 * All transports are injected, so these helpers are transport-agnostic and
 * unit-testable without EventSource/WebSocket.
 */

import type { AgentRunEvent } from "./types"

/* ------------------------------------------------------------------------ */
/* Backpressure-friendly async iterator                                      */
/* ------------------------------------------------------------------------ */

export interface RunEventQueue {
  /** Feed one event into the stream. */
  push(event: AgentRunEvent): void
  /** Signal that no more events will arrive. */
  close(): void
  /** Async iterator — consumers pull at their own pace. */
  [Symbol.asyncIterator](): AsyncIterator<AgentRunEvent>
}

/**
 * Create a bounded-buffer async queue of run events. Producers `push()`;
 * consumers iterate. When `maxBuffer` is exceeded, `push()` applies
 * `onOverflow` (default: drop oldest) so a fast producer can't grow memory
 * without bound — the backpressure contract.
 */
export function createRunEventQueue(
  options: {
    maxBuffer?: number
    onOverflow?: "drop-oldest" | "drop-newest" | "error"
  } = {},
): RunEventQueue {
  const maxBuffer = Math.max(1, options.maxBuffer ?? 100)
  const onOverflow = options.onOverflow ?? "drop-oldest"

  const buffer: AgentRunEvent[] = []
  const waiters: Array<{
    resolve: (result: IteratorResult<AgentRunEvent>) => void
    reject: (err: unknown) => void
  }> = []
  let closed = false
  let dropped = 0

  function deliver(event: AgentRunEvent) {
    const waiter = waiters.shift()
    if (waiter) {
      waiter.resolve({ value: event, done: false })
      return
    }
    if (buffer.length >= maxBuffer) {
      if (onOverflow === "error") {
        const err = new Error(`Run event buffer overflow (max ${maxBuffer})`)
        for (const w of waiters.splice(0)) w.reject(err)
        closed = true
        return
      }
      if (onOverflow === "drop-oldest") {
        buffer.shift()
        dropped += 1
      } else {
        dropped += 1
        return
      }
    }
    buffer.push(event)
  }

  return {
    push(event: AgentRunEvent) {
      if (closed) return
      deliver(event)
    },
    close() {
      if (closed) return
      closed = true
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined as never, done: true })
      }
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift()!
          continue
        }
        if (closed) return
        const result = await new Promise<IteratorResult<AgentRunEvent>>((resolve, reject) => {
          waiters.push({ resolve, reject })
        })
        if (result.done) return
        yield result.value
      }
    },
    /** Diagnostics: number of events dropped by overflow policy. */
    get droppedCount() {
      return dropped
    },
  } as RunEventQueue & { droppedCount: number }
}

/**
 * Iterate a recorded run's events, optionally with a per-event delay to
 * simulate live pacing. Yields events in `seq` order.
 */
export async function* iterateRunEvents(
  events: readonly AgentRunEvent[],
  options: { delayMs?: (event: AgentRunEvent, index: number) => number } = {},
): AsyncGenerator<AgentRunEvent> {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  for (let i = 0; i < sorted.length; i += 1) {
    const delay = options.delayMs?.(sorted[i], i) ?? 0
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    yield sorted[i]
  }
}

/* ------------------------------------------------------------------------ */
/* Resumable stream                                                          */
/* ------------------------------------------------------------------------ */

export interface RunEventPage {
  events: AgentRunEvent[]
  /** Cursor to pass to the next `load` call; null when exhausted. */
  nextCursor: string | null
}

export interface ResumableStreamOptions {
  /**
   * Load one page of events for a page token (null = first page).
   * Implementations may hit an API, replay a recording, or slice an array.
   *
   * IMPORTANT: `load` must be deterministic — resuming re-fetches the page
   * identified by the resume token and skips already-yielded events by id.
   */
  load: (cursor: string | null) => Promise<RunEventPage> | RunEventPage
  /** Max pages to fetch; guards against infinite loaders. Default 1000. */
  maxPages?: number
}

/**
 * Event-level resume token. `t` is the page token that produced the page
 * containing the last consumed event; `e` is that event's id. On resume the
 * page is re-fetched and events up to and including `e` are skipped, so no
 * mid-page events are lost.
 */
interface ResumeToken {
  t: string | null
  e?: string
}

function encodeResumeToken(token: ResumeToken): string {
  return JSON.stringify(token)
}

/**
 * Decode a resume cursor. Returns null for plain page tokens (backward
 * compatible: a non-JSON cursor is treated as a page token to start from).
 */
function decodeResumeToken(cursor: string): ResumeToken | null {
  try {
    const parsed = JSON.parse(cursor) as unknown
    if (typeof parsed === "object" && parsed !== null && "t" in parsed) {
      const t = (parsed as { t?: unknown }).t
      const e = (parsed as { e?: unknown }).e
      return {
        t: typeof t === "string" ? t : null,
        ...(typeof e === "string" ? { e } : {}),
      }
    }
  } catch {
    // Not JSON — plain page token.
  }
  return null
}

/**
 * Resumable async iterator over paged run events.
 *
 * Events are yielded one at a time from an internal page buffer, so
 * `resumeCursor` is event-granular: resuming re-fetches the page that
 * contained the last yielded event and skips it by id — the unconsumed
 * remainder of that page is NOT dropped.
 *
 * `resumeCursor` returns a JSON-encoded `ResumeToken`; pass it back to
 * `resumeFrom()` (or the constructor's `startCursor`). Plain string page
 * tokens are also accepted for backward compatibility.
 */
export class ResumableRunStream implements AsyncIterable<AgentRunEvent> {
  private pageToken: string | null
  private buffer: AgentRunEvent[] = []
  /** Page token that produced the current buffer (for resume tokens). */
  private bufferPageToken: string | null = null
  private lastYieldedId: string | undefined
  private skipEventId: string | undefined
  private eof = false
  private pagesFetched = 0
  private readonly maxPages: number
  private readonly load: ResumableStreamOptions["load"]

  constructor(options: ResumableStreamOptions, startCursor: string | null = null) {
    this.load = options.load
    this.maxPages = options.maxPages ?? 1000
    if (startCursor !== null) {
      const token = decodeResumeToken(startCursor)
      if (token) {
        this.pageToken = token.t
        this.skipEventId = token.e
      } else {
        this.pageToken = startCursor
      }
    } else {
      this.pageToken = null
    }
  }

  /**
   * Cursor to persist for resuming later. Event-granular: encodes the
   * page token plus the last yielded event id. Before iteration starts
   * this is the raw next-page token.
   */
  get resumeCursor(): string | null {
    if (this.lastYieldedId !== undefined) {
      return encodeResumeToken({
        t: this.bufferPageToken,
        e: this.lastYieldedId,
      })
    }
    return this.pageToken
  }

  /** Create a new stream continuing from a previously saved cursor. */
  resumeFrom(cursor: string | null): ResumableRunStream {
    return new ResumableRunStream({ load: this.load, maxPages: this.maxPages }, cursor)
  }

  private async fetchPage(): Promise<void> {
    const requestToken = this.pageToken
    const page = await this.load(requestToken)
    this.pagesFetched += 1
    this.bufferPageToken = requestToken
    this.pageToken = page.nextCursor
    this.buffer = page.events.slice()
    if (this.skipEventId !== undefined) {
      // Resume mid-page: drop events through the last consumed one.
      // If the id isn't found (non-deterministic loader), keep the
      // whole page rather than silently dropping events.
      const idx = this.buffer.findIndex((e) => e.id === this.skipEventId)
      if (idx !== -1) this.buffer = this.buffer.slice(idx + 1)
      this.skipEventId = undefined
    }
    if (page.nextCursor === null || page.nextCursor === requestToken) {
      this.eof = true
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AgentRunEvent> {
    for (;;) {
      if (this.buffer.length === 0) {
        if (this.eof || this.pagesFetched >= this.maxPages) return
        await this.fetchPage()
        // An empty page that isn't EOF: keep paging. EOF or empty
        // buffer at maxPages falls through to the guard above.
        if (this.buffer.length === 0 && this.eof) return
        continue
      }
      const event = this.buffer.shift()!
      this.lastYieldedId = event.id
      yield event
    }
  }
}

/**
 * Collect an async iterable of run events into an array — handy for tests and
 * for "replay to completion" callers.
 */
export async function collectRunEvents(
  iterable: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const out: AgentRunEvent[] = []
  for await (const event of iterable) out.push(event)
  return out
}
