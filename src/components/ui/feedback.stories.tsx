import type { Meta, StoryObj } from "@storybook/react-vite"

import { Alert, AlertDescription, AlertTitle } from "./alert"
import { Badge } from "./badge"
import { Separator } from "./separator"
import { Skeleton, SkeletonCard, SkeletonText } from "./skeleton"

const meta = {
  title: "UI/Feedback",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
      <Badge size="sm">Small</Badge>
      <Badge size="lg">Large</Badge>
    </div>
  ),
}

export const Alerts: Story = {
  render: () => (
    <div className="grid max-w-lg gap-4">
      <Alert>
        <AlertTitle>Upload complete</AlertTitle>
        <AlertDescription>
          42 files were added to the project. Processing continues in the background.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Sync failed</AlertTitle>
        <AlertDescription>
          The connection to the workspace was lost. Your changes are queued locally.
        </AlertDescription>
      </Alert>
    </div>
  ),
}

export const Skeletons: Story = {
  render: () => (
    <div className="grid max-w-md gap-6">
      <div className="space-y-2">
        <SkeletonText lines={3} />
      </div>
      <Skeleton className="h-24 w-full" />
      <SkeletonCard />
    </div>
  ),
}

export const Separators: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <p className="text-muted-foreground text-sm">Above the rule</p>
      <Separator />
      <p className="text-muted-foreground text-sm">Below the rule</p>
      <div className="flex h-8 items-center gap-4">
        <span className="text-sm">Left</span>
        <Separator orientation="vertical" />
        <span className="text-sm">Right</span>
      </div>
    </div>
  ),
}
