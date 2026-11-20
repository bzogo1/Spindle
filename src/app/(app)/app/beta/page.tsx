import type { Metadata } from "next"

import { BetaScreen } from "@/components/app/beta-screen"

export const metadata: Metadata = { title: "Beta programs" }

export default function BetaPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Beta programs</h1>
          <p className="app-page-subtitle">
            Early-access programs you can opt in to. Enrolled features are marked with a beta badge
            while they are being tested.
          </p>
        </div>
      </div>
      <BetaScreen />
    </div>
  )
}
