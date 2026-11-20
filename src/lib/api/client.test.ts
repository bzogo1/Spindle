import { afterEach, describe, expect, it, vi } from "vitest"

import { ensureFreshSession } from "@/lib/auth/auth-client"

import { ApiError, request } from "./client"

vi.mock("@/lib/auth/auth-client", () => ({
  ensureFreshSession: vi.fn(async () => null),
}))

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers as object) },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(ensureFreshSession).mockClear()
  vi.mocked(ensureFreshSession).mockResolvedValue(null)
})

describe("request", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    )
    await expect(request("http://api.test", "/thing")).resolves.toEqual({ ok: true })
  })

  it("sends credentials, JSON headers and a serialized body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "1" }))
    vi.stubGlobal("fetch", fetchMock)

    await request("http://api.test", "/things", {
      method: "POST",
      body: { name: "x" },
      headers: { "x-trace": "abc" },
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://api.test/things")
    expect(init.credentials).toBe("include")
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ name: "x" }))
    const headers = init.headers as Record<string, string>
    expect(headers["content-type"]).toBe("application/json")
    expect(headers["x-trace"]).toBe("abc")
  })

  it("joins relative base URLs without doubling slashes", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal("fetch", fetchMock)

    await request("/api/", "/projects")
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/projects")
  })

  it("resolves undefined for 204 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    await expect(
      request("http://api.test", "/thing", { method: "DELETE" }),
    ).resolves.toBeUndefined()
  })

  it("normalizes structured error bodies and the request id header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "quota_exceeded", message: "Over quota." } },
          { status: 429, headers: { "x-request-id": "req-123" } },
        ),
      ),
    )

    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 429,
      code: "quota_exceeded",
      message: "Over quota.",
      requestId: "req-123",
    })
  })

  it("falls back to a status-derived code for flat error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Gone." }, { status: 410 })),
    )

    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 410, code: "http_error", message: "Gone." })
  })

  it("handles non-JSON error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream exploded", { status: 502 })),
    )

    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: "server_error" })
  })

  it("maps network failures to a null-status ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    )

    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: null, code: "network_error" })
  })

  it("maps caller aborts to an aborted ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            )
          }),
      ),
    )

    const controller = new AbortController()
    const pending = request("http://api.test", "/thing", { signal: controller.signal })
    controller.abort()

    const error = await pending.catch((e: unknown) => e)
    expect(error).toMatchObject({ status: null, code: "aborted" })
  })

  it.each([
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [422, "validation_error"],
    [429, "rate_limited"],
    [500, "server_error"],
    [418, "http_error"],
  ])("maps status %i to code %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status })),
    )
    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toMatchObject({ status, code })
  })

  it("times out when the server never responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation timed out.", "TimeoutError")),
            )
          }),
      ),
    )

    const error = await request("http://api.test", "/thing", { timeoutMs: 20 }).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ code: "timeout", status: null })
  })

  it("rejects malformed JSON on successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json{", { status: 200 })),
    )

    const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 200, code: "invalid_response" })
  })

  describe("401 session refresh", () => {
    it("refreshes the session and retries once after a 401", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("expired", { status: 401 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
      vi.stubGlobal("fetch", fetchMock)

      await expect(request("http://api.test", "/thing")).resolves.toEqual({ ok: true })
      expect(ensureFreshSession).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("propagates the error when the retry is still a 401", async () => {
      const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }))
      vi.stubGlobal("fetch", fetchMock)

      const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 401, code: "unauthorized" })
      expect(ensureFreshSession).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("does not refresh or retry on non-401 errors", async () => {
      const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }))
      vi.stubGlobal("fetch", fetchMock)

      const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 500, code: "server_error" })
      expect(ensureFreshSession).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("does not refresh or retry on network failures", async () => {
      const fetchMock = vi.fn(async () => Promise.reject(new TypeError("fetch failed")))
      vi.stubGlobal("fetch", fetchMock)

      const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
      expect(error).toMatchObject({ status: null, code: "network_error" })
      expect(ensureFreshSession).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("surfaces the original 401 when the session refresh fails", async () => {
      vi.mocked(ensureFreshSession).mockRejectedValueOnce(new Error("refresh exploded"))
      const fetchMock = vi.fn(async () => new Response("expired", { status: 401 }))
      vi.stubGlobal("fetch", fetchMock)

      const error = await request("http://api.test", "/thing").catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 401, code: "unauthorized" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("never retries more than once even across repeated 401s", async () => {
      const fetchMock = vi.fn(async () => new Response("expired", { status: 401 }))
      vi.stubGlobal("fetch", fetchMock)

      await request("http://api.test", "/thing").catch(() => {})
      expect(ensureFreshSession).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })
})
