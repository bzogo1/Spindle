"use client"

import { CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * "Page help" dialog showing documentation topics for the current section.
 * Topics come from `helpTopicsFor(pathname)` in page-meta; the list is mock
 * documentation until real per-page docs land.
 */
export function PageHelpDialog({
  open,
  onOpenChange,
  section,
  topics,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: string
  topics: string[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleHelp className="size-4" aria-hidden="true" />
            {section} help
          </DialogTitle>
          <DialogDescription>
            Quick answers and pointers for this page.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid gap-2 text-sm">
          {topics.map((topic) => (
            <li key={topic} className="border-border flex gap-2 rounded-md border p-3">
              <span className="bg-primary/10 text-primary mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                ?
              </span>
              <span>{topic}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** Small toolbar button that opens the help dialog. */
export function PageHelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onOpen} aria-label="Page help">
      <CircleHelp aria-hidden="true" />
      Help
    </Button>
  )
}
