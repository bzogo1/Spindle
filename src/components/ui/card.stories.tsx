import type { Meta, StoryObj } from "@storybook/react-vite"
import { Bell } from "lucide-react"

import { Avatar, AvatarFallback } from "./avatar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card"

const meta = {
  title: "UI/Card & Avatar",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const ProjectCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Thesis sources</CardTitle>
        <CardDescription>Updated 2 hours ago</CardDescription>
        <CardAction>
          <Bell className="text-muted-foreground size-4" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          128 files · 3 notebooks · 2 automations running
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Avatar size="sm">
          <AvatarFallback>MK</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarFallback>JT</AvatarFallback>
        </Avatar>
        <span className="text-muted-foreground text-xs">+4 collaborators</span>
      </CardFooter>
    </Card>
  ),
}

export const Avatars: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>CD</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>EF</AvatarFallback>
      </Avatar>
    </div>
  ),
}
