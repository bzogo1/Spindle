import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { AutomationsPanel } from "@/components/app/automations-panel"

export const metadata: Metadata = { title: "Automations" }

export default function AutomationsPage() {
  return (
    <AppPage title="Automations" lede="Scheduled and event-driven workflows across your projects.">
      <AutomationsPanel />
    </AppPage>
  )
}
