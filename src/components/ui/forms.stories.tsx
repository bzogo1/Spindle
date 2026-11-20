import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Search } from "lucide-react"
import { expect, userEvent, within } from "storybook/test"

import { Input } from "./input"
import { Progress } from "./progress"
import { Switch } from "./switch"

const meta = {
  title: "UI/Forms",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Inputs: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="sb-email" className="text-sm font-medium">
          Work email
        </label>
        <Input id="sb-email" type="email" placeholder="you@lab.edu" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="sb-search" className="text-sm font-medium">
          Search
        </label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input id="sb-search" className="pl-9" placeholder="Search files…" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="sb-disabled" className="text-sm font-medium">
          Disabled
        </label>
        <Input id="sb-disabled" disabled placeholder="Not editable" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="sb-invalid" className="text-sm font-medium">
          Invalid
        </label>
        <Input id="sb-invalid" aria-invalid defaultValue="not-an-email" />
        <p className="text-destructive text-xs">Enter a valid email address.</p>
      </div>
    </div>
  ),
}

export const Switches: Story = {
  render: function SwitchesStory() {
    const [on, setOn] = useState(true)
    return (
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={setOn} aria-label="Toggle demo" />
        <span className="text-muted-foreground text-sm">
          Background sync {on ? "enabled" : "disabled"}
        </span>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole("switch", { name: "Toggle demo" })
    await expect(toggle).toHaveAttribute("aria-checked", "true")
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    await expect(canvas.getByText("Background sync disabled")).toBeInTheDocument()
  },
}

export const ProgressBars: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Progress value={35} aria-label="Upload progress" />
      <Progress value={80} aria-label="Nearly done" />
      <Progress value={100} aria-label="Complete" />
    </div>
  ),
}
