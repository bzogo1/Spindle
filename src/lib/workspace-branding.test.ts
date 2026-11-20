import { beforeEach, describe, expect, it } from "vitest"

import {
  getBrandingBySlug,
  getPublicBrandingByKey,
  getWorkspaceBranding,
  resetWorkspaceBrandingForTests,
  toPublicBranding,
  updateWorkspaceBranding,
  workspaceBrandingPatchSchema,
  workspaceBrandingSchema,
} from "./workspace-branding"

beforeEach(() => {
  resetWorkspaceBrandingForTests()
})

describe("workspaceBrandingSchema", () => {
  it("accepts a full valid record", () => {
    const parsed = workspaceBrandingSchema.parse({
      displayName: "Acme Labs",
      logoText: "Acme",
      logoUrl: "https://cdn.example.com/logo.png",
      accentColor: "#1a2B3c",
      backgroundColor: "",
    })
    expect(parsed.accentColor).toBe("#1a2B3c")
  })

  it("rejects non-hex accent colors", () => {
    for (const bad of ["red", "#12345", "#1234567", "123456", "#gggggg"]) {
      expect(workspaceBrandingSchema.safeParse({ ...validInput(), accentColor: bad }).success).toBe(
        false,
      )
    }
  })

  it("rejects non-http(s) logo URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://x/logo.png",
      "notaurl",
      "//cdn.example.com/x.png",
    ]) {
      expect(workspaceBrandingSchema.safeParse({ ...validInput(), logoUrl: bad }).success).toBe(
        false,
      )
    }
    expect(
      workspaceBrandingSchema.safeParse({ ...validInput(), logoUrl: "http://localhost/logo.png" })
        .success,
    ).toBe(true)
  })

  it("rejects unknown keys (strict)", () => {
    expect(
      workspaceBrandingSchema.safeParse({ ...validInput(), workspaceSlug: "evil" }).success,
    ).toBe(false)
  })
})

function validInput() {
  return {
    displayName: "",
    logoText: "",
    logoUrl: "",
    accentColor: "",
    backgroundColor: "",
  }
}

describe("updateWorkspaceBranding / getters", () => {
  it("stores a merged record keyed by workspace id", () => {
    updateWorkspaceBranding("ws-1", "acme", { displayName: "Acme" }, "Acme Inc")
    updateWorkspaceBranding("ws-1", "acme", { accentColor: "#123456" })

    const record = getWorkspaceBranding("ws-1")
    expect(record).toMatchObject({
      displayName: "Acme",
      accentColor: "#123456",
      workspaceSlug: "acme",
      workspaceName: "Acme Inc",
    })
    expect(getWorkspaceBranding("ws-2")).toBeNull()
  })

  it("throws on invalid patch input", () => {
    expect(() => updateWorkspaceBranding("ws-1", "acme", { accentColor: "blue" })).toThrow()
  })

  it("patch schema rejects unknown keys and accepts partials", () => {
    expect(workspaceBrandingPatchSchema.safeParse({ logoText: "X" }).success).toBe(true)
    expect(workspaceBrandingPatchSchema.safeParse({ nope: 1 }).success).toBe(false)
    expect(workspaceBrandingPatchSchema.safeParse({}).success).toBe(true)
  })

  it("resolves records by slug case-insensitively", () => {
    updateWorkspaceBranding("ws-1", "acme-labs", { logoText: "Acme" }, "Acme Labs")
    expect(getBrandingBySlug("ACME-LABS")?.workspaceSlug).toBe("acme-labs")
    expect(getBrandingBySlug("unknown")).toBeNull()
    expect(getBrandingBySlug("")).toBeNull()
  })
})

describe("public subset", () => {
  it("toPublicBranding falls back to workspace name and strips internals", () => {
    const record = updateWorkspaceBranding(
      "ws-1",
      "acme",
      {
        displayName: "",
        logoText: "Acme",
        accentColor: "#112233",
        backgroundColor: "#0a0b0c",
        logoUrl: "https://x.test/l.png",
      },
      "Acme Incorporated",
    )
    const pub = toPublicBranding(record)
    expect(pub).toEqual({
      displayName: "Acme Incorporated",
      logoText: "Acme",
      accentColor: "#112233",
      backgroundColor: "#0a0b0c",
      logoUrl: "https://x.test/l.png",
    })
    expect(pub).not.toHaveProperty("workspaceSlug")
    expect(pub).not.toHaveProperty("workspaceName")
  })

  it("getPublicBrandingByKey resolves by id or slug", () => {
    updateWorkspaceBranding(
      "ws-1",
      "acme",
      { accentColor: "#aabbcc", backgroundColor: "#010203" },
      "Acme",
    )
    expect(getPublicBrandingByKey("ws-1")?.accentColor).toBe("#aabbcc")
    expect(getPublicBrandingByKey("acme")?.accentColor).toBe("#aabbcc")
    expect(getPublicBrandingByKey("acme")?.backgroundColor).toBe("#010203")
    expect(getPublicBrandingByKey("missing")).toBeNull()
    expect(getPublicBrandingByKey("")).toBeNull()
  })
})
