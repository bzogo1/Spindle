import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReferralLanding } from "./referral-landing"
import { REFERRAL_STORAGE_KEY } from "@/lib/referral"

beforeEach(() => {
  localStorage.clear()
})

describe("ReferralLanding", () => {
  it("stores a valid code and renders the invite pitch", () => {
    render(<ReferralLanding code="SPN-ABCD-EFGH" />)

    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe("SPN-ABCD-EFGH")
    expect(screen.getByRole("heading", { name: /invited to Spindle/i })).toBeTruthy()
    expect(screen.getByText("SPN-ABCD-EFGH")).toBeTruthy()
  })

  it("renders the create-workspace CTA linking to sign-up", () => {
    render(<ReferralLanding code="SPN-ABCD-EFGH" />)

    const cta = screen.getByRole("link", { name: /create free workspace/i })
    expect(cta.getAttribute("href")).toBe("/sign-up")
  })

  it("shows a friendly state for an invalid code and stores nothing", () => {
    render(<ReferralLanding code="bogus" />)

    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(screen.getByRole("heading", { name: /doesn't look right/i })).toBeTruthy()
    // Normal signup is still offered.
    expect(screen.getByRole("link", { name: /create free workspace/i })).toBeTruthy()
  })

  it("rejects a self-referral but still renders the pitch", () => {
    localStorage.setItem("spindle.referral-code", "SPN-ABCD-EFGH")
    render(<ReferralLanding code="SPN-ABCD-EFGH" />)

    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(screen.getByText(/your own referral link/i)).toBeTruthy()
  })

  it("keeps the social-proof space reserved when a variant disables it", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.includes("/api/landing-ab/assign")) {
        return new Response(
          JSON.stringify({
            ok: true,
            assignment: {
              experimentId: "lab_1",
              variantId: "lav_2",
              config: { headline: "Variant headline", showSocialProof: false },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })

    render(<ReferralLanding code="SPN-ABCD-EFGH" />)

    // The variant headline applies once the assignment resolves…
    expect(await screen.findByRole("heading", { name: /variant headline/i })).toBeTruthy()
    // …but the stats grid stays mounted as an invisible space-holder so the
    // section cannot collapse and shift the page.
    const grid = document.querySelector(".stats-grid") as HTMLElement
    expect(grid).toBeTruthy()
    expect(grid.style.visibility).toBe("hidden")
    expect(grid.textContent).toContain("5 GB")
    expect(grid.closest("section")?.getAttribute("aria-hidden")).toBe("true")
  })
})
