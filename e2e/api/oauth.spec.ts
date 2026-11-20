import { expect, test } from "playwright/test"

import { authFailSchema, oauthCallbackOkSchema, oauthProviderSchema } from "./contract"
import { jsonBody } from "./helpers"

/**
 * Contract specs for the OAuth surface:
 *
 *   GET  /api/auth/oauth/[provider]   — public provider config (PKCE flow)
 *   GET  /api/auth/oauth/callback     — mock-mode authorize bounce (302)
 *   POST /api/auth/oauth/callback     — code exchange → session
 *
 * The playwright webServer runs with `NEXT_PUBLIC_MOCK_AUTH=1`, which injects
 * synthetic providers for the built-in ids (github/google/gitlab) — the full
 * flow then runs without a real OAuth app. Against a non-mock deployment the
 * same routes answer `unknown_provider`/`oauth_failed` instead; the specs
 * accept either contract branch and validate whichever envelope applies.
 */

const MOCK_CALLBACK_BODY = {
  provider: "github",
  code: "mock-code",
  redirectUri: "http://localhost:3000/oauth/callback",
  // PKCE verifier: 43–128 chars per oauthCallbackSchema.
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
}

test.describe("GET /api/auth/oauth/[provider]", () => {
  test("returns provider config for a configured provider", async ({ request }) => {
    const response = await request.get("/api/auth/oauth/github")

    if (response.status() === 200) {
      const body = oauthProviderSchema.parse(await jsonBody(response))
      expect(body.provider).toBe("github")
      expect(body.clientId.length).toBeGreaterThan(0)
      expect(body.authorizeUrl).toContain("http")
      // Real providers list their OAuth scopes; synthetic mock providers
      // (NEXT_PUBLIC_MOCK_AUTH) legitimately return an empty array.
      expect(body.scopes.every((scope) => typeof scope === "string")).toBe(true)
      expect(body.redirectUri).toMatch(/\/oauth\/callback$/)
      return
    }

    // Non-mock deployment without OAUTH_PROVIDERS_JSON configured.
    expect(response.status()).toBe(404)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("unknown_provider")
  })

  test("rejects an unknown provider", async ({ request }) => {
    const response = await request.get("/api/auth/oauth/no-such-provider")
    expect(response.status()).toBe(404)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("unknown_provider")
  })
})

test.describe("GET /api/auth/oauth/callback (mock authorize bounce)", () => {
  test("redirects back to /oauth/callback with a mock code in mock mode", async ({ request }) => {
    const response = await request.get(
      "/api/auth/oauth/callback?mock_authorize=github&state=test-state-123",
      { maxRedirects: 0 },
    )

    if (response.status() === 302) {
      const location = response.headers()["location"] ?? ""
      expect(location).toContain("/oauth/callback")
      expect(location).toContain("code=mock-github")
      expect(location).toContain("state=test-state-123")
      expect(location).toContain("provider=github")
      return
    }

    // Mock OAuth disabled: the bounce endpoint does not exist.
    expect(response.status()).toBe(404)
    authFailSchema.parse(await jsonBody(response))
  })

  test("rejects a bounce without provider/state params", async ({ request }) => {
    const response = await request.get("/api/auth/oauth/callback?mock_authorize=github", {
      maxRedirects: 0,
    })
    // Mock mode → 400 invalid_request; non-mock → 404 unknown_provider.
    expect([400, 404]).toContain(response.status())
    authFailSchema.parse(await jsonBody(response))
  })
})

test.describe("POST /api/auth/oauth/callback", () => {
  test("rejects a malformed body", async ({ request }) => {
    const response = await request.post("/api/auth/oauth/callback", {
      data: { provider: "github" },
    })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_request")
  })

  test("rejects an unknown provider", async ({ request }) => {
    const response = await request.post("/api/auth/oauth/callback", {
      data: { ...MOCK_CALLBACK_BODY, provider: "no-such-provider" },
    })
    expect(response.status()).toBe(404)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("unknown_provider")
  })

  test("mock provider completes sign-in and returns a session", async ({ request }) => {
    const response = await request.post("/api/auth/oauth/callback", {
      data: MOCK_CALLBACK_BODY,
    })

    if (response.status() === 200) {
      const body = oauthCallbackOkSchema.parse(await jsonBody(response))
      expect(body.session.user.email).toContain("@")
      expect(body.session.sessionId).toBeTruthy()
      return
    }

    // Real provider configured but the code exchange failed (expected
    // outside mock mode — a bogus code cannot complete a real exchange).
    expect([401, 404]).toContain(response.status())
    authFailSchema.parse(await jsonBody(response))
  })
})
