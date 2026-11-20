/**
 * Mock billing fixtures for the usage & plan screen.
 *
 * The billing API does not exist yet, so the plan and invoice data live here
 * as constants — the same pattern as `dashboard-mock.ts` and `lab-mock.ts`.
 * Swap these for `api.billing` responses once the endpoint lands; the screen
 * already derives the current-period invoice and estimated charges from
 * `UsageSummary`, so only the fixture values need to change.
 */

/** Billing plan shown on the "Current plan" card. */
export interface BillingPlan {
  name: string
  /** Monthly price per seat in USD. */
  pricePerSeatUsd: number
  pricePeriod: string
  status: "Active" | "Past due" | "Canceled"
  renewsLabel: string
  seatsUsed: number
  seatsTotal: number
  /**
   * Optional monthly request quota. Absent when the plan does not cap
   * metered requests — the forecast panel only renders a limit comparison
   * when this is set.
   */
  monthlyRequestLimit?: number
  /** Optional monthly metered-cost quota in USD; same rule as above. */
  monthlyCostLimitUsd?: number
}

export const MOCK_BILLING_PLAN: BillingPlan = {
  name: "Team",
  pricePerSeatUsd: 12,
  pricePeriod: "per seat / month",
  status: "Active",
  renewsLabel: "Renews Dec 1, 2026",
  seatsUsed: 3,
  seatsTotal: 5,
}

/** Invoice lifecycle states rendered by the billing history table. */
export type InvoiceStatus = "Paid" | "Upcoming"

export interface Invoice {
  id: string
  /** Display label for the invoice date, e.g. "Dec 1, 2026". */
  date: string
  /**
   * ISO bounds of the billing period the invoice covers. These line up with
   * `UsageSummary.periodStart`/`periodEnd` so the screen can flag the invoice
   * that bills the current usage period.
   */
  periodStart: string
  periodEnd: string
  description: string
  amountUsd: number
  status: InvoiceStatus
}

export const MOCK_INVOICES: Invoice[] = [
  {
    id: "inv_004",
    date: "Dec 1, 2026",
    periodStart: "2026-11-01T00:00:00.000Z",
    periodEnd: "2026-11-30T23:59:59.000Z",
    description: "Team plan — 3 seats",
    amountUsd: 36,
    status: "Upcoming",
  },
  {
    id: "inv_003",
    date: "Nov 1, 2026",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
    description: "Team plan — 3 seats",
    amountUsd: 36,
    status: "Paid",
  },
  {
    id: "inv_002",
    date: "Oct 1, 2026",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-30T23:59:59.000Z",
    description: "Team plan — 2 seats",
    amountUsd: 24,
    status: "Paid",
  },
  {
    id: "inv_001",
    date: "Sep 12, 2026",
    periodStart: "2026-09-12T00:00:00.000Z",
    periodEnd: "2026-09-30T23:59:59.000Z",
    description: "Prorated seat added mid-cycle",
    amountUsd: 8,
    status: "Paid",
  },
]
