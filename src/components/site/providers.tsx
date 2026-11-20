"use client"

import { TooltipProvider } from "@/components/ui/tooltip"

import { AuthSessionProvider } from "@/components/auth/session-provider"

/** Client-only providers the old Vite entry point wrapped around each island. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={180}>
      <AuthSessionProvider>{children}</AuthSessionProvider>
    </TooltipProvider>
  )
}
