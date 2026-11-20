"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { CheckIcon, CircleIcon } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

const radioGroupVariants = cva("group/radio-group", {
  variants: {
    variant: {
      default: "gap-2",
      card: "gap-3",
    },
    orientation: {
      vertical: "grid grid-cols-1",
      horizontal: "flex flex-wrap items-center",
    },
  },
  compoundVariants: [{ variant: "card", orientation: "horizontal", class: "items-stretch" }],
  defaultVariants: {
    variant: "default",
    orientation: "vertical",
  },
})

function RadioGroup({
  className,
  variant = "default",
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> &
  VariantProps<typeof radioGroupVariants>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      data-variant={variant}
      data-orientation={orientation}
      orientation={orientation}
      className={cn(radioGroupVariants({ variant, orientation }), className)}
      {...props}
    />
  )
}

const radioGroupItemVariants = cva(
  "aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 data-[state=checked]:border-primary",
)

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(radioGroupItemVariants(), className)}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon
          className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-current"
          aria-hidden="true"
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

const radioGroupCardVariants = cva(
  "group/radio-card relative flex cursor-pointer flex-col gap-2 rounded-lg border border-input bg-transparent p-4 text-left shadow-xs transition-[color,box-shadow,background-color] outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/20 dark:hover:bg-input/40 dark:aria-invalid:ring-destructive/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 dark:data-[state=checked]:bg-primary/10",
)

function RadioGroupCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-card"
      className={cn(radioGroupCardVariants(), className)}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-card-indicator"
        className="border-input bg-background text-primary group-data-[state=checked]/radio-card:border-primary group-data-[state=checked]/radio-card:bg-primary group-data-[state=checked]/radio-card:text-primary-foreground absolute top-3 right-3 flex size-5 items-center justify-center rounded-full border transition-colors"
      >
        <CheckIcon className="size-3" aria-hidden="true" />
      </RadioGroupPrimitive.Indicator>
      {children}
    </RadioGroupPrimitive.Item>
  )
}

function RadioGroupCardIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="radio-group-card-icon"
      className={cn(
        "border-input bg-background text-muted-foreground group-data-[state=checked]/radio-card:border-primary/50 group-data-[state=checked]/radio-card:text-primary mb-1 flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

function RadioGroupCardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="radio-group-card-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function RadioGroupCardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="radio-group-card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  RadioGroup,
  RadioGroupItem,
  RadioGroupCard,
  RadioGroupCardIcon,
  RadioGroupCardTitle,
  RadioGroupCardDescription,
  radioGroupVariants,
  radioGroupItemVariants,
  radioGroupCardVariants,
}
