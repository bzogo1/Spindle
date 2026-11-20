"use client"

import Link from "next/link"
import { useId, type ReactNode } from "react"
import { Inbox } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { appStateCopy } from "./copy"

export interface StateAction {
  label: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  variant?: "default" | "secondary" | "outline" | "ghost"
  icon?: ReactNode
}

type ActionSlot = StateAction | ReactNode

function isStateAction(action: ActionSlot): action is StateAction {
  return (
    typeof action === "object" &&
    action !== null &&
    "label" in action &&
    typeof (action as StateAction).label === "string"
  )
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return <a href={href}>{children}</a>
  }
  return <Link href={href}>{children}</Link>
}

function renderAction(action: ActionSlot, key: string) {
  if (!isStateAction(action)) return <span key={key}>{action}</span>

  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  )

  if (action.href) {
    return (
      <Button key={key} asChild variant={action.variant ?? "default"} disabled={action.disabled}>
        <ActionLink href={action.href}>{content}</ActionLink>
      </Button>
    )
  }

  return (
    <Button
      key={key}
      type="button"
      variant={action.variant ?? "default"}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {content}
    </Button>
  )
}

export interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  body?: ReactNode
  primaryAction?: ActionSlot
  secondaryAction?: ActionSlot
  className?: string
}

/** Consistent zero-data presentation for lists, panes, and screens. */
export function EmptyState({
  icon,
  title = appStateCopy.empty.defaultTitle,
  body = appStateCopy.empty.defaultBody,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const titleId = useId()
  const bodyId = useId()

  return (
    <section
      data-slot="empty-state"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      className={cn(
        "bg-card/60 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="bg-muted text-muted-foreground grid size-12 place-items-center rounded-full"
      >
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div className="grid max-w-md gap-2">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {body ? (
          <div id={bodyId} className="text-muted-foreground text-sm leading-6">
            {body}
          </div>
        ) : null}
      </div>
      {primaryAction || secondaryAction ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? renderAction(primaryAction, "primary") : null}
          {secondaryAction ? renderAction(secondaryAction, "secondary") : null}
        </div>
      ) : null}
    </section>
  )
}
