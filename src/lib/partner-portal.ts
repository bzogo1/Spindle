/**
 * Partner portal: per-affiliate portal profile extensions, announcements,
 * and resource links for approved (`active`) affiliates.
 *
 * DEVELOPMENT SEAM: state lives in process-local `Map`s, the same
 * interim-store pattern as `affiliate.ts` / `announcements.ts`. On
 * serverless or multi-instance deploys each instance keeps its own copy —
 * portal data is lost on restart and is not shared between instances. The
 * upgrade path is `PartnerProfile` / `PartnerAnnouncement` /
 * `PartnerResourceLink` tables keyed by `affiliateId`; the exported
 * function signatures are already shaped for that swap.
 *
 * PRIVACY: this store holds ONLY non-sensitive labels and status flags —
 * a payout method *label* ("PayPal", "Bank transfer") and a coarse tax
 * info status. Bank details, account/routing numbers, SSNs, and tax IDs
 * must NEVER be stored here; the API schema rejects unknown fields
 * outright and the TypeScript types expose no field that could carry
 * them. There are no real payouts.
 *
 * Server-only in practice: imported by route handlers and API tests;
 * client components must not import it.
 */

/** Coarse, non-sensitive tax-documentation status. Never stores the documents. */
export type PartnerTaxInfoStatus = "not_submitted" | "submitted" | "verified"

export const PARTNER_TAX_INFO_STATUSES: readonly PartnerTaxInfoStatus[] = [
  "not_submitted",
  "submitted",
  "verified",
]

/** Who a portal announcement is visible to. */
export type PartnerAnnouncementAudience = "all" | "active"

export const PARTNER_ANNOUNCEMENT_AUDIENCES: readonly PartnerAnnouncementAudience[] = [
  "all",
  "active",
]

export interface PartnerProfile {
  /** Owning affiliate account id (`AffiliateAccount.id`). */
  affiliateId: string
  /**
   * Human-readable payout method label only — e.g. "PayPal", "Wise",
   * "Bank transfer via partner". NEVER an account, routing, card, or
   * wallet number.
   */
  payoutMethodLabel?: string
  taxInfoStatus: PartnerTaxInfoStatus
  /** ISO timestamp — record creation time. */
  createdAt: string
  /** ISO timestamp — last profile update. */
  updatedAt: string
}

export interface PartnerAnnouncement {
  id: string
  title: string
  body: string
  /** `"all"` = every partner-facing status the portal reports on; `"active"` = approved partners only. */
  audience: PartnerAnnouncementAudience
  /** ISO timestamp — when the admin published it. */
  publishedAt: string
  /** ISO timestamp — record creation time. */
  createdAt: string
}

export interface PartnerResourceLink {
  id: string
  title: string
  /** Internal path (`/...`) or absolute `https://` URL. */
  url: string
  description?: string
  /** ISO timestamp — record creation time. */
  createdAt: string
}

export interface UpdatePartnerProfileInput {
  /** `null` clears the label; `undefined` leaves it unchanged. */
  payoutMethodLabel?: string | null
  taxInfoStatus?: PartnerTaxInfoStatus
}

/** Hard caps so the in-memory store cannot grow without bound. */
export const PARTNER_PROFILES_STORE_MAX = 1_000
export const PARTNER_ANNOUNCEMENTS_STORE_MAX = 500
export const PARTNER_LINKS_STORE_MAX = 200

export const PARTNER_PAYOUT_LABEL_MAX = 80
export const PARTNER_ANNOUNCEMENT_TITLE_MAX = 200
export const PARTNER_ANNOUNCEMENT_BODY_MAX = 5_000
export const PARTNER_LINK_TITLE_MAX = 120
export const PARTNER_LINK_URL_MAX = 500
export const PARTNER_LINK_DESCRIPTION_MAX = 500

const profiles = new Map<string, PartnerProfile>() // affiliateId → profile
const announcements: PartnerAnnouncement[] = []
const links = new Map<string, PartnerResourceLink>() // id → link

function announcementId(): string {
  return `pan_${crypto.randomUUID()}`
}

function linkId(): string {
  return `prl_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Thrown for invalid partner-portal mutations (bad status enum, bad URL). */
export class PartnerPortalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PartnerPortalError"
  }
}

/**
 * The partner's portal profile extension, or null when they have never
 * customized the portal (the API returns a default view in that case).
 */
export function getPartnerProfile(affiliateId: string): PartnerProfile | null {
  return profiles.get(affiliateId.trim()) ?? null
}

/**
 * Creates or updates the partner's portal profile. Missing fields keep
 * their current values; `payoutMethodLabel: null` clears the label.
 * First-time creation starts with `taxInfoStatus: "not_submitted"` unless
 * provided. Throws `PartnerPortalError` on an invalid tax status or when
 * the store is at capacity and no profile exists yet.
 */
export function updatePartnerProfile(
  affiliateId: string,
  input: UpdatePartnerProfileInput,
): PartnerProfile {
  const id = affiliateId.trim()
  if (!id) throw new PartnerPortalError("An affiliate id is required.")
  if (
    input.taxInfoStatus !== undefined &&
    !PARTNER_TAX_INFO_STATUSES.includes(input.taxInfoStatus)
  ) {
    throw new PartnerPortalError("Invalid tax info status.")
  }

  const existing = profiles.get(id)
  if (!existing && profiles.size >= PARTNER_PROFILES_STORE_MAX) {
    throw new PartnerPortalError("The partner portal is currently at capacity.")
  }

  const now = nowIso()
  const label =
    input.payoutMethodLabel === undefined
      ? existing?.payoutMethodLabel
      : input.payoutMethodLabel === null
        ? undefined
        : input.payoutMethodLabel.trim() || undefined
  if (label && label.length > PARTNER_PAYOUT_LABEL_MAX) {
    throw new PartnerPortalError("Payout method label is too long.")
  }

  const profile: PartnerProfile = {
    affiliateId: id,
    taxInfoStatus: input.taxInfoStatus ?? existing?.taxInfoStatus ?? "not_submitted",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(label ? { payoutMethodLabel: label } : {}),
  }
  profiles.set(id, profile)
  return profile
}

/**
 * Publishes a portal announcement to partners. Bounded: when the store is
 * full the oldest announcement is evicted (same policy as
 * `createAnnouncement` in `announcements.ts`).
 */
export function createPartnerAnnouncement(input: {
  title: string
  body: string
  audience?: PartnerAnnouncementAudience
}): PartnerAnnouncement {
  const title = input.title.trim()
  const body = input.body.trim()
  if (!title) throw new PartnerPortalError("Title is required.")
  if (!body) throw new PartnerPortalError("Body is required.")
  if (title.length > PARTNER_ANNOUNCEMENT_TITLE_MAX) {
    throw new PartnerPortalError("Title is too long.")
  }
  if (body.length > PARTNER_ANNOUNCEMENT_BODY_MAX) {
    throw new PartnerPortalError("Body is too long.")
  }
  const audience = input.audience ?? "all"
  if (!PARTNER_ANNOUNCEMENT_AUDIENCES.includes(audience)) {
    throw new PartnerPortalError("Invalid announcement audience.")
  }

  const now = nowIso()
  const announcement: PartnerAnnouncement = {
    id: announcementId(),
    title,
    body,
    audience,
    publishedAt: now,
    createdAt: now,
  }
  if (announcements.length >= PARTNER_ANNOUNCEMENTS_STORE_MAX) announcements.shift()
  announcements.push(announcement)
  return announcement
}

/**
 * All stored portal announcements, newest first (admin + partner views).
 * `reverse()` before the stable sort makes same-millisecond publishes
 * resolve to most-recently-created first.
 */
export function listPartnerAnnouncements(): PartnerAnnouncement[] {
  return [...announcements].reverse().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/**
 * Audiences visible on the partner portal. Every portal viewer is an
 * `active` affiliate, so both current audiences ("all", "active") are
 * shown. This is an explicit allowlist, not a passthrough: if a narrower
 * audience value is added later it stays hidden until listed here —
 * the predicate fails closed.
 */
const PORTAL_VISIBLE_AUDIENCES: ReadonlySet<string> = new Set(["all", "active"])

/** Whether an announcement audience is visible to a partner-portal viewer. */
export function isPartnerAnnouncementVisibleOnPortal(audience: string): boolean {
  return PORTAL_VISIBLE_AUDIENCES.has(audience)
}

/**
 * Base origin used to resolve internal resource-link paths. Any value
 * works — the check only requires the resolved URL to stay on it.
 */
const INTERNAL_LINK_BASE = "https://partner-portal.invalid"

/**
 * Whether `url` is a safe internal path. Mirrors the affiliate click
 * route's `safeRedirectTarget`: backslashes and ASCII control characters
 * are rejected because WHATWG URL parsing treats `\` as `/` in special
 * schemes, so `/\evil.com` (and `/\\evil.com`, `/\tevil.com`, ...) would
 * resolve cross-origin despite the leading "/". As a belt-and-suspenders
 * check the path is then resolved and must stay on the internal base
 * origin — this also rejects `//host` and exotic inputs.
 */
function isSafeInternalLinkPath(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === "\\" || code < 0x20 || code === 0x7f) return false
  }
  try {
    return new URL(url, INTERNAL_LINK_BASE).origin === new URL(INTERNAL_LINK_BASE).origin
  } catch {
    return false
  }
}

/**
 * Adds a resource link shown on the partner portal. `url` must be an
 * internal path (no protocol-relative `//host`, no backslashes or control
 * characters that WHATWG parsing would turn cross-origin) or an absolute
 * `https://` URL — same rule as announcement CTAs.
 */
export function createPartnerResourceLink(input: {
  title: string
  url: string
  description?: string
}): PartnerResourceLink {
  const title = input.title.trim()
  const url = input.url.trim()
  const description = input.description?.trim()
  if (!title) throw new PartnerPortalError("Title is required.")
  if (title.length > PARTNER_LINK_TITLE_MAX) {
    throw new PartnerPortalError("Title is too long.")
  }
  if (!url || url.length > PARTNER_LINK_URL_MAX) {
    throw new PartnerPortalError("A valid URL is required.")
  }
  const isInternal = url.startsWith("/") && !url.startsWith("//")
  const isHttps = url.startsWith("https://")
  if ((!isInternal || !isSafeInternalLinkPath(url)) && !isHttps) {
    throw new PartnerPortalError("URL must be an internal path or an https:// link.")
  }
  if (description && description.length > PARTNER_LINK_DESCRIPTION_MAX) {
    throw new PartnerPortalError("Description is too long.")
  }

  // Bounded capacity: evict the oldest link (Map preserves insertion order).
  if (links.size >= PARTNER_LINKS_STORE_MAX) {
    const oldest = links.keys().next().value
    if (oldest !== undefined) links.delete(oldest)
  }

  const link: PartnerResourceLink = {
    id: linkId(),
    title,
    url,
    ...(description ? { description } : {}),
    createdAt: nowIso(),
  }
  links.set(link.id, link)
  return link
}

/**
 * All resource links, newest first. `reverse()` before the stable sort
 * makes same-millisecond creations resolve to most-recently-created first.
 */
export function listPartnerResourceLinks(): PartnerResourceLink[] {
  return [...links.values()].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Test hook: clears all partner-portal profiles, announcements, and links. */
export function clearPartnerPortalStoreForTests(): void {
  profiles.clear()
  announcements.length = 0
  links.clear()
}
