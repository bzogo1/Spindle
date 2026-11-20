import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Input } from "./input"

describe("Input", () => {
  it("renders and accepts typed text", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input placeholder="Email" onChange={onChange} />)

    const input = screen.getByPlaceholderText("Email")
    expect(input).toHaveAttribute("data-slot", "input")

    await user.type(input, "a@b.c")
    expect(input).toHaveValue("a@b.c")
    expect(onChange).toHaveBeenCalled()
  })

  it("supports type and disabled state", () => {
    render(<Input type="password" disabled value="secret" readOnly />)

    const input = screen.getByDisplayValue("secret")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toBeDisabled()
  })

  it("forwards aria-invalid", () => {
    render(<Input aria-invalid="true" aria-label="Name" />)
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true")
  })

  it("focuses on mount when autoFocus is set", () => {
    render(<Input autoFocus aria-label="Focused" />)
    expect(screen.getByLabelText("Focused")).toHaveFocus()
  })
})
