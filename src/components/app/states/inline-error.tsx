"use client"

import { AlertTriangle } from "lucide-react"
import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

import { appStateCopy } from "./copy"
import { getErrorReference } from "./error-reference"

export interface InlineErrorProps {
  message?: ReactNode
  /** Pass null to render the message without a heading (e.g. field errors). */
  title?: string | null
  error?: unknown
  referenceId?: string
  id?: string
  className?: string
  /** Optional action (e.g. a retry button) rendered under the message. */
  action?: ReactNode
}

/** Compact form/action error that stays next to the control it describes. */
export function InlineError({
  message = appStateCopy.inlineError.defaultMessage,
  title = appStateCopy.inlineError.defaultTitle,
  error,
  referenceId,
  id,
  className,
  action,
}: InlineErrorProps) {
  const reference = referenceId ?? getErrorReference(error)

  return (
    <Alert variant="destructive" id={id} className={cn("text-left", className)}>
      <AlertTriangle aria-hidden="true" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>
        <div>{message}</div>
        {reference ? (
          <div className="text-xs">
            {appStateCopy.inlineError.referenceLabel} <code className="font-mono">{reference}</code>
          </div>
        ) : null}
        {action ? <div>{action}</div> : null}
      </AlertDescription>
    </Alert>
  )
}
