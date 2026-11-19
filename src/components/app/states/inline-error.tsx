"use client"

import { AlertTriangle } from "lucide-react"
import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

import { appStateCopy } from "./copy"
import { getErrorReference } from "./error-reference"

export interface InlineErrorProps {
  message?: ReactNode
  title?: string
  error?: unknown
  referenceId?: string
  id?: string
  className?: string
}

/** Compact form/action error that stays next to the control it describes. */
export function InlineError({
  message = appStateCopy.inlineError.defaultMessage,
  title = appStateCopy.inlineError.defaultTitle,
  error,
  referenceId,
  id,
  className,
}: InlineErrorProps) {
  const reference = referenceId ?? getErrorReference(error)

  return (
    <Alert variant="destructive" id={id} className={cn("text-left", className)}>
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <div>{message}</div>
        {reference ? (
          <div className="text-xs">
            {appStateCopy.inlineError.referenceLabel} <code className="font-mono">{reference}</code>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
