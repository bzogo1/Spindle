"use client"

import { TooltipProvider } from "@/components/ui/tooltip"

/** Client-only providers the old Vite entry point wrapped around each island. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <TooltipProvider delayDuration={180}>{children}</TooltipProvider>
}
