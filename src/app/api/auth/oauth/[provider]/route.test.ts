// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OAuthProviderConfig } from "@/lib/auth/oauth-providers"

const getOAuthProvider = vi.fn()

vi.mock("@/lib/auth/oauth-providers", () => ({
  getOAuthProvider: (...args: unknown[]) => getOAuthProvider(...args),
}))

import { GET } from "./route"

function params(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

function request(url = "http://localhost:3000/api/auth/oauth/github") {
  return new Request(url)
}

const realConfig: OAuthProviderConfig = {
  name: "github",
  clientId: "gh-client-id",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userinfoUrl: "https://api.github.com/user",
  scopes: ["read:user", "user:email"],
  mock: false,
}

const mockConfig: OAuthProviderConfig = {
  name: "gitlab",
  clientId: "mock",
  authorizeUrl: "https://oauth.mock.invalid/authorize",
  tokenUrl: "https://oauth.mock.invalid/token",
  scopes: [],
  mock: true,
}

beforeEach(() => {
  getOAuthProvider.mockReset()
})

describe("GET /api/auth/oauth/[provider]", () => {
  it("returns 404 for providers the registry does not know", async () => {
    getOAuthProvider.mockReturnValue(null)

    const response = await GET(request("http://localhost/api/auth/oauth/nope"), params("nope"))

    expect(response.status).toBe(404)
    expect(getOAuthProvider).toHaveBeenCalledWith("nope")
  })

  it("returns the public provider config for a real provider", async () => {
    getOAuthProvider.mockReturnValue(realConfig)

    const response = await GET(request(), params("github"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      provider: "github",
      clientId: "gh-client-id",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      scopes: ["read:user", "user:email"],
      redirectUri: "http://localhost:3000/oauth/callback",
    })
    // Secrets must never leave the server.
    expect(JSON.stringify(body)).not.toContain("clientSecret")
  })

  it("rate-limits requests per client IP (publicRead preset: 60 per minute)", async () => {
    getOAuthProvider.mockReturnValue(realConfig)
    const ip = "10.5.5.5"

    let allowed = 0
    let denied = 0
    for (let i = 0; i < 70; i += 1) {
      const response = await GET(
        new Request("http://localhost/api/auth/oauth/github", {
          headers: { "x-forwarded-for": ip },
        }),
        params("github"),
      )
      if (response.status === 429) denied += 1
      else allowed += 1
    }

    expect(allowed).toBe(60)
    expect(denied).toBe(10)
    // The limiter runs before the provider lookup, so over-limit requests
    // never reach the registry.
    expect(getOAuthProvider).toHaveBeenCalledTimes(60)
  })

  it("rewrites the authorize URL to the same-origin mock bounce for mock providers", async () => {
    getOAuthProvider.mockReturnValue(mockConfig)

    const response = await GET(
      request("http://localhost:3000/api/auth/oauth/gitlab"),
      params("gitlab"),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authorizeUrl).toBe(
      "http://localhost:3000/api/auth/oauth/callback?mock_authorize=gitlab",
    )
  })
})
