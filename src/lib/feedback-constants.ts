/**
 * Leaf constants for the user feedback widget and `POST /api/feedback`.
 *
 * Kept separate from `feedback.ts` because that module builds zod schemas:
 * client components only need these values, and importing them from the
 * schema module would pull all of zod into the initial client bundle.
 * Mirrors the `site-form-constants.ts` / `site-forms.ts` split.
 */

export const FEEDBACK_CATEGORIES = ["bug", "idea", "general"] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug report",
  idea: "Idea or suggestion",
  general: "General feedback",
}

export const FEEDBACK_LIMITS = {
  messageMin: 10,
  messageMax: 5000,
  emailMax: 320,
} as const
