/**
 * Admin authorization seam.
 *
 * DEVELOPMENT SEAM: admins are identified by the ADMIN_EMAILS env var
 * (comma-separated, case-insensitive). Production must replace this with a
 * durable role/permission store (e.g. user.role === "admin" backed by Prisma).
 * All admin routes must call `isAdminEmail`/`requireAdmin`-style checks —
 * never trust client-supplied role claims.
 */

function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

let testOverride: Set<string> | null = null

/** Emails currently configured as admins (env + test override). */
export function getAdminEmails(): Set<string> {
  if (testOverride) return testOverride
  // eslint-disable-next-line no-restricted-properties -- ADMIN_EMAILS is deliberately not part of ServerEnv; this is a development seam pending a durable role store
  return parseAdminEmails(process.env.ADMIN_EMAILS)
}

/** True when the email is configured as an admin. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return getAdminEmails().has(email.trim().toLowerCase())
}

/** Test hook: replace the admin email set; pass null to restore env behavior. */
export function setAdminEmailsForTests(emails: string[] | null): void {
  testOverride = emails ? new Set(emails.map((e) => e.trim().toLowerCase())) : null
}
