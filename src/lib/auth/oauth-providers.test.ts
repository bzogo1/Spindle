// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The registry reads `OAUTH_PROVIDERS_JSON` through the cached server env and
 * `NEXT_PUBLIC_MOCK_AUTH` through the frozen client env, so every scenario
 * re-imports the module after stubbing.
 */
async function loadProviders() {
  vi.resetModules()
  return import("./oauth-providers")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("oauth-providers registry", () => {
  it("returns an empty registry when OAUTH_PROVIDERS_JSON is unset", async () => {
    const { listOAuthProviders, listOAuthProviderNames } = await loadProviders()

    expect(listOAuthProviders().size).toBe(0)
    expect(listOAuthProviderNames()).toEqual([])
  })

  it("merges a clientId-only entry over the built-in github endpoints", async () => {
    vi.stubEnv("OAUTH_PROVIDERS_JSON", JSON.stringify({ github: { clientId: "gh-client-id" } }))
    const { getOAuthProvider } = await loadProviders()

    const config = getOAuthProvider("github")
    expect(config).toMatchObject({
      name: "github",
      clientId: "gh-client-id",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userinfoUrl: "https://api.github.com/user",
      emailsUrl: "https://api.github.com/user/emails",
      scopes: ["read:user", "user:email"],
      mock: false,
    })
    expect(config?.clientSecret).toBeUndefined()
  })

  it("lets JSON entries override built-in endpoints, scopes and userinfo", async () => {
    vi.stubEnv(
      "OAUTH_PROVIDERS_JSON",
      JSON.stringify({
        gitlab: {
          clientId: "gl-id",
          clientSecret: "gl-secret",
          authorizeUrl: "https://gitlab.example.com/oauth/authorize",
          tokenUrl: "https://gitlab.example.com/oauth/token",
          userinfoUrl: null,
          scopes: ["api"],
        },
      }),
    )
    const { getOAuthProvider } = await loadProviders()

    const config = getOAuthProvider("gitlab")
    expect(config?.authorizeUrl).toBe("https://gitlab.example.com/oauth/authorize")
    expect(config?.tokenUrl).toBe("https://gitlab.example.com/oauth/token")
    expect(config?.userinfoUrl).toBeUndefined()
    expect(config?.scopes).toEqual(["api"])
    expect(config?.clientSecret).toBe("gl-secret")
  })

  it("requires full endpoints for providers without a built-in default", async () => {
    vi.stubEnv(
      "OAUTH_PROVIDERS_JSON",
      JSON.stringify({
        // Missing authorizeUrl/tokenUrl — no built-in to fall back on.
        custom: { clientId: "custom-id" },
        // Fully specified custom provider is accepted.
        corp: {
          clientId: "corp-id",
          authorizeUrl: "https://idp.example.com/authorize",
          tokenUrl: "https://idp.example.com/token",
          userinfoUrl: "https://idp.example.com/userinfo",
          scopes: ["openid"],
        },
      }),
    )
    const { getOAuthProvider, listOAuthProviderNames } = await loadProviders()

    expect(getOAuthProvider("custom")).toBeNull()
    expect(getOAuthProvider("corp")).toMatchObject({
      name: "corp",
      clientId: "corp-id",
      scopes: ["openid"],
    })
    expect(listOAuthProviderNames()).toEqual(["corp"])
  })

  it("drops entries without a clientId and tolerates malformed JSON", async () => {
    vi.stubEnv(
      "OAUTH_PROVIDERS_JSON",
      JSON.stringify({
        google: { clientSecret: "no-id" },
        github: { clientId: "gh-id" },
      }),
    )
    let mod = await loadProviders()
    expect(mod.listOAuthProviderNames()).toEqual(["github"])

    vi.stubEnv("OAUTH_PROVIDERS_JSON", "{not json")
    mod = await loadProviders()
    expect(mod.listOAuthProviders().size).toBe(0)
  })

  it("injects mock configs for built-in providers under NEXT_PUBLIC_MOCK_AUTH", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_AUTH", "1")
    vi.stubEnv(
      "OAUTH_PROVIDERS_JSON",
      // A real registration always wins over the synthetic mock config.
      JSON.stringify({ github: { clientId: "real-gh-id" } }),
    )
    const { getOAuthProvider, listOAuthProviderNames } = await loadProviders()

    expect(getOAuthProvider("github")).toMatchObject({ clientId: "real-gh-id", mock: false })
    expect(getOAuthProvider("google")).toMatchObject({ mock: true, clientId: "mock" })
    expect(getOAuthProvider("gitlab")).toMatchObject({ mock: true })
    expect(listOAuthProviderNames().sort()).toEqual(["github", "gitlab", "google"])
  })

  it("does not inject mock configs when mock auth is disabled", async () => {
    const { getOAuthProvider } = await loadProviders()

    expect(getOAuthProvider("github")).toBeNull()
    expect(getOAuthProvider("google")).toBeNull()
    expect(getOAuthProvider("gitlab")).toBeNull()
  })
})
