import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PricingSection } from "./pricing-section"

const STORAGE_KEY = "spindle:pricing-billing"

function billingOption(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) })
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, "", "/pricing")
})

describe("PricingSection", () => {
  it("marks the monthly period as pressed by default", async () => {
    render(<PricingSection />)

    expect(billingOption("Monthly")).toHaveAttribute("aria-pressed", "true")
    expect(billingOption("Yearly")).toHaveAttribute("aria-pressed", "false")
  })

  it("syncs the toggle to localStorage and the ?billing= URL param", async () => {
    const user = userEvent.setup()
    render(<PricingSection />)

    await user.click(billingOption("Yearly"))

    expect(billingOption("Yearly")).toHaveAttribute("aria-pressed", "true")
    expect(billingOption("Monthly")).toHaveAttribute("aria-pressed", "false")
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("yearly")
    expect(new URLSearchParams(window.location.search).get("billing")).toBe("yearly")

    await user.click(billingOption("Monthly"))

    expect(billingOption("Monthly")).toHaveAttribute("aria-pressed", "true")
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("monthly")
    expect(new URLSearchParams(window.location.search).get("billing")).toBeNull()
  })

  it("restores the yearly period from localStorage on mount", async () => {
    window.localStorage.setItem(STORAGE_KEY, "yearly")
    render(<PricingSection />)

    expect(await screen.findByRole("button", { name: /^Yearly/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("lets the ?billing= URL param win over localStorage", async () => {
    window.localStorage.setItem(STORAGE_KEY, "yearly")
    window.history.replaceState(null, "", "/pricing?billing=monthly")
    render(<PricingSection />)

    expect(await screen.findByRole("button", { name: /^Monthly/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("ignores an invalid stored value and falls back to monthly", async () => {
    window.localStorage.setItem(STORAGE_KEY, "weekly")
    render(<PricingSection />)

    expect(await screen.findByRole("button", { name: /^Monthly/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("shows the free plan price and contact-us pricing for paid plans in both periods", async () => {
    const user = userEvent.setup()
    const { container } = render(<PricingSection />)

    // Hobby is the only plan with a numeric price; Team and Enterprise render
    // the same contact-us label as Enterprise's `amount: null` path.
    const planPrices = () =>
      Array.from(container.querySelectorAll(".plan-price")).map((el) => el.textContent)
    expect(planPrices()).toEqual(["$0", "Custom", "Custom"])
    expect(screen.getAllByText("talk to us")).toHaveLength(2)

    await user.click(billingOption("Yearly"))

    expect(planPrices()).toEqual(["$0", "Custom", "Custom"])
  })

  it("links the Hobby CTA to the sign-up page", () => {
    render(<PricingSection />)

    expect(screen.getByRole("link", { name: "Create your workspace" })).toHaveAttribute(
      "href",
      "/sign-up",
    )
  })

  it("renders contact-us CTAs for Team and Enterprise as plain links", () => {
    render(<PricingSection />)

    const ctas = screen.getAllByRole("link", { name: "Contact us" })
    expect(ctas).toHaveLength(2)
    for (const cta of ctas) {
      expect(cta).toHaveAttribute("href", "/contact")
    }
    expect(screen.queryByRole("button", { name: "Contact us" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Start a trial" })).not.toBeInTheDocument()
  })
})
