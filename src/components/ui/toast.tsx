"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cva } from "class-variance-authority"
import { Toast as ToastPrimitive } from "radix-ui"
import {
  AlertTriangleIcon,
  BellIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type ToastVariant = "default" | "loading" | "success" | "error" | "warning" | "info"
type ToastPosition = "top" | "bottom"
type ToastSwipeDirection = "up" | "down" | "left" | "right"

/**
 * Declarative toast action rendered as a button inside the toast (e.g.
 * "Undo", "View"). Alternatively, `ToastOptions.action` accepts a plain
 * `React.ReactNode` rendered as-is for full custom control.
 */
interface ToastAction {
  /** Button label. */
  label: React.ReactNode
  /** Called when the action button is clicked. */
  onClick?: () => void
  /** Button visual variant. @defaultValue "outline" */
  variant?: React.ComponentProps<typeof Button>["variant"]
  /**
   * Dismiss the toast after `onClick` runs. Set `false` to keep the toast
   * visible (e.g. a non-blocking "View" link).
   * @defaultValue true
   */
  dismissOnAction?: boolean
}

interface ToastOptions {
  /** Toast heading. Falls back to a plain text/message toast when omitted. */
  title?: React.ReactNode
  /** Supporting body copy rendered below the title. */
  description?: React.ReactNode
  variant?: ToastVariant
  /** Auto-dismiss delay in ms. `Infinity` keeps the toast until dismissed. */
  duration?: number
  /**
   * Optional action rendered inside the toast — either a {@link ToastAction}
   * descriptor rendered as a button, or a custom `React.ReactNode`.
   */
  action?: ToastAction | React.ReactNode
  /**
   * When `false` the toast renders no close button and ignores swipe and
   * Escape dismissal. Pair with `duration: Infinity` for a fully sticky toast.
   * @defaultValue true
   */
  dismissible?: boolean
}

type ToastInput = React.ReactNode | string | ToastOptions

interface ToastRecord extends ToastOptions {
  id: number
  /** Bumped on every in-place update so React remounts the toast and restarts its timer. */
  version: number
  /** `false` while the exit animation plays; the record is purged shortly after. */
  open: boolean
}

/**
 * Messages shown by {@link Toast.promise}. Each entry may be a static
 * {@link ToastInput} or a function producing one (success/error receive the
 * settled value / rejection reason).
 */
interface ToastPromiseMessages<T = unknown> {
  loading?: ToastInput | (() => ToastInput)
  success?: ToastInput | ((data: T) => ToastInput)
  error?: ToastInput | ((error: unknown) => ToastInput)
}

interface Toast {
  /** Show a toast. Returns its id for later dismissal. */
  (input: ToastInput, options?: ToastOptions): number
  success(input: ToastInput, options?: ToastOptions): number
  error(input: ToastInput, options?: ToastOptions): number
  info(input: ToastInput, options?: ToastOptions): number
  warning(input: ToastInput, options?: ToastOptions): number
  loading(input: ToastInput, options?: ToastOptions): number
  /**
   * Show a loading toast, then swap it in place for a success/error toast
   * when the promise settles. Returns the original promise so callers can
   * keep awaiting it (and handle rejections) as usual.
   */
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    messages?: ToastPromiseMessages<T>,
  ): Promise<T>
  /** Dismiss a toast by id, or all toasts when omitted. */
  dismiss(id?: number): void
}

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 pr-10 text-sm shadow-lg transition-all data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-out data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        loading: "border-border bg-card text-card-foreground",
        success:
          "border-emerald-500/40 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-50",
        error:
          "border-destructive/40 bg-card text-card-foreground [&_[data-slot=toast-icon]]:text-destructive",
        warning:
          "border-amber-500/40 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-50",
        info: "border-sky-500/40 bg-sky-50 text-sky-950 dark:border-sky-400/30 dark:bg-sky-950 dark:text-sky-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

const toastIcons: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  default: BellIcon,
  loading: Loader2Icon,
  success: CheckCircle2Icon,
  error: XCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
}

/** Delay before a closed toast record is removed from the store (covers the exit animation). */
const TOAST_EXIT_MS = 250

let nextToastId = 0
let toasts: ToastRecord[] = []
const listeners = new Set<() => void>()

const EMPTY_TOASTS: ToastRecord[] = []

function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return toasts
}

function getServerSnapshot() {
  return EMPTY_TOASTS
}

/**
 * Mount gate for the toast portal. Portals are hydrated by React 19, so the
 * portal must not render during hydration — the server emits `null` and the
 * client's first (hydrating) render must match it. `useSyncExternalStore`
 * gives exactly that: `false` for SSR/hydration, `true` on the first
 * post-hydration client render.
 */
function subscribeToMount() {
  return () => {}
}

function getMountedSnapshot() {
  return true
}

function getServerMountedSnapshot() {
  return false
}

/** Distinguish a declarative {@link ToastAction} from a raw ReactNode action. */
function isToastAction(action: ToastOptions["action"]): action is ToastAction {
  return (
    typeof action === "object" &&
    action !== null &&
    !React.isValidElement(action) &&
    !Array.isArray(action) &&
    "label" in action
  )
}

function normalizeToastInput(input: ToastInput): ToastOptions {
  if (input === null || input === undefined) return {}
  if (typeof input === "string" || React.isValidElement(input)) {
    return { title: input }
  }
  // Plain objects are treated as ToastOptions — this also covers options
  // objects that only set `description`/`variant`/etc. without a `title`.
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as ToastOptions
  }
  return { title: input as React.ReactNode }
}

/** Merge option bags, ignoring `undefined` values so explicit defaults win. */
function mergeOptions(base: ToastOptions, extra?: ToastOptions): ToastOptions {
  const merged: ToastOptions = { ...base }
  if (extra) {
    for (const key of Object.keys(extra) as (keyof ToastOptions)[]) {
      const value = extra[key]
      if (value !== undefined) {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

function addToast(input: ToastInput, options?: ToastOptions): number {
  const record: ToastRecord = {
    open: true,
    version: 0,
    ...mergeOptions(normalizeToastInput(input), options),
    id: ++nextToastId,
  }
  toasts = [...toasts, record]
  emitChange()
  return record.id
}

/**
 * Update a toast in place (same id). The version bump remounts the toast so
 * Radix restarts its auto-dismiss timer, and an omitted `duration` resets to
 * the Toaster default — important when a `loading` toast (duration Infinity)
 * settles into a success/error toast.
 */
function updateToast(id: number, input: ToastInput) {
  const patch = normalizeToastInput(input)
  let changed = false
  toasts = toasts.map((toast) => {
    if (toast.id !== id) return toast
    changed = true
    const { duration: _duration, ...rest } = toast
    return { ...rest, ...patch, version: toast.version + 1 }
  })
  if (changed) emitChange()
}

function purgeToast(id: number) {
  const record = toasts.find((toast) => toast.id === id)
  if (!record || record.open) return
  toasts = toasts.filter((toast) => toast.id !== id)
  emitChange()
}

function dismissToast(id?: number) {
  const closing = toasts.filter((toast) => id === undefined || toast.id === id)
  if (closing.length === 0) return
  toasts = toasts.map((toast) =>
    id === undefined || toast.id === id ? { ...toast, open: false } : toast,
  )
  emitChange()
  // Keep the record around so Radix can play the exit animation, then purge it.
  if (typeof window !== "undefined") {
    for (const toast of closing) {
      window.setTimeout(() => purgeToast(toast.id), TOAST_EXIT_MS)
    }
  }
}

function resolveMessage<T>(
  message: ToastInput | ((arg: T) => ToastInput) | undefined,
  arg: T,
): ToastInput {
  if (typeof message === "function") {
    return (message as (arg: T) => ToastInput)(arg)
  }
  return message ?? {}
}

function promiseToast<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
  messages: ToastPromiseMessages<T> = {},
): Promise<T> {
  let promise: Promise<T>
  try {
    promise = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn
  } catch (error) {
    promise = Promise.reject(error)
  }

  // The loading toast stays until the promise settles unless the caller
  // overrides `duration` in the loading message.
  const loading = mergeOptions(
    { variant: "loading" as ToastVariant, duration: Infinity },
    normalizeToastInput(resolveMessage(messages.loading, undefined as T)),
  )
  const id = addToast(loading)

  promise.then(
    (data) => {
      const success = { ...normalizeToastInput(resolveMessage(messages.success, data)) }
      if (success.variant === undefined) success.variant = "success"
      updateToast(id, success)
    },
    (error) => {
      const failure = { ...normalizeToastInput(resolveMessage(messages.error, error)) }
      if (failure.variant === undefined) failure.variant = "error"
      updateToast(id, failure)
    },
  )

  return promise
}

function variantToast(variant: ToastVariant) {
  return (input: ToastInput, options?: ToastOptions) => {
    const opts = mergeOptions(normalizeToastInput(input), options)
    if (opts.variant === undefined) opts.variant = variant
    return addToast(opts)
  }
}

const toast: Toast = Object.assign(
  (input: ToastInput, options?: ToastOptions) => addToast(input, options),
  {
    success: variantToast("success"),
    error: variantToast("error"),
    info: variantToast("info"),
    warning: variantToast("warning"),
    loading: variantToast("loading"),
    promise: promiseToast,
    dismiss: dismissToast,
  },
)

function useToast() {
  const items = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return { toast, dismiss: dismissToast, toasts: items }
}

interface ToasterProps extends React.ComponentProps<typeof ToastPrimitive.Viewport> {
  /** Default auto-dismiss delay in ms. Individual toasts can override it. */
  duration?: number
  /** Which screen edge the toast stack is anchored to. @defaultValue "bottom" */
  position?: ToastPosition
  /** Maximum number of toasts visible at once; newer toasts queue until a slot frees. */
  maxToasts?: number
  /** Pointer swipe direction that dismisses a toast. @defaultValue "right" */
  swipeDirection?: ToastSwipeDirection
  /** Swipe distance in px required to dismiss. */
  swipeThreshold?: number
}

function Toaster({
  duration = 5000,
  position = "bottom",
  maxToasts,
  swipeDirection = "right",
  swipeThreshold,
  className,
  ...props
}: ToasterProps) {
  const items = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const isMounted = React.useSyncExternalStore(
    subscribeToMount,
    getMountedSnapshot,
    getServerMountedSnapshot,
  )

  if (!isMounted || typeof document === "undefined") return null

  const visibleItems = maxToasts === undefined ? items : items.slice(0, maxToasts)

  return createPortal(
    <ToastPrimitive.Provider
      label="Notifications"
      swipeDirection={swipeDirection}
      swipeThreshold={swipeThreshold}
      duration={duration}
    >
      {visibleItems.map((item) => {
        const variant = item.variant ?? "default"
        const Icon = toastIcons[variant]
        const dismissible = item.dismissible !== false
        const action = item.action

        return (
          <ToastPrimitive.Root
            key={`${item.id}:${item.version}`}
            open={item.open}
            duration={item.duration ?? duration}
            type={variant === "error" ? "foreground" : "background"}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id)
            }}
            onEscapeKeyDown={dismissible ? undefined : (event) => event.preventDefault()}
            onSwipeEnd={
              dismissible
                ? undefined
                : (event) => {
                    // Non-dismissible toast: veto Radix's close and snap the
                    // toast back instead of playing the swipe-out animation.
                    event.preventDefault()
                    const el = event.currentTarget as HTMLElement
                    el.setAttribute("data-swipe", "cancel")
                    el.style.removeProperty("--radix-toast-swipe-move-x")
                    el.style.removeProperty("--radix-toast-swipe-move-y")
                  }
            }
            role={variant === "error" ? "alert" : "status"}
            aria-live={variant === "error" ? "assertive" : "polite"}
            data-slot="toast"
            className={cn(
              toastVariants({ variant }),
              position === "top"
                ? "data-[state=open]:slide-in-from-top-full"
                : "data-[state=open]:slide-in-from-bottom-full",
            )}
          >
            <Icon
              data-slot="toast-icon"
              className={cn("mt-0.5 size-4 shrink-0", variant === "loading" && "animate-spin")}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {item.title ? (
                <ToastPrimitive.Title
                  data-slot="toast-title"
                  className="font-medium tracking-tight"
                >
                  {item.title}
                </ToastPrimitive.Title>
              ) : null}
              {item.description ? (
                <ToastPrimitive.Description
                  data-slot="toast-description"
                  className="text-muted-foreground"
                >
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            {isToastAction(action) ? (
              <Button
                type="button"
                data-slot="toast-action"
                variant={action.variant ?? "outline"}
                size="xs"
                className="mt-1 self-start"
                onClick={() => {
                  action.onClick?.()
                  if (action.dismissOnAction !== false) {
                    dismissToast(item.id)
                  }
                }}
              >
                {action.label}
              </Button>
            ) : (
              action
            )}
            {dismissible ? (
              <ToastPrimitive.Close
                data-slot="toast-close"
                aria-label="Dismiss"
                className="focus:ring-ring absolute top-2 right-2 rounded-xs p-1 opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 focus:ring-2 focus:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              >
                <XIcon aria-hidden="true" />
              </ToastPrimitive.Close>
            ) : null}
          </ToastPrimitive.Root>
        )
      })}
      <ToastPrimitive.Viewport
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-4 bottom-4 z-50 flex w-auto max-w-sm flex-col gap-2 outline-none sm:inset-x-auto sm:right-4 sm:w-full",
          position === "top" && "top-4 bottom-auto",
          className,
        )}
        {...props}
      />
    </ToastPrimitive.Provider>,
    document.body,
  )
}

export { Toaster, toast, useToast }
export type {
  Toast,
  ToastAction,
  ToastOptions,
  ToastPosition,
  ToastPromiseMessages,
  ToastSwipeDirection,
  ToastVariant,
}
