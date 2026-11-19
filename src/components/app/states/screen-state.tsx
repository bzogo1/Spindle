import { appScreenCopy, type AppScreenKey } from "./copy"
import { LoadingPanel } from "./loading-panel"
import { QueryState, type QueryStateProps } from "./query-state"
import { ScreenSkeleton } from "./skeleton"

export type ScreenStateProps<T> = QueryStateProps<T> & {
  screen: AppScreenKey
}

/** QueryState preconfigured with the copy and skeleton for an app screen. */
export function ScreenState<T>({
  screen,
  loading,
  emptyTitle,
  emptyBody,
  errorTitle,
  errorMessage,
  ...props
}: ScreenStateProps<T>) {
  const copy = appScreenCopy[screen]

  return (
    <QueryState<T>
      {...props}
      loading={
        loading ?? (
          <LoadingPanel label={copy.loadingLabel} className="min-h-48">
            <ScreenSkeleton variant={copy.skeleton} />
          </LoadingPanel>
        )
      }
      emptyTitle={emptyTitle ?? copy.emptyTitle}
      emptyBody={emptyBody ?? copy.emptyBody}
      errorTitle={errorTitle ?? copy.errorTitle}
      errorMessage={errorMessage ?? copy.errorMessage}
    />
  )
}
