"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"
import { api, useMutation } from "@/lib/api"
import type { AgentRunLogEntry } from "@/lib/api"

import { isActiveRun } from "./agent-run-log-utils"

/**
 * Cancel affordance for an agent run log entry. Renders nothing for runs that
 * are already finished; active runs get a confirm dialog before the cancel
 * mutation fires, matching the destructive-action convention used elsewhere.
 */
export function AgentRunCancelButton({
  run,
  onCancelled,
  label = "Cancel run",
}: {
  run: AgentRunLogEntry
  /** Called after a successful cancel so the parent can refresh its query. */
  onCancelled: () => void
  label?: string
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const cancel = useMutation((id: string) => api.dashboard.cancelAgentRunLogEntry(id))

  if (!isActiveRun(run.status)) return null

  const confirm = async () => {
    try {
      await cancel.mutate(run.id)
      toast({
        title: "Run cancelled",
        description: `“${run.prompt}” was stopped. Completed steps are kept in the trace.`,
      })
      setOpen(false)
      onCancelled()
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not cancel run",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      <button type="button" className="fm-btn fm-btn--danger" onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel agent run</DialogTitle>
            <DialogDescription>
              This stops “{run.prompt}” immediately. Steps still in progress are marked cancelled;
              completed steps stay in the trace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="fm-btn" onClick={() => setOpen(false)}>
              Keep running
            </button>
            <button
              type="button"
              className="fm-btn fm-btn--danger"
              disabled={cancel.isLoading}
              onClick={() => void confirm()}
            >
              {cancel.isLoading ? "Cancelling…" : "Cancel run"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
