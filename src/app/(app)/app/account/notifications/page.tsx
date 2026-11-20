import type { Metadata } from "next"

import { NotificationPreferencesScreen } from "@/components/app/notification-preferences-screen"

export const metadata: Metadata = { title: "Notification preferences" }

export default function NotificationPreferencesPage() {
  return <NotificationPreferencesScreen />
}
