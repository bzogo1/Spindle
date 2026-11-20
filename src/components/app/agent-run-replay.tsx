"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RotateCcw } from "lucide-react"

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
 * Replay affordance for an agent run log entry. Starts a fresh run with the
 * recorded prompt through the project-scoped agent API, then navigates to the
 * project's agent page where the live trace plays out.
 *
 * Run log entries do not record the model/scope configuration a run used, so
 * the replay runs with the project's saved agent configuration — the dialog
 * says so before the mutation fires. Active runs get no replay action: there
 * is nothing settled to re-run yet.
 */
export function AgentRunReplayButton({
  run,
  label = "Replay run",
}: {
  run: AgentRunLogEntry
  label?: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const replay = useMutation((projectId: string, prompt: string) =>
    api.workspace.startAgentRun(projectId, prompt),
  )

  if (isActiveRun(run.status)) return null

  const confirm = async () => {
    try {
      await replay.mutate(run.projectId, run.prompt)
      toast({
        title: "Run replayed",
        description: `Started a new run for “${run.prompt}” on ${run.projectName}.`,
      })
      setOpen(false)
      router.push(`/projects/${run.projectId}/agent`)
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not replay run",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      <button type="button" className="fm-btn" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" className="size-3.5" /> {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replay agent run</DialogTitle>
            <DialogDescription>
              This starts a new run with the prompt “{run.prompt}” on {run.projectName}. The run log
              does not record the original model or scope, so the replay uses the project’s saved
              agent configuration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="fm-btn" onClick={() => setOpen(false)}>
              Keep it settled
            </button>
            <button
              type="button"
              className="fm-btn fm-btn--solid"
              disabled={replay.isLoading}
              onClick={() => void confirm()}
            >
              {replay.isLoading ? "Starting…" : "Replay run"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
