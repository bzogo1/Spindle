"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, CreditCard } from "lucide-react"

import { formatDate } from "@/components/app/format"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/toast"
import type { BillingPlanId, BillingStatus, WorkspaceBilling } from "@/lib/workspace-billing"

/**
 * Workspace billing screen for `/app/workspaces/[id]/billing`.
 *
 * Loads `GET /api/workspaces/{id}/billing` (owner/admin only — members get
 * 403 and see an insufficient-permissions state) and applies plan changes
 * via `PATCH /api/workspaces/{id}/billing` with `{ plan }`.
 *
 * IMPORTANT: there is NO payment provider connected. Plan/status changes
 * are recorded locally in the dev seam only — the copy below says so
 * explicitly and no checkout, card, or charge flow exists.
 */

interface PlanInfo {
  id: BillingPlanId
  name: string
  priceLabel: string
  seatLimit: number
  summary: string
}

interface SeatUsage {
  allowed: boolean
  limit: number
  current: number
}

interface BillingResponse {
  ok: boolean
  role?: string
  billing?: WorkspaceBilling
  seats?: SeatUsage
  plans?: PlanInfo[]
  message?: string
  code?: string
}

const STATUS_LABELS: Record<BillingStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
}

const STATUS_VARIANTS: Record<BillingStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    active: "default",
    trialing: "outline",
    past_due: "destructive",
    canceled: "secondary",
  }

function planRank(plans: PlanInfo[], id: BillingPlanId): number {
  return plans.findIndex((plan) => plan.id === id)
}

export function BillingScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [billing, setBilling] = useState<WorkspaceBilling | null>(null)
  const [seats, setSeats] = useState<SeatUsage | null>(null)
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingPlan, setChangingPlan] = useState<BillingPlanId | null>(null)
  // Plan awaiting seat-overflow confirmation after a 409 from the API.
  const [pendingOverflowPlan, setPendingOverflowPlan] = useState<PlanInfo | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setForbidden(false)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/billing`, {
        cache: "no-store",
      })
      const data = (await response.json()) as BillingResponse
      if (response.status === 403) {
        setForbidden(true)
        setBilling(null)
        setSeats(null)
        setPlans([])
        return
      }
      if (!response.ok || !data.ok || !data.billing || !data.seats || !data.plans) {
        setError(data.message ?? "Could not load billing information.")
        setBilling(null)
        setSeats(null)
        setPlans([])
        return
      }
      setBilling(data.billing)
      setSeats(data.seats)
      setPlans(data.plans)
      setRole(data.role ?? null)
    } catch {
      setError("Could not load billing information. Check your connection and try again.")
      setBilling(null)
      setSeats(null)
      setPlans([])
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"
  const loading = billing === null && error === null && !forbidden
  const currentRank = billing ? planRank(plans, billing.plan) : -1

  async function changePlan(planId: BillingPlanId, confirmSeatOverflow = false) {
    if (!billing || changingPlan || !canManage || planId === billing.plan) return
    setChangingPlan(planId)
    setPendingOverflowPlan(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/billing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          confirmSeatOverflow ? { plan: planId, confirmSeatOverflow: true } : { plan: planId },
        ),
      })
      const data = (await response.json()) as BillingResponse
      if (response.status === 409 && data.code === "seat_overflow") {
        const target = plans.find((plan) => plan.id === planId)
        setPendingOverflowPlan(target ?? null)
        return
      }
      if (!response.ok || !data.ok || !data.billing) {
        toast({
          title: "Couldn't update plan",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setBilling(data.billing)
      if (data.seats) setSeats(data.seats)
      toast({
        title: "Plan updated",
        description: "The change was recorded locally — no payment was processed.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't update plan",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setChangingPlan(null)
    }
  }

  const seatPercent =
    seats && seats.limit > 0 ? Math.min(100, Math.round((seats.current / seats.limit) * 100)) : 0

  return (
    <section className="app-page-card grid gap-6" aria-labelledby="workspace-billing-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-billing-heading">Billing &amp; plan</h2>
        {billing ? (
          <Badge variant={STATUS_VARIANTS[billing.status]} size="sm">
            {STATUS_LABELS[billing.status]}
          </Badge>
        ) : null}
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm" role="note">
        <CreditCard aria-hidden="true" className="mr-1 inline h-4 w-4 align-text-bottom" />
        Billing is not connected to a payment provider yet — plan changes are recorded locally and
        no charges are made.
      </p>

      {forbidden ? (
        <p className="text-muted-foreground text-sm" role="note">
          Only workspace owners and admins can view billing. Billing details (plan, seat usage,
          subscription status) aren&apos;t visible to members.
        </p>
      ) : null}

      {error ? (
        <InlineError
          title="Billing unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading billing" variant="table" /> : null}

      {billing && seats && plans.length > 0 ? (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can change the plan. You&apos;re a {role ?? "member"}{" "}
              of this workspace, so plan changes are disabled.
            </p>
          ) : null}

          <div className="grid gap-4">
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">
                    {planDisplayName(plans, billing.plan)} plan
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {planPriceLabel(plans, billing.plan)}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {billing.currentPeriodEnd
                    ? `Current period ends ${formatDate(billing.currentPeriodEnd)}`
                    : "No billing period set"}
                </p>
              </div>
              <div className="mt-4 grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Seat usage</span>
                  <span>
                    {seats.current} of {seats.limit} seats used
                  </span>
                </div>
                <Progress value={seatPercent} aria-label="Seat usage" />
                {!seats.allowed ? (
                  <p className="text-destructive text-sm" role="alert">
                    This workspace has more members than the {billing.plan} plan allows. Upgrade to
                    add seats.
                  </p>
                ) : null}
              </div>
            </div>

            {pendingOverflowPlan && seats ? (
              <div
                className="border-destructive/50 flex flex-wrap items-center gap-3 rounded-lg border p-4"
                role="alert"
              >
                <p className="text-sm">
                  The {pendingOverflowPlan.name} plan allows {pendingOverflowPlan.seatLimit}{" "}
                  {pendingOverflowPlan.seatLimit === 1 ? "seat" : "seats"}, but this workspace has{" "}
                  {seats.current} {seats.current === 1 ? "member" : "members"}. Members beyond the
                  limit won&apos;t fit the new plan.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={changingPlan !== null}
                    onClick={() => void changePlan(pendingOverflowPlan.id, true)}
                  >
                    {changingPlan === pendingOverflowPlan.id
                      ? "Updating…"
                      : `Downgrade to ${pendingOverflowPlan.name} anyway`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={changingPlan !== null}
                    onClick={() => setPendingOverflowPlan(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = plan.id === billing.plan
                const rank = planRank(plans, plan.id)
                const action =
                  rank > currentRank ? "Upgrade" : rank < currentRank ? "Downgrade" : null
                return (
                  <div
                    key={plan.id}
                    className="flex flex-col gap-3 rounded-lg border p-4"
                    data-plan={plan.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold">{plan.name}</h3>
                      {isCurrent ? (
                        <Badge variant="secondary" size="sm">
                          Current
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-sm">{plan.summary}</p>
                    <p className="text-sm font-medium">{plan.priceLabel}</p>
                    <p className="text-muted-foreground text-sm">
                      Up to {plan.seatLimit} {plan.seatLimit === 1 ? "seat" : "seats"}
                    </p>
                    <div className="mt-auto pt-2">
                      {isCurrent ? (
                        <Button type="button" variant="outline" size="sm" disabled>
                          <Check aria-hidden="true" />
                          Current plan
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant={action === "Upgrade" ? "default" : "outline"}
                          size="sm"
                          disabled={!canManage || changingPlan !== null}
                          onClick={() => void changePlan(plan.id)}
                        >
                          {changingPlan === plan.id ? "Updating…" : action}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

function planDisplayName(plans: PlanInfo[], id: BillingPlanId): string {
  return plans.find((plan) => plan.id === id)?.name ?? id
}

function planPriceLabel(plans: PlanInfo[], id: BillingPlanId): string {
  return plans.find((plan) => plan.id === id)?.priceLabel ?? ""
}
