import { NextResponse } from "next/server"
import { z } from "zod"

import { getAffiliateByUserId, statsForAffiliate, type AffiliateAccount } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  PARTNER_PAYOUT_LABEL_MAX,
  PARTNER_TAX_INFO_STATUSES,
  getPartnerProfile,
  isPartnerAnnouncementVisibleOnPortal,
  listPartnerAnnouncements,
  listPartnerResourceLinks,
  updatePartnerProfile,
} from "@/lib/partner-portal"
import { resolveAffiliateCaller } from "@/app/api/affiliate/caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/partner/portal
 *
 * GET   — the signed-in partner's portal data: their affiliate account
 *         summary + click/conversion stats, portal profile extension
 *         (payout method *label* and coarse tax info status — never bank
 *         details or tax IDs), announcements, and resource links.
 * PATCH — update allowed profile fields `{ payoutMethodLabel?,
 *         taxInfoStatus? }`. The schema is strict: unknown keys —
 *         including anything resembling bank/tax identifiers — are
 *         rejected with 400.
 *
 * Identity resolves exactly like `/api/affiliate` (`../affiliate/caller.ts`
 * — `spindle_at` access cookie, mock session fallback). The portal is only
 * available to `active` affiliates: no account → 404, any other status →
 * 403, both with the same generic message so the response does not leak
 * which affiliate statuses exist.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const patchSchema = z
  .object({
    payoutMethodLabel: z
      .string()
      .trim()
      .min(1, "Payout method label must not be empty.")
      .max(PARTNER_PAYOUT_LABEL_MAX, "Payout method label is too long.")
      .nullable()
      .optional(),
    taxInfoStatus: z.enum(PARTNER_TAX_INFO_STATUSES).optional(),
  })
  .strict()

/** Shared gating: resolves the caller's ACTIVE affiliate account or an error response. */
async function activePartner(
  request: Request,
): Promise<{ error: NextResponse } | { account: AffiliateAccount }> {
  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return {
      error: fail(401, "unauthenticated", "Sign in to view the partner portal."),
    }
  }
  const account = getAffiliateByUserId(caller.userId)
  if (!account) {
    return {
      error: fail(404, "not_found", "The partner portal is not available for your account."),
    }
  }
  if (account.status !== "active") {
    return {
      error: fail(403, "forbidden", "The partner portal is not available for your account."),
    }
  }
  return { account }
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const resolved = await activePartner(request)
  if ("error" in resolved) return resolved.error
  const { account } = resolved

  return ok({
    portal: {
      affiliate: {
        id: account.id,
        email: account.email,
        status: account.status,
        code: account.code,
        commissionRatePct: account.commissionRatePct,
        createdAt: account.createdAt,
      },
      stats: statsForAffiliate(account),
      sharePath: `/api/affiliate/click/${account.code}`,
      profile: getPartnerProfile(account.id),
      announcements: listPartnerAnnouncements().filter((a) =>
        isPartnerAnnouncementVisibleOnPortal(a.audience),
      ),
      links: listPartnerResourceLinks(),
    },
  })
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const resolved = await activePartner(request)
  if ("error" in resolved) return resolved.error
  const { account } = resolved

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    const profile = updatePartnerProfile(account.id, parsed.data)
    return ok({ profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update your profile."
    // Store-at-capacity is a transient server-side condition, not a bad
    // request — same mapping as /api/affiliate/apply.
    if (/capacity/.test(message)) {
      return fail(503, "unavailable", message)
    }
    return fail(400, "invalid_request", message)
  }
}
