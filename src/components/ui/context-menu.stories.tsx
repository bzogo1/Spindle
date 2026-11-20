import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

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

const meta = {
  title: "UI/ContextMenu",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const triggerClass =
  "flex h-40 w-80 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-sm text-muted-foreground select-none"

export const Basic: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>
        Right-click or press Shift+F10
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Actions</ContextMenuLabel>
        <ContextMenuItem>
          Copy <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          Paste <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const Submenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>Right-click for nested items</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Rename</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Share</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Email</ContextMenuItem>
            <ContextMenuItem>Copy link</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const CheckboxItem: Story = {
  render: function CheckboxItemStory() {
    const [showGrid, setShowGrid] = useState(true)
    const [density, setDensity] = useState("comfortable")
    return (
      <ContextMenu>
        <ContextMenuTrigger className={triggerClass}>Right-click for toggles</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
            Show grid
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuLabel>Density</ContextMenuLabel>
          <ContextMenuRadioGroup value={density} onValueChange={setDensity}>
            <ContextMenuRadioItem value="compact">Compact</ContextMenuRadioItem>
            <ContextMenuRadioItem value="comfortable">Comfortable</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    )
  },
}
