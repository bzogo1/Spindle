"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slider as SliderPrimitive } from "radix-ui"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const sliderVariants = cva(
  "group/slider relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
  {
    variants: {
      marks: {
        true: "pb-6 data-[orientation=vertical]:pr-20 data-[orientation=vertical]:pb-0",
        false: "",
      },
    },
    defaultVariants: {
      marks: false,
    },
  },
)

const sliderTrackVariants = cva("relative grow overflow-hidden rounded-full bg-muted", {
  variants: {
    size: {
      sm: "h-1",
      default: "h-1.5",
      lg: "h-2",
    },
    orientation: {
      horizontal: "",
      vertical: "h-full w-1.5",
    },
  },
  defaultVariants: {
    size: "default",
    orientation: "horizontal",
  },
})

const sliderThumbVariants = cva(
  "block shrink-0 rounded-full border border-border bg-background shadow-sm transition-[color,box-shadow] hover:border-ring/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  {
    variants: {
      size: {
        sm: "size-3",
        default: "size-4",
        lg: "size-5",
      },
      orientation: {
        horizontal: "",
        vertical: "",
      },
    },
    defaultVariants: {
      size: "default",
      orientation: "horizontal",
    },
  },
)

export type SliderMark = number | { value: number; label?: React.ReactNode }

export type SliderValue = number | number[]

export interface SliderProps extends Omit<
  React.ComponentProps<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "onValueCommit"
> {
  size?: NonNullable<VariantProps<typeof sliderTrackVariants>["size"]>
  /** Single number for one thumb, array for a range. */
  value?: SliderValue
  defaultValue?: SliderValue
  /** Receives a number for single mode, number[] for range mode. */
  onValueChange?: (value: SliderValue) => void
  onValueCommit?: (value: SliderValue) => void
  /** Show the current value in a tooltip while dragging or focused. */
  showTooltip?: boolean
  /** Custom tooltip/aria-valuetext formatting. */
  formatValue?: (value: number, index: number) => React.ReactNode
  /** Tick marks (and optional labels) at absolute values. */
  marks?: SliderMark[]
}

function toArray(value: SliderValue | undefined): number[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

function Slider({
  className,
  size = "default",
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  showTooltip = false,
  formatValue,
  marks,
  min = 0,
  max = 100,
  disabled,
  ...props
}: SliderProps) {
  const isRange = Array.isArray(value ?? defaultValue)
  const isControlled = value !== undefined

  const [internalValues, setInternalValues] = React.useState<number[]>(
    () => toArray(defaultValue) ?? [min],
  )
  const values = isControlled ? (toArray(value) ?? []) : internalValues

  // Index of the thumb currently being dragged or focused, used to drive the
  // optional value tooltip.
  const [activeThumb, setActiveThumb] = React.useState<number | null>(null)
  const releaseThumb = React.useCallback((index: number) => {
    setActiveThumb((current) => (current === index ? null : current))
  }, [])

  const handleValueChange = React.useCallback(
    (next: number[]) => {
      if (!isControlled) setInternalValues(next)
      onValueChange?.(isRange ? next : next[0])
    },
    [isControlled, isRange, onValueChange],
  )

  const handleValueCommit = React.useCallback(
    (next: number[]) => {
      onValueCommit?.(isRange ? next : next[0])
    },
    [isRange, onValueCommit],
  )

  const normalizedMarks = React.useMemo(
    () => (marks ?? []).map((mark) => (typeof mark === "number" ? { value: mark } : mark)),
    [marks],
  )
  const span = max - min || 1
  const format = React.useCallback(
    (index: number) => {
      const v = values[index] ?? min
      return formatValue ? formatValue(v, index) : String(v)
    },
    [values, min, formatValue],
  )

  const thumbs = values.map((_, index) => {
    const thumbText = format(index)
    const thumb = (
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        data-size={size}
        aria-label={isRange ? `Value ${index + 1}` : "Value"}
        aria-valuetext={typeof thumbText === "string" ? thumbText : undefined}
        className={cn(sliderThumbVariants({ size, orientation }), "absolute")}
        onPointerDown={() => setActiveThumb(index)}
        onPointerUp={() => releaseThumb(index)}
        onPointerCancel={() => releaseThumb(index)}
        onFocus={() => setActiveThumb(index)}
        onBlur={() => releaseThumb(index)}
      />
    )

    if (!showTooltip) return <React.Fragment key={index}>{thumb}</React.Fragment>

    return (
      <Tooltip
        key={index}
        open={activeThumb === index}
        onOpenChange={(open) => {
          if (open) setActiveThumb(index)
          else releaseThumb(index)
        }}
      >
        <TooltipTrigger asChild>{thumb}</TooltipTrigger>
        <TooltipContent>{thumbText}</TooltipContent>
      </Tooltip>
    )
  })

  const slider = (
    <SliderPrimitive.Root
      data-slot="slider"
      data-size={size}
      data-orientation={orientation}
      className={cn(sliderVariants({ marks: normalizedMarks.length > 0 }), className)}
      value={isControlled ? toArray(value) : undefined}
      defaultValue={isControlled ? undefined : (toArray(defaultValue) ?? [min])}
      onValueChange={handleValueChange}
      onValueCommit={handleValueCommit}
      min={min}
      max={max}
      orientation={orientation}
      disabled={disabled}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(sliderTrackVariants({ size, orientation }))}
      >
        <SliderPrimitive.Range data-slot="slider-range" className="bg-primary absolute" />
      </SliderPrimitive.Track>

      {normalizedMarks.length > 0 && (
        <div
          data-slot="slider-marks"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          {normalizedMarks.map((mark, index) => {
            const pct = Math.min(100, Math.max(0, ((mark.value - min) / span) * 100))
            const position =
              orientation === "vertical" ? { bottom: `${pct}%` } : { insetInlineStart: `${pct}%` }
            return (
              <span
                key={index}
                className={cn(
                  "absolute flex",
                  orientation === "vertical"
                    ? "left-1/2 -translate-x-1/2 -translate-y-1/2 items-center"
                    : "top-1/2 -translate-x-1/2 -translate-y-1/2 flex-col items-center",
                )}
                style={position}
              >
                <span
                  className={cn(
                    "bg-border",
                    orientation === "vertical" ? "h-px w-1.5" : "h-1.5 w-px",
                  )}
                />
                {mark.label != null && (
                  <span
                    className={cn(
                      "text-muted-foreground text-[10px] leading-none whitespace-nowrap",
                      orientation === "vertical" ? "ml-1.5" : "mt-1",
                    )}
                  >
                    {mark.label}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )}

      {thumbs}
    </SliderPrimitive.Root>
  )

  if (!showTooltip) return slider

  return <TooltipProvider delayDuration={0}>{slider}</TooltipProvider>
}

export { Slider, sliderVariants }
