"use client"

import { useState } from "react"
import { History, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"

/**
 * Mock revision entry for the page history dialog. Mirrors the shape used by
 * the automation-builder version-history panel (id, label, timestamp) without
 * pulling in graph-specific diffing.
 */
interface PageRevision {
  id: string
  label: string
  author: string
  createdAt: string
}

function mockRevisions(section: string): PageRevision[] {
  const now = Date.now()
  const hour = 60 * 60 * 1000
  return [
    {
      id: `${section}-r3`,
      label: "Latest layout",
      author: "You",
      createdAt: new Date(now - 2 * hour).toISOString(),
    },
    {
      id: `${section}-r2`,
      label: "Weekly snapshot",
      author: "System",
      createdAt: new Date(now - 26 * hour).toISOString(),
    },
    {
      id: `${section}-r1`,
      label: "Initial revision",
      author: "System",
      createdAt: new Date(now - 7 * 24 * hour).toISOString(),
    },
  ]
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

/**
 * "Page history" dialog listing revision history for the current page.
 * Mock data — restore is a no-op toast until page versioning exists.
 */
export function PageHistoryDialog({
  open,
  onOpenChange,
  section,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: string
}) {
  const { toast } = useToast()
  // Revisions regenerate per open so timestamps stay fresh.
  const [revisions] = useState(() => mockRevisions(section))

  function handleRestore(revision: PageRevision) {
    toast({
      variant: "info",
      title: `Restored “${revision.label}” (preview).`,
      description: "Page versioning is not wired up yet — this is a mock restore.",
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            {section} history
          </DialogTitle>
          <DialogDescription>
            Recent revisions of this page. Restore rolls the page back to a snapshot.
          </DialogDescription>
        </DialogHeader>

        {revisions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No revisions recorded yet.</p>
        ) : (
          <ul className="grid max-h-80 gap-2 overflow-y-auto">
            {revisions.map((revision, index) => (
              <li
                key={revision.id}
                className="border-border flex items-center gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {index === 0 ? "● " : ""}
                    {revision.label}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {revision.author} · {formatWhen(revision.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(revision)}
                >
                  <RotateCcw aria-hidden="true" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Small toolbar button that opens the history dialog. */
export function PageHistoryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onOpen}
      aria-label="Page history"
    >
      <History aria-hidden="true" />
      History
    </Button>
  )
}
