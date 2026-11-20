// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  applyForAffiliate,
  approveAffiliate,
  clearAffiliateStoreForTests,
  statsForAffiliate,
  suspendAffiliate,
} from "@/lib/affiliate"

import { GET } from "./route"

let ipCounter = 0

function get(code: string, query = "") {
  ipCounter += 1
  return GET(
    new Request(`http://localhost/api/affiliate/click/${code}${query}`, {
      headers: {
        "x-forwarded-for": `10.6.3.${ipCounter}`,
        "user-agent": "vitest-agent",
      },
    }),
    { params: Promise.resolve({ code }) },
  )
}

function activeAffiliate() {
  const account = applyForAffiliate("user-click", "click@example.com")
  approveAffiliate(account.id)
  return account
}

beforeEach(() => {
  clearAffiliateStoreForTests()
})

describe("GET /api/affiliate/click/[code]", () => {
  it("records a click and returns JSON when no redirect target is given", async () => {
    const account = activeAffiliate()

    const response = await get(account.code)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, tracked: true, code: account.code })
    expect(statsForAffiliate(account).clicks).toBe(1)
  })

  it("redirects to a safe internal ?to= target", async () => {
    const account = activeAffiliate()

    const response = await get(account.code, "?to=/pricing")
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("http://localhost/pricing")
    expect(statsForAffiliate(account).clicks).toBe(1)
  })

  it("ignores unsafe redirect targets and still returns JSON", async () => {
    const account = activeAffiliate()

    const response = await get(account.code, "?to=https://evil.example.com")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, tracked: true })
  })

  it.each([
    "?to=//evil.com", // protocol-relative
    "?to=/\\evil.com", // backslash resolves to //evil.com under WHATWG parsing
    "?to=/\\tevil.com", // backslash + path segment
    "?to=/\\//evil.com", // backslash-mixed slashes
    "?to=/%5Cevil.com", // encoded backslash
    "?to=/%09evil.com", // encoded tab (control char)
  ])("refuses to redirect for unsafe target %s", async (query) => {
    const account = activeAffiliate()

    const response = await get(account.code, query)
    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    expect(await response.json()).toMatchObject({ ok: true, tracked: true })
    expect(statsForAffiliate(account).clicks).toBe(1)
  })

  it("still redirects for a plain internal path and tracks the click", async () => {
    const account = activeAffiliate()

    const response = await get(account.code, "?to=/app/files?path=%2Fdocs")
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("http://localhost/app/files?path=/docs")
    expect(statsForAffiliate(account).clicks).toBe(1)
  })

  it("404s for pending, unknown, and suspended codes identically", async () => {
    const pending = applyForAffiliate("user-pending", "p@example.com")
    const suspended = activeAffiliate()
    suspendAffiliate(suspended.id)

    for (const code of [pending.code, suspended.code, "AFF-XXXX-XXXX"]) {
      const response = await get(code)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    }
    expect(statsForAffiliate(pending).clicks).toBe(0)
    expect(statsForAffiliate(suspended).clicks).toBe(0)
  })
})
