import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  configureSdk,
  ENDPOINTS,
  getAuthOauthProvider,
  getProfile,
  getSdkConfig,
  postContact,
} from "./index"

type FetchCall = { url: string; init: RequestInit }

function mockFetch(response: { status?: number; body?: unknown } = {}) {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const status = response.status ?? 200
    const body = response.body === undefined ? { ok: true } : response.body
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch }
}

beforeEach(() => {
  configureSdk({ baseUrl: "", headers: {}, fetch: undefined })
})

afterEach(() => {
  configureSdk({ baseUrl: "", headers: {}, fetch: undefined })
  vi.unstubAllGlobals()
})

describe("generated SDK client", () => {
  it("discovers every exported route handler as an endpoint", () => {
    expect(ENDPOINTS.length).toBeGreaterThanOrEqual(40)
    expect(ENDPOINTS).toContainEqual(
      expect.objectContaining({ name: "postContact", method: "POST", path: "/api/contact" }),
    )
    expect(ENDPOINTS).toContainEqual(
      expect.objectContaining({
        name: "getAuthOauthProvider",
        method: "GET",
        path: "/api/auth/oauth/:provider",
        pathParams: ["provider"],
      }),
    )
    // Sorted by path then method order — deterministic output.
    const paths = ENDPOINTS.map((e) => e.path)
    expect(paths).toEqual([...paths].sort())
  })

  it("sends a JSON POST with the configured base URL and headers", async () => {
    const { calls, fetchImpl } = mockFetch({ body: { ok: true, reference: "C-1" } })
    configureSdk({ baseUrl: "https://api.example.com/", headers: { "x-team": "sdk" }, fetch: fetchImpl })

    const result = await postContact({ name: "Ada", email: "ada@example.com" })

    expect(result).toEqual({ ok: true, reference: "C-1" })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.example.com/api/contact")
    expect(calls[0].init.method).toBe("POST")
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-team")).toBe("sdk")
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: "Ada",
      email: "ada@example.com",
    })
  })

  it("encodes dynamic path params and appends query options", async () => {
    const { calls, fetchImpl } = mockFetch()
    configureSdk({ fetch: fetchImpl })

    await getAuthOauthProvider(
      { provider: "google workspace" },
      { query: { debug: true, skip: undefined } },
    )

    expect(calls[0].url).toBe(
      "/api/auth/oauth/google%20workspace?debug=true",
    )
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.body).toBeUndefined()
  })

  it("throws ApiError with status and parsed body on non-2xx", async () => {
    const { fetchImpl } = mockFetch({
      status: 429,
      body: { ok: false, message: "Too many messages." },
    })
    configureSdk({ fetch: fetchImpl })

    const error = await postContact({}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(429)
    expect((error as ApiError).message).toBe("Too many messages.")
    expect((error as ApiError).body).toEqual({ ok: false, message: "Too many messages." })
  })

  it("keeps non-JSON response bodies as text", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("plain text", { status: 200 }),
    ) as unknown as typeof fetch
    configureSdk({ fetch: fetchImpl })

    await expect(getProfile()).resolves.toBe("plain text")
  })

  it("exposes the current configuration snapshot", () => {
    configureSdk({ baseUrl: "https://x.test" })
    expect(getSdkConfig().baseUrl).toBe("https://x.test")
  })
})
