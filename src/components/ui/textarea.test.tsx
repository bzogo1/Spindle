import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Textarea, TextareaField } from "@/components/ui/textarea"

function setScrollHeight(element: HTMLElement, value: number) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value,
  })
}

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea aria-label="Notes" />)
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("auto-resizes to scrollHeight within min/max rows", () => {
    render(<Textarea aria-label="Notes" autoResize minRows={2} maxRows={4} defaultValue="hello" />)
    const field = screen.getByRole("textbox") as HTMLTextAreaElement

    // jsdom reports line-height "normal"; the component falls back to 20px.
    // minRows=2 -> 2 * 20 = 40px minimum height.
    expect(field.style.height).toBe("40px")

    setScrollHeight(field, 200)
    fireEvent.change(field, { target: { value: "hello\nworld" } })

    // maxRows=4 -> 4 * 20 = 80px cap; scrollHeight 200 exceeds it.
    expect(field.style.height).toBe("80px")
    expect(field.style.overflowY).toBe("auto")

    setScrollHeight(field, 60)
    fireEvent.change(field, { target: { value: "hello\nthere" } })
    expect(field.style.height).toBe("60px")
    expect(field.style.overflowY).toBe("hidden")
  })

  it("does not resize when autoResize is off", () => {
    render(<Textarea aria-label="Notes" defaultValue="hello" />)
    const field = screen.getByRole("textbox") as HTMLTextAreaElement
    setScrollHeight(field, 200)
    fireEvent.change(field, { target: { value: "hello\nworld" } })
    expect(field.style.height).toBe("")
  })

  it("shows a character count and marks over-limit state", () => {
    render(<Textarea aria-label="Notes" showCount maxLength={5} defaultValue="hi" />)
    expect(screen.getByText("2/5")).toBeInTheDocument()

    const field = screen.getByRole("textbox")
    fireEvent.change(field, { target: { value: "way too long" } })
    const count = screen.getByText("12/5")
    expect(count).toHaveClass("text-destructive")
    // Soft limit: the native maxLength attribute is not applied.
    expect(field).not.toHaveAttribute("maxlength")
  })

  it("applies native maxLength only with hardLimit", () => {
    const { rerender } = render(<Textarea aria-label="Notes" maxLength={5} hardLimit />)
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "5")

    rerender(<Textarea aria-label="Notes" maxLength={5} />)
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxlength")
  })

  it("wires aria-describedby to the counter", () => {
    render(<Textarea aria-label="Notes" showCount maxLength={10} />)
    const field = screen.getByRole("textbox")
    const countId = field.getAttribute("aria-describedby")
    expect(countId).toBeTruthy()
    expect(document.getElementById(countId!)).toHaveTextContent("0/10")
  })

  it("applies error status with aria-invalid and destructive classes", () => {
    render(<Textarea aria-label="Notes" status="error" />)
    const field = screen.getByRole("textbox")
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(field.className).toContain("border-destructive")
  })

  it("supports warning and success statuses", () => {
    const { rerender } = render(<Textarea aria-label="Notes" status="warning" />)
    expect(screen.getByRole("textbox").className).toContain("border-chart-3")

    rerender(<Textarea aria-label="Notes" status="success" />)
    expect(screen.getByRole("textbox").className).toContain("border-chart-2")
  })
})

describe("TextareaField", () => {
  it("renders label, hint and error wired via aria-describedby", () => {
    render(
      <TextareaField id="bio" label="Bio" hint="Tell us about yourself" error="Bio is required" />,
    )
    expect(screen.getByLabelText("Bio")).toBeInTheDocument()
    const field = screen.getByRole("textbox")
    expect(field).toHaveAttribute("aria-invalid", "true")

    const describedBy = field.getAttribute("aria-describedby")!.split(" ")
    expect(describedBy).toHaveLength(2)
    expect(document.getElementById(describedBy[0]!)).toHaveTextContent("Tell us about yourself")
    expect(document.getElementById(describedBy[1]!)).toHaveTextContent("Bio is required")
  })

  it("includes the counter id in aria-describedby when showCount is on", () => {
    render(<TextareaField id="bio" label="Bio" showCount maxLength={10} error="Too short" />)
    const field = screen.getByRole("textbox")
    const ids = field.getAttribute("aria-describedby")!.split(" ")
    // hint absent -> error + count
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[1]!)).toHaveAttribute("data-slot", "textarea-count")
  })
})
