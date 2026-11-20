import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Select, type SelectOption } from "./select"

const options: SelectOption[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry", disabled: true },
  { value: "durian", label: "Durian", group: "Exotic" },
]

function ControlledSelect({
  onChange: userOnChange,
  ...props
}: Partial<React.ComponentProps<typeof Select>> & { multiple?: boolean }) {
  const [value, setValue] = useState<string | string[] | null>(props.multiple ? [] : null)
  return (
    <Select
      options={options}
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v)
        userOnChange?.(v)
      }}
    />
  )
}

describe("Select", () => {
  it("renders the placeholder and opens on click", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect placeholder="Pick a fruit" />)

    const trigger = screen.getByRole("combobox")
    expect(trigger).toHaveTextContent("Pick a fruit")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getAllByRole("option")).toHaveLength(4)
    expect(screen.getByText("Exotic")).toBeInTheDocument()
  })

  it("selects an option in single mode and closes", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSelect onChange={onChange} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: "Banana" }))

    expect(onChange).toHaveBeenCalledWith("banana")
    expect(screen.getByRole("combobox")).toHaveTextContent("Banana")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
  })

  it("does not select disabled options", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select options={options} value={null} onChange={onChange} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: "Cherry" }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("supports multi-select without closing", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSelect multiple onChange={onChange} />)

    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true")

    await user.click(screen.getByRole("option", { name: "Apple" }))
    expect(onChange).toHaveBeenLastCalledWith(["apple"])
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    await user.click(screen.getByRole("option", { name: "Durian" }))
    expect(onChange).toHaveBeenLastCalledWith(["apple", "durian"])
    expect(screen.getByRole("combobox")).toHaveTextContent("Apple, Durian")
  })

  it("navigates and selects with the keyboard", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSelect onChange={onChange} />)

    const trigger = screen.getByRole("combobox")
    await user.click(trigger)

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")

    expect(onChange).toHaveBeenCalledWith("banana")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect />)

    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
  })

  it("filters options when searchable", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect searchable />)

    await user.click(screen.getByRole("combobox"))
    const searchbox = screen.getByRole("combobox", { name: /search options/i })

    await user.type(searchbox, "ban")

    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1)
    })
    expect(screen.getByRole("option", { name: "Banana" })).toBeInTheDocument()
  })

  it("shows a loading state", async () => {
    const user = userEvent.setup()
    render(
      <Select options={options} value={null} onChange={() => {}} loading loadingText="Fetching…" />,
    )

    await user.click(screen.getByRole("combobox"))
    expect(screen.getByText("Fetching…")).toBeInTheDocument()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
  })

  it("does not open when disabled", async () => {
    const user = userEvent.setup()
    render(<Select options={options} value={null} onChange={() => {}} disabled />)

    const trigger = screen.getByRole("combobox")
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})
