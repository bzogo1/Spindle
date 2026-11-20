import type { Metadata } from "next"

import { FeedbackWidget } from "@/components/feedback/feedback-widget"

export const metadata: Metadata = { title: "Feedback" }

/**
 * Dedicated feedback screen. The floating widget is the primary entry point
 * app-wide; this page gives it a stable URL and opens the form directly.
 *
 * Wiring required outside this file's ownership:
 *  - Mount `<FeedbackWidget />` inside the app shell
 *    (`src/components/app/app-shell.tsx`) so the floating button appears on
 *    every authenticated screen.
 *  - Optionally add a "Feedback" entry to `src/components/app/nav-items.tsx`
 *    pointing at `/app/feedback`.
 */
export default function FeedbackPage() {
  return (
    <div className="app-page">
      <div className="grid max-w-2xl gap-3">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-muted-foreground text-sm">
          Found a bug, have an idea, or just want to say hello? Send it our way — every message is
          read.
        </p>
      </div>
      <FeedbackWidget defaultOpen />
    </div>
  )
}
