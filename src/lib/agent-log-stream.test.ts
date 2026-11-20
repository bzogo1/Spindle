import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelAgentRunRequest,
  filterAgentStreamEntries,
  highlightRanges,
  parseStreamPayload,
  reduceAgentStreamEntries,
  resetStreamIdCounter,
  resolveAgentApprovalRequest,
  resolveStreamApproval,
  SseParser,
  streamSources,
  type AgentStreamEntry,
} from "./agent-log-stream"

function entry(overrides: Partial<AgentStreamEntry> = {}): AgentStreamEntry {
  return {
    id: "e1",
    timestamp: "2026-11-19T12:00:00.000Z",
    level: "info",
    source: "agent",
    kind: "log",
    message: "hello",
    ...overrides,
  }
}

describe("SseParser", () => {
  it("parses a simple event", () => {
    const parser = new SseParser()
    const events = parser.push('event: log\ndata: {"message":"hi"}\n\n')
    expect(events).toEqual([{ event: "log", data: '{"message":"hi"}' }])
  })

  it("handles events split across arbitrary chunk boundaries", () => {
    const parser = new SseParser()
    const raw = 'event: status\ndata: {"runStatus":"running"}\n\ndata: plain text\n\n'
    const events = []
    for (const ch of raw) events.push(...parser.push(ch))
    expect(events).toEqual([
      { event: "status", data: '{"runStatus":"running"}' },
      { event: "message", data: "plain text" },
    ])
  })

  it("joins multi-line data fields and ignores comments/retry", () => {
    const parser = new SseParser()
    const events = parser.push(
      ": keep-alive\nretry: 3000\ndata: line one\ndata: line two\nid: 42\n\n",
    )
    expect(events).toEqual([{ event: "message", data: "line one\nline two", id: "42" }])
  })

  it("handles CRLF line endings", () => {
    const parser = new SseParser()
    const events = parser.push("event: done\r\ndata: {}\r\n\r\n")
    expect(events).toEqual([{ event: "done", data: "{}" }])
  })

  it("flushes a trailing unterminated event on end()", () => {
    const parser = new SseParser()
    expect(parser.push("data: tail")).toEqual([])
    expect(parser.end()).toEqual([{ event: "message", data: "tail" }])
  })
})

describe("parseStreamPayload", () => {
  beforeEach(() => resetStreamIdCounter())

  it("normalizes a JSON log payload", () => {
    const parsed = parseStreamPayload(
      JSON.stringify({
        id: "evt_1",
        timestamp: "2026-11-19T12:00:01.000Z",
        level: "warn",
        source: "tool",
        message: "slow query",
        data: { ms: 900 },
      }),
    )
    expect(parsed).toMatchObject({
      id: "evt_1",
      level: "warn",
      source: "tool",
      kind: "log",
      message: "slow query",
      data: { ms: 900 },
    })
  })

  it("maps SSE event types to kinds", () => {
    expect(parseStreamPayload("{}", "approval")?.kind).toBe("approval_required")
    expect(parseStreamPayload("{}", "chunk")?.kind).toBe("chunk")
    expect(parseStreamPayload("{}", "done")?.kind).toBe("done")
    expect(parseStreamPayload("{}", "error")?.kind).toBe("error")
  })

  it("treats plain-text data as a log message", () => {
    const parsed = parseStreamPayload("plain output")
    expect(parsed?.message).toBe("plain output")
    expect(parsed?.kind).toBe("log")
  })

  it("lifts approval fields into data", () => {
    const parsed = parseStreamPayload(
      JSON.stringify({
        type: "approval",
        approvalId: "appr_9",
        action: "delete_file",
        summary: "Delete old export",
      }),
    )
    expect(parsed?.kind).toBe("approval_required")
    expect(parsed?.data).toMatchObject({
      approvalId: "appr_9",
      action: "delete_file",
      summary: "Delete old export",
    })
  })

  it("returns null for empty payloads", () => {
    expect(parseStreamPayload("")).toBeNull()
    expect(parseStreamPayload("   ")).toBeNull()
    expect(parseStreamPayload(null as unknown as string)).toBeNull()
  })
})

describe("reduceAgentStreamEntries", () => {
  it("appends new entries and dedupes by id", () => {
    const first = entry({ id: "a" })
    const list = reduceAgentStreamEntries([], first)
    expect(list).toHaveLength(1)
    const again = reduceAgentStreamEntries(list, entry({ id: "a", message: "dup" }))
    expect(again).toBe(list) // same reference — no rerender
    expect(again[0].message).toBe("hello")
  })

  it("appends chunk messages onto the targeted entry", () => {
    let list = reduceAgentStreamEntries([], entry({ id: "msg", message: "Hel" }))
    list = reduceAgentStreamEntries(list, entry({ id: "msg", kind: "chunk", message: "lo " }))
    list = reduceAgentStreamEntries(list, entry({ id: "msg", kind: "chunk", message: "world" }))
    expect(list).toHaveLength(1)
    expect(list[0].message).toBe("Hello world")
  })

  it("keeps earlier entries immutable when appending", () => {
    const first = entry({ id: "a" })
    const list = reduceAgentStreamEntries([first], entry({ id: "b" }))
    expect(list[0]).toBe(first)
    expect(list).toHaveLength(2)
  })
})

describe("resolveStreamApproval", () => {
  it("marks the matching approval entry resolved", () => {
    const approval = entry({
      id: "ap1",
      kind: "approval_required",
      data: { approvalId: "appr_1", status: "pending" },
    })
    const other = entry({ id: "ap2", kind: "approval_required", data: { approvalId: "appr_2" } })
    const resolved = resolveStreamApproval([approval, other], "appr_1", "approved")
    expect(resolved[0].data?.status).toBe("approved")
    expect(resolved[1].data?.status).toBeUndefined()
  })

  it("returns the same array when nothing matches", () => {
    const list = [entry({ kind: "approval_required", data: { approvalId: "x" } })]
    expect(resolveStreamApproval(list, "y", "rejected")).toBe(list)
  })
})

describe("filterAgentStreamEntries", () => {
  const entries = [
    entry({ id: "1", message: "Reading survey.parquet", source: "tool", level: "info" }),
    entry({ id: "2", message: "Query took 4s", source: "agent", level: "warn" }),
    entry({
      id: "3",
      message: "permission denied",
      source: "system",
      level: "error",
      kind: "error",
    }),
  ]

  it("returns everything with an empty filter", () => {
    expect(filterAgentStreamEntries(entries, {})).toBe(entries)
  })

  it("filters by case-insensitive text query", () => {
    const result = filterAgentStreamEntries(entries, { query: "SURVEY" })
    expect(result.map((e) => e.id)).toEqual(["1"])
  })

  it("filters by level, source, and kind", () => {
    expect(filterAgentStreamEntries(entries, { level: "error" }).map((e) => e.id)).toEqual(["3"])
    expect(filterAgentStreamEntries(entries, { source: "agent" }).map((e) => e.id)).toEqual(["2"])
    expect(filterAgentStreamEntries(entries, { kind: "error" }).map((e) => e.id)).toEqual(["3"])
  })

  it("combines filters", () => {
    expect(filterAgentStreamEntries(entries, { query: "query", level: "warn" })).toHaveLength(1)
    expect(filterAgentStreamEntries(entries, { query: "query", level: "error" })).toHaveLength(0)
  })
})

describe("streamSources / highlightRanges", () => {
  it("lists distinct sources sorted", () => {
    const entries = [
      entry({ source: "tool" }),
      entry({ source: "agent" }),
      entry({ source: "tool" }),
    ]
    expect(streamSources(entries)).toEqual(["agent", "tool"])
  })

  it("finds non-overlapping case-insensitive ranges", () => {
    expect(highlightRanges("Foo foo FOO bar", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ])
    expect(highlightRanges("nothing", "")).toEqual([])
    expect(highlightRanges("abc", "z")).toEqual([])
  })
})

describe("control-plane requests", () => {
  // Note: no mockReset here — resetting the global fetch stub interferes with
  // rejection propagation in this vitest/jsdom setup. Each test sets its own
  // implementation explicitly.

  it("posts to the cancel endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const result = await cancelAgentRunRequest("run 1")
    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/runs/run%201/cancel",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("posts approval decisions", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
    const result = await resolveAgentApprovalRequest("r1", "ap 1", "rejected")
    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/runs/r1/approvals/ap%201",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "rejected" }),
      }),
    )
  })

  it("returns a graceful error on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "run already finished" }), { status: 409 }),
    )
    const result = await cancelAgentRunRequest("r1")
    expect(result).toEqual({ ok: false, error: "run already finished" })
  })

  it("returns a graceful error on network failure", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error("offline")))
    const result = await resolveAgentApprovalRequest("r1", "a1", "approved")
    expect(result).toEqual({ ok: false, error: "offline" })
  })
})
