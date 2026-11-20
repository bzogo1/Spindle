import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu"

function TestMenu({ onSelect }: { onSelect?: (value: string) => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger tabIndex={0} className="block p-4">
        Right-click me
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Actions</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onSelect?.("copy")}>
          Copy <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSelect?.("paste")}>Paste</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Share</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onSelect?.("email")}>Email</ContextMenuItem>
            <ContextMenuItem onSelect={() => onSelect?.("link")} disabled>
              Copy link
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem variant="destructive" onSelect={() => onSelect?.("delete")}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

describe("ContextMenu", () => {
  it("opens on right-click and renders items in a portal", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    const trigger = screen.getByText("Right-click me")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    await user.pointer({ keys: "[MouseRight]", target: trigger })

    expect(await screen.findByRole("menu")).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toBeInTheDocument()
    expect(screen.getByText("Actions")).toBeInTheDocument()
    // Portal: menu is rendered outside the trigger subtree.
    expect(trigger.contains(screen.getByRole("menu"))).toBe(false)
  })

  it("opens via Shift+F10 when the trigger is focused", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    const trigger = screen.getByText("Right-click me")
    trigger.focus()
    await user.keyboard("{Shift>}{F10}{/Shift}")

    expect(await screen.findByRole("menu")).toBeInTheDocument()
  })

  it("selects an item on click", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TestMenu onSelect={onSelect} />)

    fireEvent.contextMenu(screen.getByText("Right-click me"))
    await user.click(await screen.findByRole("menuitem", { name: /Paste/ }))

    expect(onSelect).toHaveBeenCalledWith("paste")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  })

  it("navigates and selects with the keyboard", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TestMenu onSelect={onSelect} />)

    fireEvent.contextMenu(screen.getByText("Right-click me"))
    await screen.findByRole("menu")

    // First ArrowDown focuses "Copy", second moves to "Paste", Enter selects.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")

    expect(onSelect).toHaveBeenCalledWith("paste")
  })

  it("opens a submenu and selects a nested item", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TestMenu onSelect={onSelect} />)

    fireEvent.contextMenu(screen.getByText("Right-click me"))
    await screen.findByRole("menu")

    // ArrowDown x3 focuses the "Share" sub-trigger, ArrowRight opens the
    // submenu, ArrowDown focuses "Email", Enter selects it.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowDown}{Enter}")

    expect(onSelect).toHaveBeenCalledWith("email")
  })

  it("does not select disabled items", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<TestMenu onSelect={onSelect} />)

    fireEvent.contextMenu(screen.getByText("Right-click me"))
    await user.click(await screen.findByRole("menuitem", { name: "Share" }))
    await user.click(await screen.findByRole("menuitem", { name: "Copy link" }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<TestMenu />)

    fireEvent.contextMenu(screen.getByText("Right-click me"))
    expect(await screen.findByRole("menu")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
  })
})

function CheckboxMenu() {
  const [checked, setChecked] = useState(false)
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block p-4">Toggle</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuCheckboxItem
          checked={checked}
          onCheckedChange={setChecked}
          onSelect={(event) => event.preventDefault()}
        >
          Show grid
        </ContextMenuCheckboxItem>
        <ContextMenuRadioGroup defaultValue="day">
          <ContextMenuRadioItem value="day">Day</ContextMenuRadioItem>
          <ContextMenuRadioItem value="week">Week</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

describe("ContextMenu checkbox and radio items", () => {
  it("toggles a checkbox item", async () => {
    const user = userEvent.setup()
    render(<CheckboxMenu />)

    fireEvent.contextMenu(screen.getByText("Toggle"))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Show grid" }))

    const item = await screen.findByRole("menuitemcheckbox", { name: "Show grid" })
    expect(item).toHaveAttribute("aria-checked", "true")
  })
})
