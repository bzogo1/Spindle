"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

export type TextareaStatus = "error" | "warning" | "success"
export type TextareaResize = "none" | "vertical" | "horizontal" | "both"

export interface TextareaProps extends Omit<
  React.ComponentProps<"textarea">,
  "maxLength" | "onChange"
> {
  /** Called with the change event (same signature as a native textarea). */
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  /**
   * Character limit. By default this is a soft limit: typing is not blocked and
   * the field only reports the over-limit state. Pass `hardLimit` to also set
   * the native `maxLength` attribute.
   */
  maxLength?: number
  /** When true, `maxLength` is enforced by the browser (input is truncated). */
  hardLimit?: boolean
  /** Show a `current/max` character counter below the field. */
  showCount?: boolean
  /** Grow the field with its content instead of using a fixed height. */
  autoResize?: boolean
  /** Minimum visible rows when `autoResize` is enabled (also used as `rows`). */
  minRows?: number
  /** Maximum visible rows when `autoResize` is enabled; beyond it the field scrolls. */
  maxRows?: number
  /** Manual resize handle. Defaults to "vertical", or "none" when autoResize is on. */
  resize?: TextareaResize
  /** Visual validation state: error / warning / success border + ring colors. */
  status?: TextareaStatus
}

const RESIZE_CLASSES: Record<TextareaResize, string> = {
  none: "resize-none",
  vertical: "resize-y",
  horizontal: "resize-x",
  both: "resize",
}

const STATUS_CLASSES: Record<TextareaStatus, string> = {
  error:
    "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30 dark:focus-visible:ring-destructive/50",
  warning: "border-chart-3 focus-visible:border-chart-3 focus-visible:ring-chart-3/30",
  success: "border-chart-2 focus-visible:border-chart-2 focus-visible:ring-chart-2/30",
}

const FALLBACK_LINE_HEIGHT = 20

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === "function") ref(node)
      else (ref as React.MutableRefObject<T | null>).current = node
    }
  }
}

function Textarea({
  className,
  maxLength,
  hardLimit = false,
  showCount = false,
  autoResize = false,
  minRows,
  maxRows,
  resize,
  status,
  value,
  defaultValue,
  onChange,
  rows,
  id,
  ref,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  ...props
}: TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }) {
  const generatedId = React.useId()
  const fieldId = id ?? `textarea-${generatedId}`
  const countId = `${fieldId}-count`

  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [length, setLength] = React.useState(() => String(value ?? defaultValue ?? "").length)

  // Keep the counter in sync when a controlled `value` changes externally.
  React.useEffect(() => {
    if (value !== undefined) setLength(String(value).length)
  }, [value])

  const resizeField = React.useCallback(() => {
    const el = innerRef.current
    if (!el || !autoResize) return

    el.style.height = "auto"
    const styles = window.getComputedStyle(el)
    const lineHeight = parseFloat(styles.lineHeight) || FALLBACK_LINE_HEIGHT
    const paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
    const borderY =
      (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0)
    const chrome = paddingY + borderY

    const minHeight = minRows != null ? minRows * lineHeight + chrome : undefined
    const maxHeight = maxRows != null ? maxRows * lineHeight + chrome : undefined

    let height = el.scrollHeight
    if (maxHeight != null && height > maxHeight) {
      height = maxHeight
      el.style.overflowY = "auto"
    } else {
      el.style.overflowY = "hidden"
    }
    if (minHeight != null && height < minHeight) height = minHeight
    el.style.height = `${height}px`
  }, [autoResize, minRows, maxRows])

  React.useLayoutEffect(() => {
    resizeField()
  }, [resizeField, length])

  const effectiveResize: TextareaResize = resize ?? (autoResize ? "none" : "vertical")

  const overLimit = maxLength != null && length > maxLength
  const describedBy =
    [ariaDescribedBy, showCount ? countId : null].filter(Boolean).join(" ") || undefined

  return (
    <div className="w-full" data-slot="textarea-wrapper">
      <textarea
        ref={mergeRefs(innerRef, ref)}
        id={fieldId}
        data-slot="textarea"
        rows={rows ?? (autoResize ? undefined : minRows)}
        maxLength={hardLimit ? maxLength : undefined}
        aria-invalid={status === "error" ? true : ariaInvalid}
        aria-describedby={describedBy}
        className={cn(
          "border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground dark:bg-input/30 flex min-h-[80px] w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          RESIZE_CLASSES[effectiveResize],
          status && STATUS_CLASSES[status],
          className,
        )}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          setLength(event.target.value.length)
          // Resize synchronously: identical-length edits may not re-render.
          resizeField()
          onChange?.(event)
        }}
        {...props}
      />
      {showCount ? (
        <p
          id={countId}
          data-slot="textarea-count"
          className={cn(
            "text-muted-foreground mt-1 text-right text-xs",
            overLimit && "text-destructive",
          )}
        >
          {maxLength != null ? `${length}/${maxLength}` : `${length}`}
        </p>
      ) : null}
    </div>
  )
}

export interface TextareaFieldProps extends TextareaProps {
  /** id of the textarea; also used to derive hint/error/count ids. */
  id: string
  label: React.ReactNode
  /** Helper text shown under the field. */
  hint?: React.ReactNode
  /** Error message; forces `status="error"` and `aria-invalid`. */
  error?: React.ReactNode
}

/** Labeled textarea with hint/error text wired via aria-describedby. */
function TextareaField({ id, label, hint, error, status, ...props }: TextareaFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div className="w-full space-y-2" data-slot="textarea-field">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        {...props}
        id={id}
        status={error ? "error" : status}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { Textarea, TextareaField }
