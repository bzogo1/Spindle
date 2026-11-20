import { clientEnv } from "@/lib/env"

const fallbackSiteUrl = "https://spindle.app"

/**
 * Public site origin used for absolute links in emails, feeds, metadata,
 * and sharing URLs. Single source of truth — do not re-declare fallbacks
 * elsewhere.
 */
export const siteUrl = (clientEnv.NEXT_PUBLIC_SITE_URL ?? fallbackSiteUrl).replace(/\/+$/, "")
