import { describe, expect, it } from "vitest"

import { NAV_ITEMS } from "./nav-items"

describe("NAV_ITEMS", () => {
  it("includes an Admin item pointing at /app/admin", () => {
    const admin = NAV_ITEMS.find((item) => item.label === "Admin")
    expect(admin).toBeDefined()
    expect(admin?.href).toBe("/app/admin")
    expect(admin?.icon).toBeTruthy()
  })

  it("includes an Affiliates item pointing at /app/affiliate", () => {
    const affiliates = NAV_ITEMS.find((item) => item.label === "Affiliates")
    expect(affiliates).toBeDefined()
    expect(affiliates?.href).toBe("/app/affiliate")
    expect(affiliates?.icon).toBeTruthy()
  })

  it("includes a Sessions item pointing at /app/sessions", () => {
    const sessions = NAV_ITEMS.find((item) => item.label === "Sessions")
    expect(sessions).toBeDefined()
    expect(sessions?.href).toBe("/app/sessions")
    expect(sessions?.icon).toBeTruthy()
  })

  it("keeps every pre-existing nav item", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href)
    expect(hrefs).toEqual([
      "/dashboard",
      "/projects",
      "/app/files",
      "/app/lab",
      "/app/chat",
      "/app/agent",
      "/app/automations",
      "/app/cohorts",
      "/app/security",
      "/app/sessions",
      "/app/workspaces",
      "/app/affiliate",
      "/app/partner",
      "/app/referral",
      "/app/beta",
      "/app/admin",
      "/app/support",
      "/app/feedback",
      "/app/whats-new",
      "/app/settings",
    ])
  })

  it("has unique labels and hrefs", () => {
    const labels = NAV_ITEMS.map((item) => item.label)
    const hrefs = NAV_ITEMS.map((item) => item.href)
    expect(new Set(labels).size).toBe(labels.length)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
