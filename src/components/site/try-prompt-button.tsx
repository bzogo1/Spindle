"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"

import { buildGraphFromIntent } from "@/lib/automations/intent"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * The full graph builder is a heavy client-only chunk (canvas, panels,
 * localStorage-backed history). It is `ssr: false` and only mounted while the
 * dialog is open so marketing pages don't pay for it up front.
 */
const LazyAutomationBuilder = dynamic(
  () => import("@/components/automation-builder").then((mod) => mod.AutomationBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground flex h-[28rem] items-center justify-center text-sm">
        Loading automation builder…
      </div>
    ),
  },
)

/**
 * Keep in sync with the prompt text in the Automations section's prompt card
 * (`src/app/(site)/page.tsx`). Duplicated here because the card is server
 * markup and this module is a client island.
 */
const AUTOMATION_EXAMPLE_PROMPT =
  "When a new CSV lands in /data, clean it and add a short summary to the project log."

/**
 * "Try this prompt" button for the Automations section's prompt card. Opens a
 * modal with the real automation builder pre-filled: the example prompt is run
 * through `buildGraphFromIntent`, which drafts a connected node graph the
 * visitor can inspect and edit before signing up to save it.
 */
export function TryPromptButton() {
  const [open, setOpen] = useState(false)
  // Built once per mount; the builder only reads `defaultGraph` on mount, so
  // closing and reopening the dialog resets the canvas to this draft.
  const graph = useMemo(() => buildGraphFromIntent(AUTOMATION_EXAMPLE_PROMPT).graph, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="prompt-try"
          aria-label="Try this prompt in the automation builder"
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-sparkle" />
          </svg>
          Try this prompt
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-full max-w-[calc(100%-2rem)] flex-col gap-4 overflow-y-auto p-5 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Try this prompt</DialogTitle>
          <DialogDescription>
            &ldquo;{AUTOMATION_EXAMPLE_PROMPT}&rdquo; — Spindle drafted it into an automation graph.
            Edit the nodes below, then sign up to save and schedule it.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <div className="h-[62vh] min-h-[28rem] overflow-hidden">
            <LazyAutomationBuilder
              defaultGraph={graph}
              historyScope="site-try-prompt"
              className="h-full"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button asChild>
            <a href="/sign-up">Create a free account to save this</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
