import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ReviewChecklist } from "./review-checklist"
import { reviewCriterionCount, type ReviewCategory } from "@/lib/apps/review"

describe("ReviewChecklist", () => {
  it("renders all categories and criteria", () => {
    render(<ReviewChecklist />)
    expect(screen.getByText("Security")).toBeInTheDocument()
    expect(screen.getByText("Permissions scope")).toBeInTheDocument()
    expect(screen.getByText("UX")).toBeInTheDocument()
    expect(screen.getByText("Performance")).toBeInTheDocument()
    expect(screen.getAllByRole("radio", { name: /Pass/ }).length).toBe(reviewCriterionCount())
  })

  it("starts in review with everything unchecked", () => {
    render(<ReviewChecklist />)
    expect(screen.getByText("In review")).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${reviewCriterionCount()} unchecked`))).toBeInTheDocument()
  })

  it("marks criteria and reports changes via onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ReviewChecklist onChange={onChange} />)

    const passButtons = screen.getAllByRole("radio", { name: "Pass" })
    await user.click(passButtons[0])

    expect(onChange).toHaveBeenCalled()
    const [checks, summary] = onChange.mock.calls.at(-1)!
    expect(checks).toHaveLength(1)
    expect(summary.passed).toBe(1)
    expect(summary.approved).toBe(false)
  })

  it("approves when every required criterion passes", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const tinyCategories: ReviewCategory[] = [
      {
        id: "security",
        title: "Security",
        summary: "s",
        criteria: [
          { id: "a", title: "A", description: "d", required: true },
          { id: "b", title: "B", description: "d", required: false },
        ],
      },
    ]
    render(<ReviewChecklist categories={tinyCategories} onChange={onChange} />)

    // First criterion ("a", required) — click its Pass button.
    await user.click(screen.getAllByRole("radio", { name: "Pass" })[0])
    const [, summary] = onChange.mock.calls.at(-1)!
    expect(summary.approved).toBe(true)
    expect(screen.getByText("Approved")).toBeInTheDocument()
  })

  it("clicking the active status clears it back to unchecked", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ReviewChecklist onChange={onChange} />)

    const failButton = screen.getAllByRole("radio", { name: "Fail" })[0]
    await user.click(failButton)
    await user.click(failButton)

    const [checks] = onChange.mock.calls.at(-1)!
    expect(checks).toHaveLength(0)
  })
})
