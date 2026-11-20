import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState, type ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  RadioGroup,
  RadioGroupCard,
  RadioGroupCardDescription,
  RadioGroupCardIcon,
  RadioGroupCardTitle,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { ZapIcon } from "lucide-react"

function BasicGroup(props: ComponentProps<typeof RadioGroup>) {
  return (
    <RadioGroup {...props}>
      <RadioGroupItem value="a" aria-label="Option A" />
      <RadioGroupItem value="b" aria-label="Option B" />
      <RadioGroupItem value="c" aria-label="Option C" />
    </RadioGroup>
  )
}

describe("RadioGroup", () => {
  it("selects an option on click (uncontrolled)", async () => {
    const user = userEvent.setup()
    render(<BasicGroup defaultValue="a" />)

    const optionB = screen.getByRole("radio", { name: "Option B" })
    await user.click(optionB)

    expect(optionB).toBeChecked()
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked()
  })

  it("supports controlled value and onValueChange", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    function Controlled() {
      const [value, setValue] = useState("a")
      return (
        <RadioGroup
          value={value}
          onValueChange={(next) => {
            setValue(next)
            onValueChange(next)
          }}
        >
          <RadioGroupItem value="a" aria-label="Option A" />
          <RadioGroupItem value="b" aria-label="Option B" />
        </RadioGroup>
      )
    }

    render(<Controlled />)
    await user.click(screen.getByRole("radio", { name: "Option B" }))

    expect(onValueChange).toHaveBeenCalledWith("b")
    expect(screen.getByRole("radio", { name: "Option B" })).toBeChecked()
  })

  it("enters via Tab and moves selection with arrow keys", async () => {
    const user = userEvent.setup()
    render(<BasicGroup defaultValue="a" />)

    await user.tab()
    const optionA = screen.getByRole("radio", { name: "Option A" })
    expect(optionA).toHaveFocus()

    // Radix moves focus in a setTimeout after keydown, so keep the key
    // "pressed" (no keyup) until the focus/selection has been applied.
    fireEvent.keyDown(optionA, { key: "ArrowDown" })
    const optionB = screen.getByRole("radio", { name: "Option B" })
    await waitFor(() => expect(optionB).toBeChecked())
    expect(optionB).toHaveFocus()
    fireEvent.keyUp(optionB, { key: "ArrowDown" })

    fireEvent.keyDown(optionB, { key: "ArrowUp" })
    await waitFor(() => expect(optionA).toBeChecked())
    expect(optionA).toHaveFocus()
    fireEvent.keyUp(optionA, { key: "ArrowUp" })
  })

  it("renders and selects card options", async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup variant="card" defaultValue="basic">
        <RadioGroupCard value="basic">
          <RadioGroupCardIcon>
            <ZapIcon />
          </RadioGroupCardIcon>
          <RadioGroupCardTitle>Basic</RadioGroupCardTitle>
          <RadioGroupCardDescription>For small projects</RadioGroupCardDescription>
        </RadioGroupCard>
        <RadioGroupCard value="pro">
          <RadioGroupCardTitle>Pro</RadioGroupCardTitle>
          <RadioGroupCardDescription>For growing teams</RadioGroupCardDescription>
        </RadioGroupCard>
      </RadioGroup>,
    )

    const proCard = screen.getByRole("radio", { name: /Pro/ })
    expect(screen.getByText("For small projects")).toBeInTheDocument()
    expect(proCard).not.toBeChecked()

    await user.click(proCard)
    expect(proCard).toBeChecked()
    expect(screen.getByRole("radio", { name: /Basic/ })).not.toBeChecked()
  })

  it("supports horizontal orientation", () => {
    const { container } = render(<BasicGroup orientation="horizontal" />)

    const group = container.querySelector('[data-slot="radio-group"]')!
    expect(group).toHaveAttribute("data-orientation", "horizontal")
    expect(group.className).toContain("flex")
    // Radix sets aria-orientation on the group for horizontal layouts.
    expect(group).toHaveAttribute("aria-orientation", "horizontal")
  })

  it("disables every option when the group is disabled", () => {
    render(<BasicGroup disabled />)

    for (const name of ["Option A", "Option B", "Option C"]) {
      expect(screen.getByRole("radio", { name })).toBeDisabled()
    }
  })

  it("disables individual options via the disabled prop", async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" aria-label="Option A" />
        <RadioGroupItem value="b" aria-label="Option B" disabled />
      </RadioGroup>,
    )

    const optionB = screen.getByRole("radio", { name: "Option B" })
    expect(optionB).toBeDisabled()

    await user.click(optionB)
    expect(optionB).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "Option A" })).toBeChecked()
  })
})
