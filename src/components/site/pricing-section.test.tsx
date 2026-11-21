import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PricingSection } from "./pricing-section"

describe("PricingSection", () => {
  it("renders only the free Hobby plan and custom Enterprise plan", () => {
    const { container } = render(<PricingSection />)

    const cards = Array.from(container.querySelectorAll(".plan-cards > .plan-card"))
    expect(cards).toHaveLength(2)
    expect(screen.getByText("Hobby")).toBeInTheDocument()
    expect(screen.getByText("Enterprise")).toBeInTheDocument()
    expect(screen.queryByText("Team")).not.toBeInTheDocument()
  })

  it("shows $0 forever for Hobby and custom pricing for Enterprise", () => {
    const { container } = render(<PricingSection />)

    const prices = Array.from(container.querySelectorAll(".plan-price")).map((el) => el.textContent)
    expect(prices).toEqual(["$0", "Custom"])
    expect(screen.getByText("free forever")).toBeInTheDocument()
    expect(screen.getByText("talk to us")).toBeInTheDocument()
  })

  it("lists real-time collaboration as a free Hobby feature", () => {
    render(<PricingSection />)

    expect(
      screen.getByText(/Real-time collaboration with live cursors, comments, and presence/),
    ).toBeInTheDocument()
  })

  it("applies the free card style to Hobby only", () => {
    const { container } = render(<PricingSection />)

    const cards = Array.from(container.querySelectorAll(".plan-cards > .plan-card"))
    expect(cards[0]).toHaveClass("plan-card", "plan-card--free")
    expect(cards[1]).toHaveClass("plan-card")
  })

  it("links the Hobby CTA to sign-up and the Enterprise CTA to contact", () => {
    render(<PricingSection />)

    expect(screen.getByRole("link", { name: "Create your workspace" })).toHaveAttribute(
      "href",
      "/sign-up",
    )
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact")
  })

  it("does not render a billing toggle or comparison table", () => {
    const { container } = render(<PricingSection />)

    expect(container.querySelector(".billing-toggle")).not.toBeInTheDocument()
    expect(container.querySelector(".compare-table")).not.toBeInTheDocument()
  })
})
