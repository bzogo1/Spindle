import type { Metadata } from "next"
import "../../../styles/pages.css"

import { ReferralLanding } from "./referral-landing"
import { PageTransition } from "@/components/view-transitions/view-transitions"

// Personal invite links — no canonical, no indexing of arbitrary codes.
export const metadata: Metadata = {
  title: "You've been invited — Spindle",
  description:
    "Someone shared their Spindle referral link with you. Create a free research workspace — 5 GB of storage and 20 agent requests a day, no card required.",
  robots: { index: false, follow: false },
}

export default async function ReferralInvitePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  return (
    <PageTransition>
      <ReferralLanding code={code} />
    </PageTransition>
  )
}
