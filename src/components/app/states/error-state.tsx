"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { appStateCopy } from "./copy"
import { getErrorReference } from "./error-reference"

function SupportLink({ href, children }: { href: string; children: ReactNode }) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return <a href={href}>{children}</a>
  }
  return <Link href={href}>{children}</Link>
}

export interface ErrorStateProps {
  title?: string
  message?: ReactNode
  error?: unknown
  referenceId?: string
  onRetry?: () => void
  isRetrying?: boolean
  retryLabel?: string
  supportHref?: string
  supportLabel?: string
  className?: string
}

/** Full-panel error presentation with retry and a support reference. */
export function ErrorState({
  title = appStateCopy.error.defaultTitle,
  message = appStateCopy.error.defaultMessage,
  error,
  referenceId,
  onRetry,
  isRetrying = false,
  retryLabel = appStateCopy.error.retry,
  supportHref = appStateCopy.error.supportHref,
  supportLabel = appStateCopy.error.supportLabel,
  className,
}: ErrorStateProps) {
  const reference = referenceId ?? getErrorReference(error)

  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        "border-destructive/30 bg-card/70 flex flex-col items-center justify-center gap-4 rounded-xl border px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="bg-destructive/10 text-destructive grid size-12 place-items-center rounded-full"
      >
        <AlertTriangle className="size-5" />
      </div>
      <div className="grid max-w-md gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="text-muted-foreground text-sm leading-6">{message}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button type="button" onClick={onRetry} disabled={isRetrying} aria-busy={isRetrying}>
            {isRetrying ? appStateCopy.error.retrying : retryLabel}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <SupportLink href={supportHref}>{supportLabel}</SupportLink>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {reference ? (
          <>
            {appStateCopy.error.referenceLabel}{" "}
            <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]">
              {reference}
            </code>
          </>
        ) : (
          appStateCopy.error.noReference
        )}
      </p>
    </div>
  )
}
