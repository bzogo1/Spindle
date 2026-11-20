import { notFound } from "next/navigation"

import { getAdminEmail } from "@/lib/admin-guard"

/**
 * Guard for the whole `/app/admin` section. Resolves the session email
 * server-side (access-token cookie, or the mock session cookie in mock-auth
 * mode) and 404s for anyone not listed in ADMIN_EMAILS — non-admins get the
 * same "not found" as a route that does not exist. API routes under
 * `/api/admin/*` enforce the same check independently via `requireAdmin`.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const adminEmail = await getAdminEmail()
  if (!adminEmail) notFound()

  return <>{children}</>
}
