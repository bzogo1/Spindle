import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Globe, Lock, Mail } from "lucide-react"

import {
  RadioGroup,
  RadioGroupCard,
  RadioGroupCardDescription,
  RadioGroupCardIcon,
  RadioGroupCardTitle,
  RadioGroupItem,
} from "./radio-group"
import { Label } from "./label"

const meta = {
  title: "UI/RadioGroup",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const plans = [
  { value: "free", label: "Free", hint: "For personal projects" },
  { value: "pro", label: "Pro", hint: "For teams up to 10" },
  { value: "enterprise", label: "Enterprise", hint: "Unlimited seats" },
]

export const Vertical: Story = {
  render: function VerticalStory() {
    const [value, setValue] = useState("pro")
    return (
      <RadioGroup value={value} onValueChange={setValue} aria-label="Plan" className="max-w-xs">
        {plans.map((plan) => (
          <div key={plan.value} className="flex items-center gap-2">
            <RadioGroupItem value={plan.value} id={`plan-${plan.value}`} />
            <Label htmlFor={`plan-${plan.value}`} className="font-normal">
              {plan.label}
              <span className="text-muted-foreground ml-2 text-xs">{plan.hint}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    )
  },
}

export const Horizontal: Story = {
  render: function HorizontalStory() {
    const [value, setValue] = useState("daily")
    return (
      <RadioGroup
        value={value}
        onValueChange={setValue}
        orientation="horizontal"
        aria-label="Digest frequency"
      >
        {[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "never", label: "Never" },
        ].map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem value={option.value} id={`freq-${option.value}`} />
            <Label htmlFor={`freq-${option.value}`} className="font-normal">
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    )
  },
}

export const Cards: Story = {
  render: function CardsStory() {
    const [value, setValue] = useState("team")
    const options = [
      { value: "personal", title: "Personal", description: "Just you", icon: Mail },
      { value: "team", title: "Team", description: "Up to 10 members", icon: Globe },
      { value: "org", title: "Organization", description: "SSO and audit logs", icon: Lock },
    ]
    return (
      <RadioGroup
        value={value}
        onValueChange={setValue}
        variant="card"
        orientation="horizontal"
        aria-label="Workspace type"
        className="max-w-2xl"
      >
        {options.map((option) => (
          <RadioGroupCard key={option.value} value={option.value} className="flex-1">
            <RadioGroupCardIcon>
              <option.icon aria-hidden="true" />
            </RadioGroupCardIcon>
            <RadioGroupCardTitle>{option.title}</RadioGroupCardTitle>
            <RadioGroupCardDescription>{option.description}</RadioGroupCardDescription>
          </RadioGroupCard>
        ))}
      </RadioGroup>
    )
  },
}
