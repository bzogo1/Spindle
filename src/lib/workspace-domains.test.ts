import { beforeEach, describe, expect, it } from "vitest"

import {
  checkVerification,
  getWorkspaceDomain,
  removeWorkspaceDomain,
  resetWorkspaceDomainsForTests,
  setWorkspaceDomain,
  setWorkspaceDomainStatus,
  verificationTxtValue,
  verifyWorkspaceDomain,
  workspaceDomainInputSchema,
  WorkspaceDomainError,
  VERIFICATION_TXT_PREFIX,
} from "./workspace-domains"

const NOW = Date.parse("2026-02-01T12:00:00.000Z")

beforeEach(() => {
  resetWorkspaceDomainsForTests()
})

describe("workspaceDomainInputSchema", () => {
  it("accepts a bare hostname and normalizes it to lowercase", () => {
    const parsed = workspaceDomainInputSchema.parse({ domain: "  App.Example.COM " })
    expect(parsed.domain).toBe("app.example.com")
  })

  it("rejects schemes, ports, paths, and credentials", () => {
    for (const bad of [
      "https://app.example.com",
      "app.example.com:8443",
      "app.example.com/path",
      "user@app.example.com",
      "app.example.com?x=1",
    ]) {
      expect(workspaceDomainInputSchema.safeParse({ domain: bad }).success).toBe(false)
    }
  })

  it("rejects single-label names, bad TLDs, and invalid characters", () => {
    for (const bad of [
      "localhost",
      "app.example.c",
      "app.example.123",
      "-bad.example.com",
      "bad-.example.com",
      "app..example.com",
      "app_exa_mple.com",
      "a".repeat(64) + ".example.com",
      "",
    ]) {
      expect(workspaceDomainInputSchema.safeParse({ domain: bad }).success).toBe(false)
    }
  })

  it("rejects unknown keys (strict)", () => {
    expect(
      workspaceDomainInputSchema.safeParse({ domain: "app.example.com", extra: 1 }).success,
    ).toBe(false)
  })
})

describe("setWorkspaceDomain", () => {
  it("creates a pending record with a verification token", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(record).toMatchObject({
      domain: "app.example.com",
      status: "pending",
      verifiedAt: null,
      createdAt: new Date(NOW).toISOString(),
    })
    expect(record.verificationToken.length).toBeGreaterThan(20)
    expect(getWorkspaceDomain("ws-1")).toEqual(record)
  })

  it("replaces the same workspace's domain and resets to pending with a fresh token", () => {
    const first = setWorkspaceDomain("ws-1", "a.example.com", NOW)
    const second = setWorkspaceDomain("ws-1", "b.example.com", NOW + 1)
    expect(second.domain).toBe("b.example.com")
    expect(second.status).toBe("pending")
    expect(second.verificationToken).not.toBe(first.verificationToken)
    // The old domain is released for other workspaces.
    expect(() => setWorkspaceDomain("ws-2", "a.example.com", NOW + 2)).not.toThrow()
  })

  it("rejects a domain claimed by another workspace in any status", () => {
    setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(() => setWorkspaceDomain("ws-2", "APP.EXAMPLE.COM", NOW)).toThrowError(
      expect.objectContaining({
        code: "domain_unavailable",
      }) satisfies Partial<WorkspaceDomainError>,
    )
  })

  it("throws invalid_domain for malformed input", () => {
    expect(() => setWorkspaceDomain("ws-1", "not a domain", NOW)).toThrowError(
      expect.objectContaining({ code: "invalid_domain" }),
    )
  })

  it("allows a new workspace to claim the domain after removal", () => {
    setWorkspaceDomain("ws-1", "app.example.com", NOW)
    removeWorkspaceDomain("ws-1")
    expect(() => setWorkspaceDomain("ws-2", "app.example.com", NOW)).not.toThrow()
  })
})

describe("getWorkspaceDomain", () => {
  it("returns null when unset and a defensive copy when set", () => {
    expect(getWorkspaceDomain("ws-none")).toBeNull()
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    const fetched = getWorkspaceDomain("ws-1")
    expect(fetched).toEqual(record)
    fetched!.status = "disabled"
    expect(getWorkspaceDomain("ws-1")!.status).toBe("pending")
  })
})

describe("checkVerification / verifyWorkspaceDomain", () => {
  it("returns false when no domain is configured", () => {
    expect(checkVerification("ws-1", "anything")).toBe(false)
    expect(verifyWorkspaceDomain("ws-1", "anything", NOW)).toBeNull()
  })

  it("accepts the stored token (trimmed) and rejects wrong tokens", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(checkVerification("ws-1", "wrong-token")).toBe(false)
    expect(checkVerification("ws-1", ` ${record.verificationToken} `)).toBe(true)
    expect(verifyWorkspaceDomain("ws-1", "wrong-token", NOW)).toBeNull()
    expect(getWorkspaceDomain("ws-1")!.status).toBe("pending")
  })

  it("marks the record verified with verifiedAt on match", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    const verified = verifyWorkspaceDomain("ws-1", record.verificationToken, NOW + 5000)
    expect(verified).toMatchObject({
      status: "verified",
      verifiedAt: new Date(NOW + 5000).toISOString(),
    })
    expect(getWorkspaceDomain("ws-1")).toEqual(verified)
  })

  it("is idempotent for already-verified records", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    verifyWorkspaceDomain("ws-1", record.verificationToken, NOW)
    const again = verifyWorkspaceDomain("ws-1", "anything", NOW + 9999)
    expect(again!.status).toBe("verified")
    expect(again!.verifiedAt).toBe(new Date(NOW).toISOString())
  })

  it("refuses verification while disabled", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    setWorkspaceDomainStatus("ws-1", "disabled")
    expect(checkVerification("ws-1", record.verificationToken)).toBe(false)
    expect(verifyWorkspaceDomain("ws-1", record.verificationToken, NOW)).toBeNull()
  })
})

describe("setWorkspaceDomainStatus / removeWorkspaceDomain", () => {
  it("returns null for status changes on unconfigured workspaces", () => {
    expect(setWorkspaceDomainStatus("ws-1", "disabled")).toBeNull()
    expect(removeWorkspaceDomain("ws-1")).toBe(false)
  })

  it("disables and re-enables a record", () => {
    setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(setWorkspaceDomainStatus("ws-1", "disabled")!.status).toBe("disabled")
    expect(setWorkspaceDomainStatus("ws-1", "pending")!.status).toBe("pending")
  })

  it("rejects direct 'verified' transitions — verification must go through verifyWorkspaceDomain", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    verifyWorkspaceDomain("ws-1", record.verificationToken, NOW)
    expect(() => setWorkspaceDomainStatus("ws-1", "verified")).toThrowError(
      expect.objectContaining({ code: "invalid_status" }) satisfies Partial<WorkspaceDomainError>,
    )
    // A pending record cannot be force-verified either, and verifiedAt
    // cannot be resurrected/forged via this path.
    setWorkspaceDomain("ws-2", "other.example.com", NOW)
    expect(() => setWorkspaceDomainStatus("ws-2", "verified")).toThrowError(
      expect.objectContaining({ code: "invalid_status" }),
    )
    expect(getWorkspaceDomain("ws-2")).toMatchObject({ status: "pending", verifiedAt: null })
    expect(getWorkspaceDomain("ws-1")!.status).toBe("verified")
  })

  it("removes the record and frees the domain claim", () => {
    setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(removeWorkspaceDomain("ws-1")).toBe(true)
    expect(getWorkspaceDomain("ws-1")).toBeNull()
    expect(removeWorkspaceDomain("ws-1")).toBe(false)
    // The freed domain can be claimed by another workspace.
    expect(setWorkspaceDomain("ws-2", "app.example.com", NOW).domain).toBe("app.example.com")
  })
})

describe("verificationTxtValue", () => {
  it("prefixes the token with the DNS TXT convention", () => {
    const record = setWorkspaceDomain("ws-1", "app.example.com", NOW)
    expect(verificationTxtValue(record)).toBe(
      `${VERIFICATION_TXT_PREFIX}${record.verificationToken}`,
    )
    expect(VERIFICATION_TXT_PREFIX).toBe("spindle-verify=")
  })
})
