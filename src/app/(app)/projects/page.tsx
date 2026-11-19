import { redirect } from "next/navigation"

import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"

/** Project browsing lives on the dashboard. */
export default function ProjectsPage() {
  redirect(APP_DASHBOARD_PATH)
}
