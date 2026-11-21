"use client"

import { useMemo } from "react"
import { FlaskConical } from "lucide-react"

import { AutomationBuilder } from "@/components/automation-builder"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  graphForAutomation,
  type DebuggableAutomation,
} from "./automation-debug-dialog"

/**
 * "Automation test" sandbox: opens the node-graph builder seeded from the
 * automation's steps (same graph reconstruction the Debug dialog uses) so it
 * can be exercised with the Dry run panel — completely isolated from the
 * saved automation.
 */
export function AutomationTestDialog({
  automation,
  open,
  onOpenChange,
}: {
  automation: DebuggableAutomation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const graph = useMemo(() => (automation ? graphForAutomation(automation) : null), [automation])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-automation-dialog flex h-[85vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <FlaskConical aria-hidden="true" className="size-4" />
              Test — {automation?.name ?? "automation"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Sandboxed preview: the graph below is rebuilt from this automation&apos;s steps. Use
            the Dry run panel to simulate it — editing or running here never changes the saved
            automation.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {graph ? (
            <AutomationBuilder
              key={`${automation?.id}:${open}`}
              defaultGraph={graph}
              historyScope={`automation-test:${automation?.id ?? "draft"}`}
              className="h-full"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
