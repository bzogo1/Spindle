// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { resetWorkspaceBrandingForTests, updateWorkspaceBranding } from "@/lib/workspace-branding"

import { GET } from "./route"

let ipCounter = 0
function call(query: string) {
  const request = new Request(`http://localhost/api/workspaces/brand${query}`, {
    headers: { "x-forwarded-for": `10.5.0.${++ipCounter}` },
  })
  return GET(request)
}

beforeEach(() => {
  resetWorkspaceBrandingForTests()
})

describe("GET /api/workspaces/brand", () => {
  it("requires a slug or workspace param", async () => {
    const response = await call("")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("404s for unknown workspaces", async () => {
    const response = await call("?slug=nope")
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("returns the safe subset by slug without auth", async () => {
    updateWorkspaceBranding(
      "ws-1",
      "acme",
      {
        displayName: "Acme",
        logoText: "Acme",
        logoUrl: "https://cdn.example.com/logo.png",
        accentColor: "#112233",
        backgroundColor: "#0a0b0c",
      },
      "Acme Incorporated",
    )

    const response = await call("?slug=acme")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.branding).toEqual({
      displayName: "Acme",
      logoText: "Acme",
      logoUrl: "https://cdn.example.com/logo.png",
      accentColor: "#112233",
      backgroundColor: "#0a0b0c",
    })
    // Internal fields must never leak.
    expect(body.branding).not.toHaveProperty("workspaceSlug")
    expect(body.branding).not.toHaveProperty("workspaceName")
  })

  it("resolves ?workspace= by id and falls back to slug", async () => {
    updateWorkspaceBranding("ws-1", "acme", { accentColor: "#aabbcc" }, "Acme Inc")

    const byId = await call("?workspace=ws-1")
    expect(byId.status).toBe(200)
    expect((await byId.json()).branding.displayName).toBe("Acme Inc")

    const bySlug = await call("?workspace=acme")
    expect(bySlug.status).toBe(200)
    expect((await bySlug.json()).branding.accentColor).toBe("#aabbcc")
  })

  it("?slug= accepts an id too — both params share id-then-slug semantics", async () => {
    updateWorkspaceBranding("ws-1", "acme", { accentColor: "#aabbcc" }, "Acme Inc")

    const byId = await call("?slug=ws-1")
    expect(byId.status).toBe(200)
    expect((await byId.json()).branding.displayName).toBe("Acme Inc")
  })

  it("is rate limited", async () => {
    // publicRead = 60/min per IP; unique IPs per call in `call()` won't trip it,
    // so hammer one IP directly.
    let last: Response | null = null
    for (let i = 0; i < 65; i++) {
      last = await GET(
        new Request("http://localhost/api/workspaces/brand?slug=x", {
          headers: { "x-forwarded-for": "10.9.9.9" },
        }),
      )
    }
    expect(last?.status).toBe(429)
  })
})
