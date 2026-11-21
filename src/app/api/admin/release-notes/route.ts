import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { changelogReleases, getRelease, type ChangelogRelease } from "@/lib/changelog"
import { getServerEnv } from "@/lib/env.server"
import { listSubscribers } from "@/lib/newsletter-store"
import { composeReleaseNotesEmail } from "@/lib/release-notes"
import {
  sendReleaseNotes,
  type ReleaseNotesRecipient,
  type ReleaseNotesSendResult,
} from "@/lib/release-notes-send"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/release-notes
 *
 * GET  — preview of the release-notes email: resolved entries, the composed
 *        subject + a truncated text body, an HTML body for sandboxed preview,
 *        the active-subscriber recipient estimate, and whether email delivery
 *        is configured (`RESEND_API_KEY`).
 *        Query: `latestCount` (default 1, max 10) and/or `entryIds`
 *        (comma-separated slugs).
 *
 * POST — `{ entryIds? | latestCount?, audience: "subscribers" | "all-users" }`
 *        resolves recipients and calls `sendReleaseNotes`, returning honest
 *        `{ attempted, suppressed, sent, unconfigured, failed }` counts —
 *        `suppressed` counts recipients skipped for email opt-outs.
 *
 * Admin-only via `requireAdmin`; POST is rate-limited with the `emailSend`
 * preset (5 / 10 min per IP) since it triggers outbound mail.
 *
 * DEV SEAM: recipients come from the in-memory newsletter store
 * (`src/lib/newsletter-store.ts`) — active subscribers only. The auth backend
 * exposes no user-listing method, so `audience: "all-users"` cannot enumerate
 * backend users; it falls back to the same subscriber list and the response
 * carries `audienceNote` saying so. Delivery itself is the `sendEmail` seam:
 * without `RESEND_API_KEY` every recipient is reported `unconfigured`, never
 * `sent`.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const sendLimiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

const DEFAULT_LATEST_COUNT = 1
const MAX_LATEST_COUNT = 10
const MAX_ENTRY_IDS = 10
const TEXT_PREVIEW_LENGTH = 4000
const SUBSCRIBER_FETCH_LIMIT = 500
/**
 * Bound on per-recipient auth-backend name lookups. The subscriber list is
 * capped at 500; resolving a display name for each would make an admin POST
 * wait on up to 500 sequential backend calls, so enrichment stops after this
 * many lookups (newest subscribers first — `listSubscribers` sorts by
 * `consentedAt` desc). Remaining recipients greet as "Hi there,".
 */
const RECIPIENT_NAME_LOOKUP_LIMIT = 100

const postSchema = z
  .object({
    entryIds: z.array(z.string().trim().min(1)).max(MAX_ENTRY_IDS).optional(),
    latestCount: z.number().int().min(1).max(MAX_LATEST_COUNT).optional(),
    audience: z.enum(["subscribers", "all-users"]).optional(),
  })
  .refine((body) => body.entryIds !== undefined || body.latestCount !== undefined, {
    message: "Provide entryIds or latestCount.",
  })

type EntrySelection = { entries: ChangelogRelease[]; error?: string }

function resolveEntries(input: { entryIds?: string[]; latestCount?: number }): EntrySelection {
  if (input.entryIds && input.entryIds.length > 0) {
    const entries: ChangelogRelease[] = []
    const missing: string[] = []
    for (const slug of input.entryIds) {
      const release = getRelease(slug)
      if (release) entries.push(release)
      else missing.push(slug)
    }
    if (missing.length > 0) {
      return { entries: [], error: `Unknown release slug(s): ${missing.join(", ")}.` }
    }
    return { entries }
  }
  const count = input.latestCount ?? DEFAULT_LATEST_COUNT
  return { entries: changelogReleases.slice(0, count) }
}

function entryMeta(entry: ChangelogRelease) {
  return {
    slug: entry.slug,
    version: entry.version,
    date: entry.date,
    title: entry.title,
    tags: entry.tags,
  }
}

/**
 * Resolves active newsletter subscribers into send recipients.
 *
 * `NewsletterSubscriber` records carry no display name, so `userName` is
 * best-effort enrichment: the first `RECIPIENT_NAME_LOOKUP_LIMIT` addresses
 * are looked up via `getAuthBackend().getUserByEmail` (lazy import, per-
 * lookup try/catch — a backend miss or failure just yields "Hi there,").
 * This is an admin-triggered, rate-limited endpoint so the bounded lookup
 * cost is acceptable; a datastore-backed name join is the upgrade path.
 */
async function activeSubscriberRecipients(): Promise<ReleaseNotesRecipient[]> {
  const subscribers = listSubscribers({ status: "active", limit: SUBSCRIBER_FETCH_LIMIT }).items

  let backend: {
    getUserByEmail?: (email: string) => Promise<{ name?: string | null } | null>
  } | null
  try {
    const mod = await import("@/lib/auth/backend")
    backend = mod.getAuthBackend()
  } catch {
    backend = null
  }

  const recipients: ReleaseNotesRecipient[] = []
  for (const [index, subscriber] of subscribers.entries()) {
    let userName: string | undefined
    if (backend?.getUserByEmail && index < RECIPIENT_NAME_LOOKUP_LIMIT) {
      try {
        const user = await backend.getUserByEmail(subscriber.email)
        const name = user?.name?.trim()
        if (name) userName = name
      } catch {
        // Best-effort enrichment; keep the bare recipient.
      }
    }
    recipients.push({
      email: subscriber.email,
      ...(userName ? { userName } : {}),
    })
  }
  return recipients
}

function emailConfigured(): boolean {
  try {
    return Boolean(getServerEnv().RESEND_API_KEY)
  } catch {
    return false
  }
}

function parseEntryIds(raw: string | null): string[] | null {
  if (raw === null || raw.trim() === "") return []
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (ids.length > MAX_ENTRY_IDS) return null
  return ids
}

function parseLatestCount(raw: string | null): number | null | "invalid" {
  if (raw === null || raw.trim() === "") return null
  if (!/^\d+$/.test(raw.trim())) return "invalid"
  const value = Number.parseInt(raw.trim(), 10)
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_LATEST_COUNT ? value : "invalid"
}

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const entryIds = parseEntryIds(params.get("entryIds"))
  const latestCount = parseLatestCount(params.get("latestCount"))
  if (entryIds === null || latestCount === "invalid") {
    return fail(400, "invalid_request", "Invalid entryIds or latestCount.")
  }

  const selection = resolveEntries({
    ...(entryIds.length > 0 ? { entryIds } : {}),
    ...(latestCount !== null ? { latestCount } : {}),
  })
  if (selection.error) return fail(400, "invalid_request", selection.error)

  const composed = composeReleaseNotesEmail(selection.entries)
  const recipients = await activeSubscriberRecipients()

  return ok({
    entries: selection.entries.map(entryMeta),
    subject: composed.subject,
    text: composed.text.slice(0, TEXT_PREVIEW_LENGTH),
    textTruncated: composed.text.length > TEXT_PREVIEW_LENGTH,
    html: composed.html,
    recipientCount: recipients.length,
    emailConfigured: emailConfigured(),
  })
}

export async function POST(request: Request) {
  if (!sendLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const selection = resolveEntries({
    ...(parsed.data.entryIds ? { entryIds: parsed.data.entryIds } : {}),
    ...(parsed.data.latestCount !== undefined ? { latestCount: parsed.data.latestCount } : {}),
  })
  if (selection.error) return fail(400, "invalid_request", selection.error)
  if (selection.entries.length === 0) {
    return fail(400, "invalid_request", "No matching release notes found.")
  }

  const audience = parsed.data.audience ?? "subscribers"
  const recipients = await activeSubscriberRecipients()
  // The auth backend has no user-listing seam, so "all-users" cannot reach
  // backend accounts; it resolves to the same subscriber audience and the
  // response says so explicitly.
  const audienceNote =
    audience === "all-users"
      ? 'Audience "all-users" is not enumerable in the current backend; sent to newsletter subscribers instead.'
      : null

  const result: ReleaseNotesSendResult = await sendReleaseNotes({
    entries: selection.entries,
    recipients,
  })

  return ok({
    audience,
    audienceNote,
    entries: selection.entries.map(entryMeta),
    result,
    emailConfigured: emailConfigured(),
  })
}
