/**
 * Leaf constants for the public site forms (contact + newsletter).
 *
 * Kept separate from `site-forms.ts` because that module builds zod schemas:
 * client components only need these values, and importing them from the
 * schema module would pull all of zod into the initial client bundle.
 */

export const CONTACT_LIMITS = {
  nameMax: 120,
  subjectMax: 200,
  messageMin: 10,
  messageMax: 5000,
  /** Optional order/account/company reference the visitor can quote back. */
  referenceMax: 120,
} as const

/**
 * Contact topics shown in the topic select. The empty string is the
 * "not chosen yet" placeholder state and is intentionally not a member —
 * the schema requires one of these values.
 */
export const CONTACT_TOPICS = ["general", "product", "billing", "security", "other"] as const
export type ContactTopic = (typeof CONTACT_TOPICS)[number]

export const CONTACT_TOPIC_LABELS: Record<ContactTopic, string> = {
  general: "General question",
  product: "Product or technical question",
  billing: "Billing or account",
  security: "Security or privacy",
  other: "Something else",
}

export const NEWSLETTER_SOURCE = "site-footer"

/** Hidden honeypot field name shared by every public form. */
export const HONEYPOT_FIELD = "website"
