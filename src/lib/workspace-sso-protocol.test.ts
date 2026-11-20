import { describe, expect, it } from "vitest"

import type { WorkspaceSsoConfig } from "@/lib/workspace-sso"

import {
  buildAuthnRequestUrl,
  devAssertionSecret,
  generateNonce,
  generateState,
  signDevAssertion,
  verifyDevAssertion,
} from "./workspace-sso-protocol"

const samlConfig: WorkspaceSsoConfig = {
  enabled: true,
  provider: "saml",
  entityId: "https://idp.example.com/entity",
  ssoUrl: "https://idp.example.com/sso",
  certificateConfigured: true,
  certificateFingerprintLast4: "a1b2",
  enforced: false,
  allowedDomains: ["example.com"],
}

const oidcConfig: WorkspaceSsoConfig = {
  ...samlConfig,
  provider: "oidc",
  ssoUrl: "https://idp.example.com/authorize",
}

const disabledConfig: WorkspaceSsoConfig = {
  ...samlConfig,
  enabled: false,
}

describe("generateState / generateNonce", () => {
  it("returns unique URL-safe tokens", () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe("buildAuthnRequestUrl — SAML", () => {
  it("builds a redirect to ssoUrl with SAMLRequest and RelayState", () => {
    const url = new URL(
      buildAuthnRequestUrl(samlConfig, {
        workspaceId: "ws-1",
        acsUrl: "http://localhost/api/auth/sso/ws-1",
      })!,
    )
    expect(url.origin + url.pathname).toBe("https://idp.example.com/sso")

    const samlRequest = url.searchParams.get("SAMLRequest")
    expect(samlRequest).toBeTruthy()
    const xml = Buffer.from(samlRequest!, "base64").toString("utf8")
    expect(xml).toContain("AuthnRequest")
    expect(xml).toContain("https://idp.example.com/entity")
    expect(xml).toContain("http://localhost/api/auth/sso/ws-1")
    expect(url.searchParams.get("RelayState")).toBe("ws-1")
  })

  it("honors a custom relayState", () => {
    const url = new URL(
      buildAuthnRequestUrl(samlConfig, { workspaceId: "ws-1", relayState: "abc-123" })!,
    )
    expect(url.searchParams.get("RelayState")).toBe("abc-123")
  })
})

describe("buildAuthnRequestUrl — OIDC", () => {
  it("builds an authorize URL with code flow params", () => {
    const url = new URL(
      buildAuthnRequestUrl(oidcConfig, {
        workspaceId: "ws-1",
        redirectUri: "http://localhost/api/auth/sso/ws-1",
        state: "fixed-state",
        nonce: "fixed-nonce",
      })!,
    )
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize")
    expect(url.searchParams.get("client_id")).toBe("https://idp.example.com/entity")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe("openid email profile")
    expect(url.searchParams.get("state")).toBe("fixed-state")
    expect(url.searchParams.get("nonce")).toBe("fixed-nonce")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/sso/ws-1")
  })

  it("generates state and nonce when omitted", () => {
    const url = new URL(buildAuthnRequestUrl(oidcConfig, { workspaceId: "ws-1" })!)
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get("redirect_uri")).toBeNull()
  })
})

describe("buildAuthnRequestUrl — guards", () => {
  it("returns null when disabled, provider none, or URLs missing", () => {
    expect(buildAuthnRequestUrl(disabledConfig, { workspaceId: "ws-1" })).toBeNull()
    expect(
      buildAuthnRequestUrl({ ...samlConfig, provider: "none" }, { workspaceId: "ws-1" }),
    ).toBeNull()
    expect(buildAuthnRequestUrl({ ...samlConfig, ssoUrl: "" }, { workspaceId: "ws-1" })).toBeNull()
    expect(
      buildAuthnRequestUrl({ ...samlConfig, entityId: "" }, { workspaceId: "ws-1" }),
    ).toBeNull()
  })
})

describe("dev assertion helpers", () => {
  const secret = devAssertionSecret("ws-1", "https://idp.example.com/entity")

  it("derives a deterministic 64-char hex secret per workspace", () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(devAssertionSecret("ws-1", "https://idp.example.com/entity")).toBe(secret)
    expect(devAssertionSecret("ws-2", "https://idp.example.com/entity")).not.toBe(secret)
  })

  it("round-trips a signed assertion", () => {
    const assertion = signDevAssertion({
      workspaceId: "ws-1",
      email: "Ada@Example.com",
      name: "Ada",
      secret,
    })
    expect(
      verifyDevAssertion({
        workspaceId: "ws-1",
        email: "ada@example.com", // email is normalized before signing
        name: "Ada",
        assertion,
        secret,
      }),
    ).toBe(true)
  })

  it("rejects wrong workspace, email, name, secret, and malformed input", () => {
    const assertion = signDevAssertion({
      workspaceId: "ws-1",
      email: "ada@example.com",
      name: "Ada",
      secret,
    })
    const base = { workspaceId: "ws-1", email: "ada@example.com", name: "Ada", assertion, secret }
    expect(verifyDevAssertion({ ...base, workspaceId: "ws-2" })).toBe(false)
    expect(verifyDevAssertion({ ...base, email: "other@example.com" })).toBe(false)
    expect(verifyDevAssertion({ ...base, name: "Mallory" })).toBe(false)
    expect(verifyDevAssertion({ ...base, secret: devAssertionSecret("ws-9", "x") })).toBe(false)
    expect(verifyDevAssertion({ ...base, assertion: "not-hex" })).toBe(false)
    expect(verifyDevAssertion({ ...base, assertion: "0".repeat(64) })).toBe(false)
  })
})
