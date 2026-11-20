import type { Metadata } from "next"

import { AccountSettingsScreen } from "@/components/app/account-settings-screen"

export const metadata: Metadata = { title: "Account settings" }

export default function AccountSettingsPage() {
  return <AccountSettingsScreen />
}
