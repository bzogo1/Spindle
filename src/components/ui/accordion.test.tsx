import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion"

function TestAccordion() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="one">
        <AccordionTrigger>First</AccordionTrigger>
        <AccordionContent>First content</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two">
        <AccordionTrigger>Second</AccordionTrigger>
        <AccordionContent>Second content</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

describe("Accordion", () => {
  it("renders triggers collapsed by default", () => {
    render(<TestAccordion />)

    const first = screen.getByRole("button", { name: /first/i })
    expect(first).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("First content")).not.toBeInTheDocument()
  })

  it("expands on click and collapses again when collapsible", async () => {
    const user = userEvent.setup()
    render(<TestAccordion />)

    const first = screen.getByRole("button", { name: /first/i })
    await user.click(first)

    expect(first).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("First content")).toBeInTheDocument()

    await user.click(first)
    expect(first).toHaveAttribute("aria-expanded", "false")
  })

  it("supports multiple open items", async () => {
    const user = userEvent.setup()
    render(
      <Accordion type="multiple">
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>Content A</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>Content B</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )

    await user.click(screen.getByRole("button", { name: "A" }))
    await user.click(screen.getByRole("button", { name: "B" }))

    expect(await screen.findByText("Content A")).toBeInTheDocument()
    expect(await screen.findByText("Content B")).toBeInTheDocument()
  })
})
