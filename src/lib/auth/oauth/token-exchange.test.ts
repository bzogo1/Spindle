// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OAuthProviderConfig } from "@/lib/auth/oauth-providers"
import {
  exchangeAuthorizationCode,
  fetchOAuthUserProfile,
  mockOAuthProfile,
} from "./token-exchange"

const githubConfig: OAuthProviderConfig = {
  name: "github",
  clientId: "gh-id",
  clientSecret: "gh-secret",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userinfoUrl: "https://api.github.com/user",
  emailsUrl: "https://api.github.com/user/emails",
  scopes: ["read:user", "user:email"],
  mock: false,
}

const pkceConfig: OAuthProviderConfig = {
  name: "gitlab",
  clientId: "gl-id",
  authorizeUrl: "https://gitlab.com/oauth/authorize",
  tokenUrl: "https://gitlab.com/oauth/token",
  userinfoUrl: "https://gitlab.com/api/v4/user",
  scopes: ["read_user"],
  mock: false,
}

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("exchangeAuthorizationCode", () => {
  const input = {
    code: "code-123",
    redirectUri: "http://localhost/oauth/callback",
    codeVerifier: "v".repeat(50),
  }

  it("posts the PKCE exchange and returns the token payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_1", token_type: "bearer" }))

    const result = await exchangeAuthorizationCode(githubConfig, input)

    expect(result).toEqual({ access_token: "at_1", token_type: "bearer" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(githubConfig.tokenUrl)
    expect(init.method).toBe("POST")
    const body = new URLSearchParams(init.body as string)
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("code-123")
    expect(body.get("redirect_uri")).toBe("http://localhost/oauth/callback")
    expect(body.get("code_verifier")).toBe("v".repeat(50))
    expect(body.get("client_id")).toBe("gh-id")
    expect(body.get("client_secret")).toBe("gh-secret")
  })

  it("omits client_secret for public PKCE clients", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_1" }))

    await exchangeAuthorizationCode(pkceConfig, input)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URLSearchParams(init.body as string).has("client_secret")).toBe(false)
  })

  it("returns null on HTTP errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad_code" }, 400))

    expect(await exchangeAuthorizationCode(githubConfig, input)).toBeNull()
  })
})

describe("fetchOAuthUserProfile", () => {
  it("extracts email and name from the userinfo payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: "a@b.co", name: "Ada" }))

    expect(await fetchOAuthUserProfile(githubConfig, "at_1")).toEqual({
      email: "a@b.co",
      name: "Ada",
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.github.com/user")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at_1")
  })

  it("falls back to the login handle when name is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: "a@b.co", name: null, login: "ada" }))

    expect(await fetchOAuthUserProfile(githubConfig, "at_1")).toEqual({
      email: "a@b.co",
      name: "ada",
    })
  })

  it("returns null without calling fetch when userinfoUrl is unset", async () => {
    const { userinfoUrl: _u, ...noUserinfo } = githubConfig
    expect(await fetchOAuthUserProfile(noUserinfo, "at_1")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null on a non-OK userinfo response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Bad credentials" }, 401))

    expect(await fetchOAuthUserProfile(githubConfig, "at_1")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("resolves a private GitHub e-mail through the /user/emails fallback", async () => {
    // /user returns email:null for private addresses; /user/emails lists them.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "ada", name: null, email: null }))
      .mockResolvedValueOnce(
        jsonResponse([
          { email: "old@b.co", primary: false, verified: true },
          { email: "ada@b.co", primary: true, verified: true },
          { email: "backup@b.co", primary: false, verified: false },
        ]),
      )

    const profile = await fetchOAuthUserProfile(githubConfig, "at_1")

    expect(profile).toEqual({ email: "ada@b.co", name: "ada" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.github.com/user/emails")
  })

  it("prefers primary+verified, then primary, then verified, then first", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ email: null })).mockResolvedValueOnce(
      jsonResponse([
        { email: "verified-only@b.co", primary: false, verified: true },
        { email: "primary@b.co", primary: true, verified: false },
      ]),
    )
    // No primary+verified pair: an unverified primary still wins over a
    // verified secondary — it is the address the user marked as primary.
    expect((await fetchOAuthUserProfile(githubConfig, "at_1"))?.email).toBe("primary@b.co")
  })

  it("does not call the fallback when the userinfo e-mail is present", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ email: "a@b.co", name: "Ada" }))

    await fetchOAuthUserProfile(githubConfig, "at_1")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("skips the fallback entirely for providers without emailsUrl", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "Grace", email: null }))

    const profile = await fetchOAuthUserProfile(pkceConfig, "at_1")

    expect(profile).toEqual({ email: undefined, name: "Grace" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns the profile without e-mail when the fallback endpoint fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ login: "ada", email: null }))
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404))

    const profile = await fetchOAuthUserProfile(githubConfig, "at_1")

    expect(profile).toEqual({ email: undefined, name: "ada" })
  })
})

describe("mockOAuthProfile", () => {
  it("returns a deterministic fixture identity on the reserved domain", () => {
    expect(mockOAuthProfile("github")).toEqual({
      email: "github.mock@oauth.spindle.invalid",
      name: "Github (mock)",
    })
    expect(mockOAuthProfile("gitlab").email).toBe("gitlab.mock@oauth.spindle.invalid")
  })
})
