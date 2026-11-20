import { BellOff, Bot, Files, FolderKanban, SearchX } from "lucide-react"

import { appScreenCopy } from "@/components/app/states/copy"

import { EmptyState, type EmptyStateProps } from "./empty-state"

export type EmptyStateVariantProps = Partial<EmptyStateProps>

function mergeVariant(
  defaults: EmptyStateProps,
  overrides: EmptyStateVariantProps,
): EmptyStateProps {
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as EmptyStateProps
}

/** Empty state for a workspace or project list with no projects. */
export function NoProjectsEmptyState(props: EmptyStateVariantProps) {
  return (
    <EmptyState
      {...mergeVariant(
        {
          icon: <FolderKanban aria-hidden="true" />,
          title: appScreenCopy.dashboard.emptyTitle,
          description: appScreenCopy.dashboard.emptyBody,
        },
        props,
      )}
    />
  )
}

/** Empty state for a file library or file table with no files. */
export function NoFilesEmptyState(props: EmptyStateVariantProps) {
  return (
    <EmptyState
      {...mergeVariant(
        {
          icon: <Files aria-hidden="true" />,
          title: appScreenCopy.files.emptyTitle,
          description: appScreenCopy.files.emptyBody,
        },
        props,
      )}
    />
  )
}

/** Empty state for an agent or lab run list with no runs. */
export function NoRunsEmptyState(props: EmptyStateVariantProps) {
  return (
    <EmptyState
      {...mergeVariant(
        {
          icon: <Bot aria-hidden="true" />,
          title: appScreenCopy.agent.emptyTitle,
          description: appScreenCopy.agent.emptyBody,
        },
        props,
      )}
    />
  )
}

/** Empty state for a notification inbox with nothing unread or recent. */
export function NoNotificationsEmptyState(props: EmptyStateVariantProps) {
  return (
    <EmptyState
      {...mergeVariant(
        {
          icon: <BellOff aria-hidden="true" />,
          title: "No notifications yet",
          description: "When something needs your attention, it will show up here.",
        },
        props,
      )}
    />
  )
}

/** Empty state for a search or filter that matched nothing. */
export function SearchNoResultsEmptyState({
  query,
  ...props
}: EmptyStateVariantProps & { query?: string }) {
  return (
    <EmptyState
      {...mergeVariant(
        {
          icon: <SearchX aria-hidden="true" />,
          title: "No results",
          description: query
            ? `Nothing matches “${query}”. Try a different search.`
            : "Try a different search.",
        },
        props,
      )}
    />
  )
}
