import type { Metadata } from "next"

import { MessagesScreen } from "@/components/app/messages-screen"

export const metadata: Metadata = { title: "Messages" }

export default function MessagesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Messages</h1>
          <p className="app-page-subtitle">
            Direct messages from the Spindle team and broadcast announcements.
          </p>
        </div>
      </div>
      <MessagesScreen />
    </div>
  )
}
