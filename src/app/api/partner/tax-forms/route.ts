import { z } from "zod"

import { getAffiliateByUserId } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { resolveAffiliateCaller } from "@/app/api/affiliate/caller"
import {
  TaxFormNotFoundError,
  TaxFormValidationError,
  W9_TAX_CLASSIFICATIONS,
  containsTinShapedValue,
  generateW9Draft,
  listTaxForms,
  submitW9,
} from "@/lib/tax-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/partner/tax-forms
 *
 * GET — the signed-in partner's own tax form records plus their W-9 draft
 *       (`{ name, businessName?, taxClassification, tinProvided }`). The
 *       draft NEVER contains a TIN — only the `tinProvided` boolean.
 * POST — submit/update the W-9 draft: `{ name?, businessName?,
 *        taxClassification?, tinProvided? }`. The schema is `.strict()`:
 *        any TIN/SSN/EIN-shaped key is rejected outright, and the library
 *        has no field that could store one. Upserts the single `w9`
 *        record for the affiliate (status `submitted`, or stays
 *        `on_file`).
 *
 * Identity resolves exactly like `/api/partner/commissions` and
 * `/api/partner/payout-settings` (`../affiliate/caller.ts`). Any affiliate
 * account status may read/submit its own tax forms. No account → 404, no
 * session → 401.
 *
 * SIMULATED ONLY: records are scaffolding for a future real filing flow —
 * no IRS integration exists. See `src/lib/tax-forms.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

// Free-text fields are screened for TIN-shaped values (SSN ###-##-####, EIN
// ##-#######, bare 9 digits) so a partner cannot smuggle a TIN through
// `name`/`businessName` — the same guard `submitW9` enforces in the library.
const noTinShapedValue = (value: string) => !containsTinShapedValue(value)
const tinShapedMessage = "must not contain a tax identification number (SSN/EIN)."

const postSchema = z
  .object({
    name: z.string().trim().min(1).max(200).refine(noTinShapedValue, tinShapedMessage).optional(),
    businessName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(noTinShapedValue, tinShapedMessage)
      .optional(),
    taxClassification: z.enum(W9_TAX_CLASSIFICATIONS).optional(),
    tinProvided: z.boolean().optional(),
  })
  .strict()

async function resolvePartner(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveAffiliateCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to manage tax forms.")
  }
  const account = getAffiliateByUserId(caller.userId)
  if (!account) {
    return fail(404, "not_found", "No affiliate account is linked to your session.")
  }
  return account
}

export async function GET(request: Request) {
  const account = await resolvePartner(request)
  if (account instanceof Response) return account

  return ok({
    forms: listTaxForms({ affiliateId: account.id }),
    w9: generateW9Draft(account.id),
  })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const account = await resolvePartner(request)
  if (account instanceof Response) return account

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    // `.strict()` rejects TIN-shaped keys (tin, ssn, ein, taxId, …) as
    // unrecognized keys — they are never read, stored, or echoed back.
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    const record = submitW9(account.id, parsed.data)
    return ok({ form: record, w9: generateW9Draft(account.id) })
  } catch (error) {
    if (error instanceof TaxFormValidationError || error instanceof TaxFormNotFoundError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
