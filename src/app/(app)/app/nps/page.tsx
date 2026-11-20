import type { Metadata } from "next"

import { AppPage } from "@/components/app/app-page"
import { NpsSurvey } from "@/components/feedback/nps-survey"

export const metadata: Metadata = { title: "Feedback" }

/**
 * Standalone NPS survey page; the widget renders inline at full width.
 *
 * NOTE: nothing links here yet — nav-items.tsx and the app layouts are owned
 * by other changes, so adding an entry point (nav item or link) is left to the
 * integrating work. The floating variant of NpsSurvey is likewise exported but
 * not yet mounted by any host.
 */
export default function NpsPage() {
  return (
    <AppPage
      title="How are we doing?"
      lede="One question, thirty seconds. Your answer shapes what we build next."
    >
      <NpsSurvey variant="page" source="page" />
    </AppPage>
  )
}
