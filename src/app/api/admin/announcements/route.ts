import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  ANNOUNCEMENT_AUDIENCES,
  createAnnouncement,
  listAllAnnouncements,
} from "@/lib/announcements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/announcements
 *
 * GET  — every stored announcement, newest first (live, scheduled, and
 *        expired; the store has no draft state — see
 *        `src/lib/announcements.ts`).
 * POST — publish a new announcement `{ title, body, ctaLabel?, ctaHref?,
 *        audience?, startsAt, endsAt? }`. `startsAt`/`endsAt` accept any
 *        `Date.parse`-able string (ISO recommended); `endsAt` must be
 *        strictly after `startsAt`.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both
 * rate limited. The store is the in-memory dev seam described in
 * `src/lib/announcements.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

function isDateString(value: string): boolean {
  return !Number.isNaN(Date.parse(value))
}

const announcementSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
    body: z.string().trim().min(1, "Body is required.").max(5000, "Body is too long."),
    ctaLabel: z.string().trim().min(1).max(80).optional(),
    ctaHref: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          // Reject "//host" protocol-relative URLs — they start with "/"
          // but navigate to an external origin.
          (value.startsWith("/") && !value.startsWith("//")) || value.startsWith("https://"),
        {
          message: "CTA link must be an internal path or an https URL.",
        },
      )
      .optional(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
    startsAt: z
      .string()
      .min(1, "startsAt is required.")
      .refine(isDateString, { message: "startsAt must be a valid date/time." }),
    endsAt: z
      .string()
      .min(1)
      .refine(isDateString, { message: "endsAt must be a valid date/time." })
      .optional(),
  })
  .refine(
    (data) => data.endsAt === undefined || Date.parse(data.endsAt) > Date.parse(data.startsAt),
    { message: "endsAt must be after startsAt.", path: ["endsAt"] },
  )

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  return ok({ announcements: listAllAnnouncements() })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = announcementSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid announcement."
    return fail(400, "invalid_request", message)
  }

  try {
    const announcement = createAnnouncement(parsed.data)
    return ok({ announcement })
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid announcement.",
    )
  }
}
