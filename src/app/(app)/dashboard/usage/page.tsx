import type { Metadata } from "next"

import { UsageScreen } from "@/components/app/usage-screen"

export const metadata: Metadata = { title: "Usage & plan" }

export default function UsagePage() {
  return <UsageScreen />
}
