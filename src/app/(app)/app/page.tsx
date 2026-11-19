import { redirect } from "next/navigation"

import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"

/** `/app` is the entry point; the dashboard is the landing screen. */
export default function AppIndexPage() {
  redirect(APP_DASHBOARD_PATH)
}
