import { afterEach, describe, expect, it, vi } from "vitest"

import { createApiClient } from "./instance"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createApiClient", () => {
  it("defaults to the mock adapter", async () => {
    const client = createApiClient({ NEXT_PUBLIC_API_MODE: "mock", NEXT_PUBLIC_API_URL: undefined })
    const projects = await client.projects.listProjects()
    expect(projects.length).toBeGreaterThan(0)
  })

  it("selects the HTTP adapter and targets NEXT_PUBLIC_API_URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const client = createApiClient({
      NEXT_PUBLIC_API_MODE: "http",
      NEXT_PUBLIC_API_URL: "https://api.example.com",
    })
    await client.projects.listProjects()

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.example.com/projects",
    )
  })

  it("falls back to same-origin /api when no URL is configured", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ requests: 0, tokens: 0, costUsd: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const client = createApiClient({ NEXT_PUBLIC_API_MODE: "http", NEXT_PUBLIC_API_URL: undefined })
    await client.usage.getUsageSummary()

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/usage/summary")
  })
})
