// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OAuthProviderConfig } from "@/lib/auth/oauth-providers"
import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"

const upsertOAuthUser = vi.fn()
const createSessionForUser = vi.fn()
const getOAuthProvider = vi.fn()
const mockOAuthEnabled = vi.fn(() => true)
const exchangeAuthorizationCode = vi.fn()
const fetchOAuthUserProfile = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ upsertOAuthUser, createSessionForUser }),
  }
})

vi.mock("@/lib/auth/oauth-providers", () => ({
  getOAuthProvider: (...args: unknown[]) => getOAuthProvider(...args),
  mockOAuthEnabled: () => mockOAuthEnabled(),
}))

vi.mock("@/lib/auth/oauth/token-exchange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/oauth/token-exchange")>()
  return {
    ...actual,
    exchangeAuthorizationCode: (...args: unknown[]) => exchangeAuthorizationCode(...args),
    fetchOAuthUserProfile: (...args: unknown[]) => fetchOAuthUserProfile(...args),
  }
})

import { GET, POST } from "./route"

const realConfig: OAuthProviderConfig = {
  name: "github",
  clientId: "gh-client-id",
  clientSecret: "gh-secret",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userinfoUrl: "https://api.github.com/user",
  scopes: ["read:user", "user:email"],
  mock: false,
}

const mockConfig: OAuthProviderConfig = {
  name: "google",
  clientId: "mock",
  authorizeUrl: "https://oauth.mock.invalid/authorize",
  tokenUrl: "https://oauth.mock.invalid/token",
  scopes: [],
  mock: true,
}

const authUser = {
  id: "user_1",
  email: "person@example.com",
  name: "Person",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const tokenPair = {
  accessToken: "access.jwt",
  refreshToken: "refresh.token",
  session: {
    user: authUser,
    workspace: { name: "Personal workspace", slug: "personal-1" },
    sessionId: "sess_1",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
}

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/oauth/callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.9.9.${++ipCounter}`,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

const validBody = {
  provider: "github",
  code: "auth-code-123",
  redirectUri: "http://localhost/oauth/callback",
  codeVerifier: "a".repeat(50),
}

let alertStore: MemoryLoginAlertStore

beforeEach(() => {
  upsertOAuthUser.mockReset().mockResolvedValue({ user: authUser, created: true })
  createSessionForUser.mockReset().mockResolvedValue(tokenPair)
  getOAuthProvider.mockReset().mockReturnValue(realConfig)
  mockOAuthEnabled.mockReset().mockReturnValue(true)
  exchangeAuthorizationCode.mockReset().mockResolvedValue({ access_token: "at_123" })
  fetchOAuthUserProfile
    .mockReset()
    .mockResolvedValue({ email: "person@example.com", name: "Person" })
  alertStore = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(alertStore)
})

describe("POST /api/auth/oauth/callback", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post(validBody, { origin: "https://evil.example" })

    expect(response.status).toBe(403)
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  it("rejects malformed bodies and schema violations", async () => {
    expect((await post("not-json{")).status).toBe(400)
    expect((await post({ ...validBody, provider: "BAD NAME!" })).status).toBe(400)
    expect((await post({ ...validBody, codeVerifier: "short" })).status).toBe(400)
  })

  it("returns 404 for unconfigured providers", async () => {
    getOAuthProvider.mockReturnValue(null)

    const response = await post({ ...validBody, provider: "unknown" })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "unknown_provider" })
  })

  it("exchanges the code, resolves the profile and issues a session", async () => {
    const response = await post(validBody)
    const body = await response.json()

    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(realConfig, {
      code: "auth-code-123",
      redirectUri: "http://localhost/oauth/callback",
      codeVerifier: "a".repeat(50),
    })
    expect(fetchOAuthUserProfile).toHaveBeenCalledWith(realConfig, "at_123")
    expect(upsertOAuthUser).toHaveBeenCalledWith({
      email: "person@example.com",
      name: "Person",
      provider: "github",
    })
    expect(createSessionForUser).toHaveBeenCalledWith("user_1")
    expect(body).toMatchObject({ ok: true, session: { sessionId: "sess_1" } })
    expect(response.headers.get("set-cookie")).toContain("spindle_at=access.jwt")
    expect(response.headers.get("set-cookie")).toContain("spindle_rt=refresh.token")
  })

  it("fails with oauth_failed when the token exchange fails", async () => {
    exchangeAuthorizationCode.mockResolvedValue(null)

    const response = await post(validBody)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "oauth_failed" })
    expect(fetchOAuthUserProfile).not.toHaveBeenCalled()
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("fails with oauth_failed when the provider returns no email", async () => {
    fetchOAuthUserProfile.mockResolvedValue({ name: "No Email" })

    const response = await post(validBody)

    expect(response.status).toBe(401)
    expect(upsertOAuthUser).not.toHaveBeenCalled()
  })

  it("skips the network exchange entirely for mock providers", async () => {
    getOAuthProvider.mockReturnValue(mockConfig)

    const response = await post({ ...validBody, provider: "google" })
    const body = await response.json()

    expect(exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(fetchOAuthUserProfile).not.toHaveBeenCalled()
    // mockOAuthProfile is the real implementation: fixture identity on the
    // reserved .invalid domain.
    expect(upsertOAuthUser).toHaveBeenCalledWith({
      email: "google.mock@oauth.spindle.invalid",
      name: "Google (mock)",
      provider: "google",
    })
    expect(body.ok).toBe(true)
  })

  it("records login-alert fingerprints for the OAuth sign-in", async () => {
    // First sign-in seeds fingerprints silently.
    expect((await post(validBody, { "user-agent": "UA-A" })).status).toBe(200)
    expect(alertStore.listAlerts(authUser.id)).toEqual([])

    // A different user agent on the next OAuth sign-in raises new_device.
    expect((await post(validBody, { "user-agent": "UA-B" })).status).toBe(200)
    expect(alertStore.listAlerts(authUser.id).map((a) => a.kind)).toContain("new_device")
  })
})

describe("GET /api/auth/oauth/callback (mock authorize bounce)", () => {
  function get(query: string) {
    return GET(new Request(`http://localhost/api/auth/oauth/callback?${query}`))
  }

  it("redirects back to /oauth/callback with a mock code and the client state", async () => {
    getOAuthProvider.mockReturnValue(mockConfig)

    const response = await get("mock_authorize=google&state=state-123&code_challenge=abc")

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location") as string)
    expect(location.pathname).toBe("/oauth/callback")
    expect(location.searchParams.get("code")).toBe("mock-google")
    expect(location.searchParams.get("state")).toBe("state-123")
    expect(location.searchParams.get("provider")).toBe("google")
  })

  it("is disabled when mock auth is off", async () => {
    mockOAuthEnabled.mockReturnValue(false)

    const response = await get("mock_authorize=google&state=state-123")

    expect(response.status).toBe(404)
  })

  it("rate-limits the mock bounce per client IP (publicRead preset: 60 per minute)", async () => {
    getOAuthProvider.mockReturnValue(mockConfig)

    let last: Response | undefined
    for (let i = 0; i < 61; i += 1) {
      last = await GET(
        new Request("http://localhost/api/auth/oauth/callback?mock_authorize=google&state=s", {
          headers: { "x-forwarded-for": "10.4.4.4" },
        }),
      )
    }

    expect(last?.status).toBe(429)
    expect(await last?.json()).toMatchObject({ ok: false, code: "rate_limited" })
  })

  it("rejects requests without state or with a non-mock provider", async () => {
    expect((await get("mock_authorize=google")).status).toBe(400)

    getOAuthProvider.mockReturnValue(realConfig)
    expect((await get("mock_authorize=github&state=s")).status).toBe(404)

    getOAuthProvider.mockReturnValue(null)
    expect((await get("mock_authorize=unknown&state=s")).status).toBe(404)
  })
})
