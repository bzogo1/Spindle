import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import { listAffiliates, statsForAffiliate } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  PARTNER_ANNOUNCEMENT_AUDIENCES,
  PARTNER_ANNOUNCEMENT_BODY_MAX,
  PARTNER_ANNOUNCEMENT_TITLE_MAX,
  PARTNER_LINK_DESCRIPTION_MAX,
  PARTNER_LINK_TITLE_MAX,
  PARTNER_LINK_URL_MAX,
  PartnerPortalError,
  createPartnerAnnouncement,
  createPartnerResourceLink,
  getPartnerProfile,
  listPartnerAnnouncements,
  listPartnerResourceLinks,
} from "@/lib/partner-portal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/partner-portal
 *
 * GET  — the partner-portal admin view: every affiliate account joined
 *        with its portal profile extension (payout method label + tax
 *        info status — never sensitive data) and click/conversion stats,
 *        plus all stored portal announcements and resource links.
 * POST — publish portal content. `{ kind: "announcement", title, body,
 *        audience? }` sends a message to partners; `{ kind: "resource",
 *        title, url, description? }` adds a resource link. `url` must be
 *        an internal path or an `https://` URL.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, both rate
 * limited. The stores are the in-memory dev seams in `src/lib/affiliate.ts`
 * and `src/lib/partner-portal.ts` — there are no real payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("announcement"),
    title: z
      .string()
      .trim()
      .min(1, "Title is required.")
      .max(PARTNER_ANNOUNCEMENT_TITLE_MAX, "Title is too long."),
    body: z
      .string()
      .trim()
      .min(1, "Body is required.")
      .max(PARTNER_ANNOUNCEMENT_BODY_MAX, "Body is too long."),
    audience: z.enum(PARTNER_ANNOUNCEMENT_AUDIENCES).optional(),
  }),
  z.object({
    kind: z.literal("resource"),
    title: z
      .string()
      .trim()
      .min(1, "Title is required.")
      .max(PARTNER_LINK_TITLE_MAX, "Title is too long."),
    url: z.string().trim().min(1, "URL is required.").max(PARTNER_LINK_URL_MAX, "URL is too long."),
    description: z
      .string()
      .trim()
      .min(1)
      .max(PARTNER_LINK_DESCRIPTION_MAX, "Description is too long.")
      .optional(),
  }),
])

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const partners = listAffiliates().map((account) => ({
    id: account.id,
    userId: account.userId,
    email: account.email,
    status: account.status,
    code: account.code,
    commissionRatePct: account.commissionRatePct,
    createdAt: account.createdAt,
    stats: statsForAffiliate(account),
    profile: getPartnerProfile(account.id),
  }))

  return ok({
    partners,
    announcements: listPartnerAnnouncements(),
    links: listPartnerResourceLinks(),
  })
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

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    if (parsed.data.kind === "announcement") {
      const announcement = createPartnerAnnouncement({
        title: parsed.data.title,
        body: parsed.data.body,
        ...(parsed.data.audience ? { audience: parsed.data.audience } : {}),
      })
      return ok({ announcement })
    }
    const link = createPartnerResourceLink({
      title: parsed.data.title,
      url: parsed.data.url,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
    })
    return ok({ link })
  } catch (error) {
    if (error instanceof PartnerPortalError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
