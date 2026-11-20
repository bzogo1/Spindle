"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * Convenience positioning prop: a side ("top" | "right" | "bottom" | "left")
 * optionally suffixed with "-start" or "-end" to control alignment.
 * Explicit `side`/`align` props take precedence when both are provided.
 */
export type TooltipPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "right"
  | "right-start"
  | "right-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"

type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>

const PLACEMENT_MAP: Record<TooltipPlacement, Pick<TooltipContentProps, "side" | "align">> = {
  top: { side: "top" },
  "top-start": { side: "top", align: "start" },
  "top-end": { side: "top", align: "end" },
  right: { side: "right" },
  "right-start": { side: "right", align: "start" },
  "right-end": { side: "right", align: "end" },
  bottom: { side: "bottom" },
  "bottom-start": { side: "bottom", align: "start" },
  "bottom-end": { side: "bottom", align: "end" },
  left: { side: "left" },
  "left-start": { side: "left", align: "start" },
  "left-end": { side: "left", align: "end" },
}

function TooltipContent({
  className,
  sideOffset = 0,
  placement,
  side,
  align,
  children,
  ...props
}: TooltipContentProps & {
  placement?: TooltipPlacement
}) {
  const placementConfig = placement ? PLACEMENT_MAP[placement] : undefined
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        side={side ?? placementConfig?.side}
        align={align ?? placementConfig?.align}
        sideOffset={sideOffset}
        collisionPadding={8}
        avoidCollisions
        className={cn(
          "animate-in bg-foreground text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
