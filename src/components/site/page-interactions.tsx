"use client"

import { useEffect } from "react"

type Page = "automations" | "lab" | "collaboration" | "infrastructure"

/** Loads the original page interactions once the route has hydrated. */
export function PageInteractions({ page }: { page: Page }) {
  useEffect(() => {
    let cancelled = false

    const init = {
      automations: () => import("@/lib/interactions/automations").then((m) => m.initAutomations()),
      lab: () => import("@/lib/interactions/lab").then((m) => m.initLab()),
      collaboration: () =>
        import("@/lib/interactions/collaboration").then((m) => m.initCollaboration()),
      infrastructure: () =>
        import("@/lib/interactions/infrastructure").then((m) => m.initInfrastructure()),
    }[page]

    if (!cancelled) init()

    return () => {
      cancelled = true
    }
  }, [page])

  return null
}
