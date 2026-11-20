import { describe, expect, it } from "vitest"

import {
  DEFAULT_WORKSPACE_SSO_CONFIG,
  getWorkspaceSsoConfig,
  isAllowedSsoUrl,
  maskSsoUrlForDisplay,
  maskWorkspaceSsoConfig,
  resetWorkspaceSsoForTests,
  SSO_URL_MASK_SUFFIX,
  updateWorkspaceSsoConfig,
  workspaceSsoConfigPatchSchema,
} from "./workspace-sso"

describe("isAllowedSsoUrl", () => {
  it("accepts https URLs and localhost http URLs", () => {
    expect(isAllowedSsoUrl("https://idp.example.com/sso")).toBe(true)
    expect(isAllowedSsoUrl("http://localhost:8080/sso")).toBe(true)
    expect(isAllowedSsoUrl("http://127.0.0.1:3000/sso")).toBe(true)
  })

  it("rejects remote http, other schemes, and garbage", () => {
    expect(isAllowedSsoUrl("http://idp.example.com/sso")).toBe(false)
    expect(isAllowedSsoUrl("ftp://idp.example.com")).toBe(false)
    expect(isAllowedSsoUrl("not a url")).toBe(false)
    expect(isAllowedSsoUrl("javascript:alert(1)")).toBe(false)
  })
})

describe("workspaceSsoConfigPatchSchema", () => {
  it("accepts a valid partial patch", () => {
    const result = workspaceSsoConfigPatchSchema.safeParse({
      enabled: true,
      provider: "saml",
      entityId: "https://idp.example.com/entity",
      ssoUrl: "https://idp.example.com/sso",
      enforced: true,
      allowedDomains: ["Example.COM", "corp.example.com"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown keys (strict)", () => {
    const result = workspaceSsoConfigPatchSchema.safeParse({
      enabled: true,
      privateKey: "-----BEGIN PRIVATE KEY-----",
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-https remote URLs", () => {
    const result = workspaceSsoConfigPatchSchema.safeParse({
      ssoUrl: "http://idp.example.com/sso",
    })
    expect(result.success).toBe(false)
  })

  it("allows empty strings for URL fields (unset)", () => {
    const result = workspaceSsoConfigPatchSchema.safeParse({ entityId: "" })
    expect(result.success).toBe(true)
  })

  it("rejects malformed domains", () => {
    for (const bad of ["not a domain", "localhost", "-bad.com", "bad..com", "a".repeat(300)]) {
      const result = workspaceSsoConfigPatchSchema.safeParse({ allowedDomains: [bad] })
      expect(result.success, bad).toBe(false)
    }
  })

  it("rejects non-alphanumeric certificate fingerprints", () => {
    const result = workspaceSsoConfigPatchSchema.safeParse({
      certificateFingerprintLast4: "ab; rm -rf",
    })
    expect(result.success).toBe(false)
  })
})

describe("getWorkspaceSsoConfig / updateWorkspaceSsoConfig", () => {
  it("returns defaults when unset", () => {
    resetWorkspaceSsoForTests()
    expect(getWorkspaceSsoConfig("ws-x")).toEqual(DEFAULT_WORKSPACE_SSO_CONFIG)
  })

  it("merges patches and dedupes/lowercases domains", () => {
    resetWorkspaceSsoForTests()
    updateWorkspaceSsoConfig("ws-1", {
      enabled: true,
      provider: "oidc",
      entityId: "https://idp.example.com",
      ssoUrl: "https://idp.example.com/authorize",
      certificateConfigured: true,
      certificateFingerprintLast4: "a1b2",
      enforced: true,
      allowedDomains: ["Example.com", "example.com", "Corp.Example.com"],
    })
    const config = getWorkspaceSsoConfig("ws-1")
    expect(config).toMatchObject({
      enabled: true,
      provider: "oidc",
      entityId: "https://idp.example.com",
      enforced: true,
      certificateConfigured: true,
      certificateFingerprintLast4: "a1b2",
    })
    expect(config.allowedDomains).toEqual(["example.com", "corp.example.com"])
  })

  it("partial updates preserve untouched fields", () => {
    resetWorkspaceSsoForTests()
    updateWorkspaceSsoConfig("ws-2", { provider: "saml", enabled: true })
    updateWorkspaceSsoConfig("ws-2", { enforced: true })
    const config = getWorkspaceSsoConfig("ws-2")
    expect(config.provider).toBe("saml")
    expect(config.enabled).toBe(true)
    expect(config.enforced).toBe(true)
    expect(config.ssoUrl).toBe("")
  })

  it("throws on invalid patches", () => {
    resetWorkspaceSsoForTests()
    expect(() => updateWorkspaceSsoConfig("ws-3", { ssoUrl: "http://evil.example.com" })).toThrow()
  })

  it("does not share state between workspaces", () => {
    resetWorkspaceSsoForTests()
    updateWorkspaceSsoConfig("ws-a", { enabled: true })
    expect(getWorkspaceSsoConfig("ws-b").enabled).toBe(false)
  })
})

describe("maskWorkspaceSsoConfig", () => {
  it("masks URL paths but keeps origins and non-sensitive fields", () => {
    resetWorkspaceSsoForTests()
    updateWorkspaceSsoConfig("ws-m", {
      enabled: true,
      provider: "saml",
      entityId: "https://idp.example.com/tenant/secret-path/entity",
      ssoUrl: "https://sso.example.com:8443/app/sso?x=1",
      allowedDomains: ["example.com"],
    })
    const masked = maskWorkspaceSsoConfig(getWorkspaceSsoConfig("ws-m"))
    expect(masked.entityId).toBe(`https://idp.example.com${SSO_URL_MASK_SUFFIX}`)
    expect(masked.ssoUrl).toBe(`https://sso.example.com:8443${SSO_URL_MASK_SUFFIX}`)
    expect(masked.allowedDomains).toEqual(["example.com"])
    expect(masked.enabled).toBe(true)
    // Stored value is untouched.
    expect(getWorkspaceSsoConfig("ws-m").entityId).toContain("secret-path")
  })

  it("leaves empty URLs empty", () => {
    expect(maskSsoUrlForDisplay("")).toBe("")
  })
})
