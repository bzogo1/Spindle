import type { ReactNode } from "react"

import { EmptyState as AppEmptyState, type StateAction } from "@/components/app/states/empty-state"
import { appStateCopy } from "@/components/app/states/copy"

export type EmptyStateAction = StateAction | ReactNode

export interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  description?: ReactNode
  primaryAction?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  className?: string
}

/** Shared empty-state building block for dashboard lists, tables, and panes. */
export function EmptyState({
  icon,
  title = appStateCopy.empty.defaultTitle,
  description = appStateCopy.empty.defaultBody,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <AppEmptyState
      icon={icon}
      title={title}
      body={description}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
      className={className}
    />
  )
}
