import type { Metadata } from "next"

import { WhatsNewScreen } from "@/components/app/whats-new-screen"

export const metadata: Metadata = { title: "What's new" }

export default function WhatsNewPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">What's new</h1>
          <p className="app-page-subtitle">The latest Spindle releases and what changed.</p>
        </div>
      </div>
      <WhatsNewScreen />
    </div>
  )
}
