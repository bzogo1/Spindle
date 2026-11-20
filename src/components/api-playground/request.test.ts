import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildHeaders,
  buildUrl,
  clearHistory,
  executeRequest,
  formatJson,
  historyEntryFromResponse,
  interpolatePath,
  loadHistory,
  missingPathParams,
  parseRequestBody,
  pathParamNames,
  saveHistoryEntry,
  type HistoryEntry,
} from "./request"

describe("interpolatePath / pathParamNames", () => {
  it("replaces {param} segments", () => {
    expect(interpolatePath("/api/auth/oauth/{provider}", { provider: "google" })).toBe(
      "/api/auth/oauth/google",
    )
  })

  it("leaves unknown params in place and encodes values", () => {
    expect(interpolatePath("/api/x/{a}/{b}", { a: "a b" })).toBe("/api/x/a%20b/{b}")
  })

  it("lists param names", () => {
    expect(pathParamNames("/api/a/{x}/b/{y}")).toEqual(["x", "y"])
    expect(pathParamNames("/api/plain")).toEqual([])
  })
})

describe("missingPathParams", () => {
  it("reports template params without a non-empty value", () => {
    expect(missingPathParams("/api/a/{x}/b/{y}", { x: "1" })).toEqual(["y"])
    expect(missingPathParams("/api/a/{x}", { x: "  " })).toEqual(["x"])
    expect(missingPathParams("/api/a/{x}", { x: "v" })).toEqual([])
    expect(missingPathParams("/api/plain")).toEqual([])
    expect(missingPathParams("/api/a/{x}")).toEqual(["x"])
  })
})

describe("buildUrl", () => {
  it("builds path with substituted params and query string", () => {
    const url = buildUrl({
      method: "GET",
      path: "/api/auth/oauth/{provider}",
      pathParams: { provider: "github" },
      query: [
        { key: "scope", value: "read" },
        { key: "", value: "ignored" },
        { key: "state", value: "a b" },
      ],
    })
    expect(url).toBe("/api/auth/oauth/github?scope=read&state=a+b")
  })

  it("returns bare path without query", () => {
    expect(buildUrl({ method: "GET", path: "/api/profile" })).toBe("/api/profile")
  })
})

describe("buildHeaders", () => {
  it("adds bearer token and JSON content type", () => {
    const headers = buildHeaders({
      method: "POST",
      path: "/api/x",
      body: '{"a":1}',
      token: "tok123",
    })
    expect(headers["authorization"]).toBe("Bearer tok123")
    expect(headers["content-type"]).toBe("application/json")
  })

  it("omits content-type without a body", () => {
    const headers = buildHeaders({ method: "GET", path: "/api/x" })
    expect(headers["content-type"]).toBeUndefined()
  })

  it("merges custom headers, skipping empty keys", () => {
    const headers = buildHeaders({
      method: "GET",
      path: "/api/x",
      headers: [
        { key: "x-trace", value: "abc" },
        { key: "  ", value: "skip" },
        { key: "Content-Type", value: "text/plain" },
      ],
      body: "hi",
      token: "t",
    })
    expect(headers["x-trace"]).toBe("abc")
    expect(headers["content-type"]).toBe("text/plain")
    expect(headers["authorization"]).toBe("Bearer t")
  })

  it("token field wins over a custom Authorization header", () => {
    const headers = buildHeaders({
      method: "GET",
      path: "/api/x",
      headers: [{ key: "Authorization", value: "Bearer custom" }],
      token: "official",
    })
    expect(headers["authorization"]).toBe("Bearer official")
  })
})

describe("parseRequestBody / formatJson", () => {
  it("parses JSON bodies", () => {
    expect(parseRequestBody('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseRequestBody("")).toEqual({ ok: true, value: undefined })
    expect(parseRequestBody(undefined)).toEqual({ ok: true, value: undefined })
  })

  it("reports invalid JSON", () => {
    const result = parseRequestBody("{bad")
    expect(result.ok).toBe(false)
  })

  it("pretty prints values", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(formatJson(undefined)).toBe("")
  })
})

describe("executeRequest", () => {
  it("sends method, headers, and JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      }),
    )
    const result = await executeRequest(
      {
        method: "post",
        path: "/api/test",
        query: [{ key: "q", value: "1" }],
        body: '{"a":1}',
        token: "t",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0 },
    )
    expect(result.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(result.bodyJson).toEqual({ ok: true })
    expect(result.url).toBe("/api/test?q=1")

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("/api/test?q=1")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t")
    expect(init.body).toBe('{"a":1}')
  })

  it("returns status 0 on invalid JSON body without fetching", async () => {
    const fetchImpl = vi.fn()
    const result = await executeRequest(
      { method: "POST", path: "/api/x", body: "{nope" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result.status).toBe(0)
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns status 0 on network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"))
    const result = await executeRequest(
      { method: "GET", path: "/api/x" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result.status).toBe(0)
    expect(result.bodyText).toBe("boom")
  })

  it("keeps non-JSON bodies as text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("plain text", { status: 200 }))
    const result = await executeRequest(
      { method: "GET", path: "/api/x" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result.bodyText).toBe("plain text")
    expect(result.bodyJson).toBeUndefined()
  })

  it("strips the body for GET and HEAD requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    for (const method of ["GET", "HEAD"]) {
      await executeRequest(
        { method, path: "/api/x", body: '{"a":1}' },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      )
    }
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).body).toBeUndefined()
      expect(
        ((call[1] as RequestInit).headers as Record<string, string>)["content-type"],
      ).toBeUndefined()
    }
  })

  it("still sends bodies for POST/PUT/PATCH/DELETE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await executeRequest(
        { method, path: "/api/x", body: '{"a":1}' },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      )
    }
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).body).toBe('{"a":1}')
    }
  })

  it("JSON-stringifies primitive bodies so they stay valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    await executeRequest(
      { method: "POST", path: "/api/x", body: '"just a string"' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    await executeRequest(
      { method: "POST", path: "/api/x", body: "42" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    await executeRequest(
      { method: "POST", path: "/api/x", body: "true" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    const bodies = fetchImpl.mock.calls.map((c) => (c[1] as RequestInit).body)
    expect(bodies).toEqual(['"just a string"', "42", "true"])
  })
})

describe("history", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function entry(id: string, timestamp = 1): HistoryEntry {
    return { id, timestamp, method: "GET", url: "/api/x", status: 200, durationMs: 5, ok: true }
  }

  it("saves and loads entries newest-first", () => {
    saveHistoryEntry(entry("a", 1))
    saveHistoryEntry(entry("b", 2))
    const history = loadHistory()
    expect(history.map((e) => e.id)).toEqual(["b", "a"])
  })

  it("dedupes by id and caps at 25", () => {
    saveHistoryEntry(entry("a"))
    saveHistoryEntry(entry("a"))
    expect(loadHistory()).toHaveLength(1)
    for (let i = 0; i < 30; i++) saveHistoryEntry(entry(`e${i}`, i))
    expect(loadHistory()).toHaveLength(25)
    expect(loadHistory()[0].id).toBe("e29")
  })

  it("clears history", () => {
    saveHistoryEntry(entry("a"))
    clearHistory()
    expect(loadHistory()).toEqual([])
  })

  it("returns [] for corrupt storage", () => {
    window.localStorage.setItem("spindle.playground.history", "{bad")
    expect(loadHistory()).toEqual([])
  })

  it("builds history entries from responses", () => {
    const entryResult = historyEntryFromResponse(
      { method: "get", path: "/api/x" },
      {
        url: "/api/x",
        method: "GET",
        status: 404,
        statusText: "Not Found",
        headers: {},
        bodyText: "",
        bodyJson: undefined,
        durationMs: 3,
        ok: false,
      },
    )
    expect(entryResult.method).toBe("GET")
    expect(entryResult.status).toBe(404)
    expect(entryResult.ok).toBe(false)
  })
})
