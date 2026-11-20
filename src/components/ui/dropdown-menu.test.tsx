import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu"

function TestMenu({ onAction = vi.fn() }: { onAction?: (value: string) => void }) {
  const [checked, setChecked] = useState(false)
  const [radio, setRadio] = useState("a")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAction("edit")}>
          Edit <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("delete")} disabled>
          Delete
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={checked}
          onCheckedChange={setChecked}
          onSelect={(e) => e.preventDefault()}
        >
          Show hidden
        </DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value={radio} onValueChange={setRadio}>
          <DropdownMenuRadioItem value="a" onSelect={(e) => e.preventDefault()}>
            Option A
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="b" onSelect={(e) => e.preventDefault()}>
            Option B
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe("DropdownMenu", () => {
  it("opens on trigger click and lists items", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    const trigger = screen.getByRole("button", { name: "Open menu" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByText("Actions")).toBeInTheDocument()
    expect(screen.getByText("⌘E")).toBeInTheDocument()
  })

  it("fires onSelect and closes for regular items", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<TestMenu onAction={onAction} />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(screen.getByRole("menuitem", { name: /edit/i }))

    expect(onAction).toHaveBeenCalledWith("edit")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  })

  it("does not select disabled items", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<TestMenu onAction={onAction} />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(screen.getByRole("menuitem", { name: /delete/i }))

    expect(onAction).not.toHaveBeenCalledWith("delete")
  })

  it("toggles checkbox items", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    const item = screen.getByRole("menuitemcheckbox", { name: /show hidden/i })
    expect(item).toHaveAttribute("aria-checked", "false")

    await user.click(item)
    expect(item).toHaveAttribute("aria-checked", "true")
  })

  it("selects radio items", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(screen.getByRole("menuitemradio", { name: "Option B" }))

    expect(screen.getByRole("menuitemradio", { name: "Option B" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  })
})
