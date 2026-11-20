import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import {
  billingPlanCatalog,
  checkSeatLimit,
  getBilling,
  updateBilling,
  WORKSPACE_BILLING_PLANS,
  workspaceBillingPatchSchema,
} from "@/lib/workspace-billing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/billing — billing info, seat usage, and the plan
 * catalog. Owner/admin only: billing state is sensitive (it reveals spend
 * tier and member counts), so members get 403 like the SSO surface.
 *
 * NOTE: this is the in-memory dev seam — no payment provider is connected,
 * so `billing` reflects locally recorded values only.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(id)
  const billing = getBilling(id)

  return ok({
    role: result.context.membership.role,
    billing,
    seats: checkSeatLimit(id, members.length),
    plans: billingPlanCatalog(),
  })
}

/**
 * PATCH /api/workspaces/[id]/billing — validated partial update of the
 * workspace billing record: `{ plan?, status?, currentPeriodEnd? }`.
 * Owner/admin only; same-origin + rate limited. Emits
 * `workspace.billing_updated` after the store write succeeds.
 *
 * Records the change locally only — no charge is made and no provider is
 * contacted (there is none).
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_input", "Invalid request body.")
  }
  const parsed = workspaceBillingPatchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  const { confirmSeatOverflow, ...fields } = parsed.data
  if (Object.keys(fields).length === 0) {
    return fail(400, "invalid_input", "No billing fields to update.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(id)

  // Downgrade guard: a plan change whose seatLimit is below the live member
  // count needs an explicit `confirmSeatOverflow: true` in the patch body.
  if (fields.plan) {
    const seatLimit = WORKSPACE_BILLING_PLANS[fields.plan].seatLimit
    if (seatLimit < members.length && confirmSeatOverflow !== true) {
      return fail(
        409,
        "seat_overflow",
        `The ${fields.plan} plan allows ${seatLimit} seats but this workspace has ${members.length} members. Resend with confirmSeatOverflow: true to proceed.`,
      )
    }
  }

  const billing = updateBilling(id, { ...fields, seatCount: members.length })

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.billing_updated",
    actorId: result.context.user.id,
    details: {
      changed: Object.keys(fields),
      plan: billing.plan,
      status: billing.status,
    },
  })

  return ok({
    role: result.context.membership.role,
    billing,
    seats: checkSeatLimit(id, members.length),
  })
}
