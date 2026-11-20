"use client"

import type { AgentRunLogEntry } from "@/lib/api"

import { CopyButton } from "./copy-button"

/**
 * Share affordance for an agent run. Copies the absolute URL of the run
 * detail page (`/app/agent/<runId>`) so a teammate with workspace access can
 * open the same trace — the run log has no anonymous/public share state, so
 * the link only resolves for signed-in members of the workspace.
 */
export function AgentRunShareButton({
  run,
  label = "Copy link",
}: {
  run: AgentRunLogEntry
  label?: string
}) {
  return (
    <CopyButton
      // Evaluated lazily on click so `window` is only touched in the browser.
      text={() =>
        `${typeof window === "undefined" ? "" : window.location.origin}/app/agent/${encodeURIComponent(run.id)}`
      }
      label={label}
    />
  )
}
