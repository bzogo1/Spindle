import type { Metadata } from "next"

import { TeamMembersScreen } from "@/components/app/team-members-screen"

export const metadata: Metadata = { title: "Team members" }

export default function TeamMembersPage() {
  return <TeamMembersScreen />
}
