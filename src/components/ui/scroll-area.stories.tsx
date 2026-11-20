import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "./scroll-area"

const meta = {
  title: "UI/ScrollArea",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Scrollable: Story = {
  render: () => (
    <ScrollArea className="h-64 w-80 rounded-md border">
      <ScrollAreaViewport>
        <div className="p-4">
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="flex h-10 items-center border-b px-2 text-sm last:border-b-0">
              Row {i + 1}
            </div>
          ))}
        </div>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaScrollbar orientation="horizontal">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner />
    </ScrollArea>
  ),
}

export const EdgeFade: Story = {
  render: () => (
    <ScrollArea className="h-48 w-72 rounded-md border" edgeFade edgeFadeSize={24}>
      <ScrollAreaViewport>
        <div className="space-y-3 p-4">
          {Array.from({ length: 20 }, (_, i) => (
            <p key={i} className="text-sm leading-6">
              Scroll to reveal more content — item {i + 1} of 20 fades at the edges.
            </p>
          ))}
        </div>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner />
    </ScrollArea>
  ),
}
