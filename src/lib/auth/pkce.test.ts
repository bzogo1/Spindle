import { beforeEach, describe, expect, it } from "vitest"

import {
  buildAuthorizeUrl,
  codeChallengeS256,
  consumePendingOAuthFlow,
  createPkcePair,
  generateCodeVerifier,
  generateState,
  readPendingOAuthFlow,
  storePendingOAuthFlow,
} from "./pkce"

describe("pkce", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it("generates RFC 7636-compliant verifiers", () => {
    for (let i = 0; i < 20; i += 1) {
      const verifier = generateCodeVerifier()
      expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/)
    }
  })

  it("computes the S256 challenge (RFC 7636 appendix B vector)", async () => {
    // Known-answer test from RFC 7636.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" // leak-detection:ignore — RFC 7636 appendix B vector
    await expect(codeChallengeS256(verifier)).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", // leak-detection:ignore — RFC 7636 appendix B vector
    )
  })

  it("creates verifier/challenge pairs that satisfy the RFC relation", async () => {
    const { verifier, challenge } = await createPkcePair()
    expect(challenge).not.toBe(verifier)
    await expect(codeChallengeS256(verifier)).resolves.toBe(challenge)
  })

  it("builds an authorize URL with all required parameters", () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizeEndpoint: "https://provider.example/authorize",
        clientId: "client-123",
        redirectUri: "https://app.example/oauth/callback",
        scope: "openid email",
        state: "state-abc",
        challenge: "challenge-xyz",
        extra: { prompt: "consent" },
      }),
    )
    expect(url.origin + url.pathname).toBe("https://provider.example/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("client-123")
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/oauth/callback")
    expect(url.searchParams.get("scope")).toBe("openid email")
    expect(url.searchParams.get("state")).toBe("state-abc")
    expect(url.searchParams.get("code_challenge")).toBe("challenge-xyz")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("prompt")).toBe("consent")
  })

  it("round-trips a pending flow through sessionStorage", () => {
    storePendingOAuthFlow({
      provider: "github",
      state: "s1",
      verifier: "v1",
      redirectUri: "https://app.example/oauth/callback",
      returnTo: "/dashboard",
      createdAt: Date.now(),
    })
    expect(readPendingOAuthFlow()?.verifier).toBe("v1")
    expect(consumePendingOAuthFlow("s1")?.provider).toBe("github")
    expect(readPendingOAuthFlow()).toBeNull()
  })

  it("rejects state mismatches (CSRF) and clears the stored flow", () => {
    storePendingOAuthFlow({
      provider: "github",
      state: "expected",
      verifier: "v1",
      redirectUri: "https://app.example/oauth/callback",
      returnTo: "/",
      createdAt: Date.now(),
    })
    expect(consumePendingOAuthFlow("attacker-state")).toBeNull()
    expect(readPendingOAuthFlow()).toBeNull()
  })

  it("generates unique states", () => {
    const states = new Set(Array.from({ length: 50 }, () => generateState()))
    expect(states.size).toBe(50)
  })
})
