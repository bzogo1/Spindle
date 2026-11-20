/**
 * App review model for the developer portal.
 *
 * Every app submitted for review is checked against four categories —
 * security, permissions scope, UX, and performance. Each category contains
 * criteria; reviewers mark each as pass / fail / not-applicable. Required
 * criteria must all pass for approval.
 */

export type ReviewCategoryId = "security" | "permissions" | "ux" | "performance"

export interface ReviewCriterion {
  id: string
  title: string
  description: string
  /** Required criteria must pass for approval; optional ones are advisory. */
  required: boolean
}

export interface ReviewCategory {
  id: ReviewCategoryId
  title: string
  summary: string
  criteria: ReviewCriterion[]
}

export const APP_REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  {
    id: "security",
    title: "Security",
    summary: "The app must not expose or exfiltrate workspace data.",
    criteria: [
      {
        id: "sec-no-secrets",
        title: "No secrets in client code",
        description: "API keys, tokens, and credentials never ship in the client bundle.",
        required: true,
      },
      {
        id: "sec-https",
        title: "HTTPS only",
        description: "All network calls use TLS; no mixed-content or plaintext endpoints.",
        required: true,
      },
      {
        id: "sec-data-handling",
        title: "Documented data handling",
        description: "A privacy note explains what data the app reads, stores, and shares.",
        required: true,
      },
      {
        id: "sec-xss",
        title: "Output is escaped",
        description: "Workspace content rendered by the app is escaped or sanitized.",
        required: false,
      },
    ],
  },
  {
    id: "permissions",
    title: "Permissions scope",
    summary: "Requested scopes match what the app actually does.",
    criteria: [
      {
        id: "perm-minimal",
        title: "Least-privilege scopes",
        description: "Only scopes the app needs are requested; no wildcard grants.",
        required: true,
      },
      {
        id: "perm-expiry",
        title: "Justified expiry",
        description: "Long-lived or permanent grants are justified in the submission notes.",
        required: true,
      },
      {
        id: "perm-roles",
        title: "Role restrictions reviewed",
        description: "Role-limited grants match the app's intended audience.",
        required: false,
      },
    ],
  },
  {
    id: "ux",
    title: "UX",
    summary: "The app feels like part of the workspace, not a bolt-on.",
    criteria: [
      {
        id: "ux-onboarding",
        title: "Clear onboarding",
        description: "First-run flow explains what the app does and which scopes it needs.",
        required: true,
      },
      {
        id: "ux-error-states",
        title: "Handled error states",
        description: "Auth failures, rate limits, and empty states have usable UI.",
        required: true,
      },
      {
        id: "ux-accessibility",
        title: "Keyboard accessible",
        description: "Core flows work without a mouse; controls have labels.",
        required: false,
      },
    ],
  },
  {
    id: "performance",
    title: "Performance",
    summary: "The app does not degrade the workspace.",
    criteria: [
      {
        id: "perf-bundle",
        title: "Reasonable bundle size",
        description: "Initial load stays within budget; heavy deps load lazily.",
        required: true,
      },
      {
        id: "perf-rate",
        title: "Polite request rate",
        description: "Polling and retries respect rate limits and backoff.",
        required: true,
      },
      {
        id: "perf-caching",
        title: "Caches where possible",
        description: "Repeated reads use caching or ETags instead of refetching.",
        required: false,
      },
    ],
  },
] as const

export type ReviewCheckStatus = "pass" | "fail" | "na"

export interface ReviewCheck {
  criterionId: string
  status: ReviewCheckStatus
}

export interface ReviewSummary {
  total: number
  passed: number
  failed: number
  notApplicable: number
  unchecked: number
  requiredTotal: number
  requiredPassed: number
  /** 0–100, share of non-NA criteria that passed. */
  percent: number
  approved: boolean
}

const CRITERION_INDEX = new Map<string, { category: ReviewCategory; criterion: ReviewCriterion }>()

for (const category of APP_REVIEW_CATEGORIES) {
  for (const criterion of category.criteria) {
    CRITERION_INDEX.set(criterion.id, { category, criterion })
  }
}

interface ReviewIndex {
  criteria: Map<string, ReviewCriterion>
  requiredTotal: number
}

function buildIndex(categories: readonly ReviewCategory[]): ReviewIndex {
  const criteria = new Map<string, ReviewCriterion>()
  let requiredTotal = 0
  for (const category of categories) {
    for (const criterion of category.criteria) {
      criteria.set(criterion.id, criterion)
      if (criterion.required) requiredTotal += 1
    }
  }
  return { criteria, requiredTotal }
}

const DEFAULT_INDEX = buildIndex(APP_REVIEW_CATEGORIES)

export function getCriterion(id: string): ReviewCriterion | null {
  return CRITERION_INDEX.get(id)?.criterion ?? null
}

export function getReviewCategories(): ReviewCategory[] {
  return APP_REVIEW_CATEGORIES.map((category) => ({
    ...category,
    criteria: [...category.criteria],
  }))
}

/** Total number of criteria across all categories. */
export function reviewCriterionCount(): number {
  return APP_REVIEW_CATEGORIES.reduce((sum, c) => sum + c.criteria.length, 0)
}

/**
 * Summarize a set of review checks. Unknown criterion ids are ignored.
 * Approval requires every *required* criterion to be marked `pass`.
 */
export function summarizeReview(
  checks: readonly ReviewCheck[],
  categories: readonly ReviewCategory[] = APP_REVIEW_CATEGORIES,
): ReviewSummary {
  const index = categories === APP_REVIEW_CATEGORIES ? DEFAULT_INDEX : buildIndex(categories)

  let passed = 0
  let failed = 0
  let notApplicable = 0
  let requiredPassed = 0
  let seen = new Set<string>()

  for (const check of checks) {
    if (seen.has(check.criterionId)) continue
    const criterion = index.criteria.get(check.criterionId)
    if (!criterion) continue
    seen.add(check.criterionId)

    const isRequired = criterion.required

    if (check.status === "na") {
      notApplicable += 1
      continue
    }

    if (check.status === "pass") {
      passed += 1
      if (isRequired) requiredPassed += 1
    } else {
      failed += 1
    }
  }

  const evaluated = passed + failed
  const percent = evaluated === 0 ? 0 : Math.round((passed / evaluated) * 100)
  const total = categories.reduce((sum, c) => sum + c.criteria.length, 0)

  return {
    total,
    passed,
    failed,
    notApplicable,
    unchecked: total - passed - failed - notApplicable,
    requiredTotal: index.requiredTotal,
    requiredPassed,
    percent,
    // Every required criterion in the model must be checked and passing —
    // unchecked or failed required criteria block approval.
    approved: index.requiredTotal > 0 && requiredPassed === index.requiredTotal,
  }
}

/** True when every required criterion passes (N/A optional criteria are fine). */
export function isReviewApproved(checks: readonly ReviewCheck[]): boolean {
  return summarizeReview(checks).approved
}
