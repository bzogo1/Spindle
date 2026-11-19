import type { ReactNode } from "react"

import { appStateCopy } from "./copy"
import { EmptyState, type EmptyStateProps } from "./empty-state"
import { ErrorState } from "./error-state"
import { LoadingPanel } from "./loading-panel"

export type QueryStatus = "loading" | "error" | "success"

export interface QueryStateProps<T> {
  status: QueryStatus
  data?: T
  error?: unknown
  isEmpty?: boolean
  isRetrying?: boolean
  onRetry?: () => void
  className?: string

  loading?: ReactNode
  empty?: ReactNode
  errorState?: ReactNode

  emptyTitle?: string
  emptyBody?: ReactNode
  emptyIcon?: ReactNode
  primaryAction?: EmptyStateProps["primaryAction"]
  secondaryAction?: EmptyStateProps["secondaryAction"]

  errorTitle?: string
  errorMessage?: ReactNode
  errorRetryLabel?: string
  errorSupportHref?: string
  errorSupportLabel?: string

  children: ReactNode | ((data: T) => ReactNode)
}

/** Renders loading, empty, error, or success for a data-backed screen section. */
export function QueryState<T>({
  status,
  data,
  error,
  isEmpty = false,
  isRetrying = false,
  onRetry,
  className,
  loading,
  empty,
  errorState,
  emptyTitle,
  emptyBody,
  emptyIcon,
  primaryAction,
  secondaryAction,
  errorTitle,
  errorMessage,
  errorRetryLabel,
  errorSupportHref,
  errorSupportLabel,
  children,
}: QueryStateProps<T>) {
  if (status === "loading") {
    return <>{loading ?? <LoadingPanel label={appStateCopy.loading.default} />}</>
  }

  if (status === "error") {
    if (errorState) return <>{errorState}</>
    return (
      <ErrorState
        title={errorTitle}
        message={errorMessage}
        error={error}
        onRetry={onRetry}
        isRetrying={isRetrying}
        retryLabel={errorRetryLabel}
        supportHref={errorSupportHref}
        supportLabel={errorSupportLabel}
        className={className}
      />
    )
  }

  if (isEmpty) {
    if (empty) return <>{empty}</>
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        body={emptyBody}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        className={className}
      />
    )
  }

  return <>{typeof children === "function" ? children(data as T) : children}</>
}
