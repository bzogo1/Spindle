import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { Button } from "./button"
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "./bottom-sheet"

const meta = {
  title: "UI/BottomSheet",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  render: function OpenStory() {
    const [open, setOpen] = useState(true)
    return (
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetTrigger asChild>
          <Button variant="outline">Open sheet</Button>
        </BottomSheetTrigger>
        <BottomSheetContent onSwipeDown={() => setOpen(false)}>
          <BottomSheetHeader>
            <BottomSheetTitle>Share project</BottomSheetTitle>
            <BottomSheetDescription>
              Choose who can view and edit this project.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <ul className="text-muted-foreground grid gap-2 px-4 text-sm">
            <li>• Anyone with the link can view</li>
            <li>• Editors can modify files</li>
            <li>• Only you can delete the project</li>
          </ul>
          <BottomSheetFooter showCloseButton>
            <Button>Copy link</Button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    )
  },
}

export const Closed: Story = {
  render: () => (
    <BottomSheet>
      <BottomSheetTrigger asChild>
        <Button variant="outline">Open sheet</Button>
      </BottomSheetTrigger>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>Filters</BottomSheetTitle>
          <BottomSheetDescription>Narrow the list down on small screens.</BottomSheetDescription>
        </BottomSheetHeader>
        <BottomSheetFooter showCloseButton>
          <Button>Apply</Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  ),
}
