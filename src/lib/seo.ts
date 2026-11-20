import type { Metadata } from "next"

import { siteUrl } from "@/lib/changelog"

export const siteName = "Spindle"

export const defaultSiteDescription =
  "Spindle gives every research project its own home: files, a live lab, local search, automations, an agent, and real-time team collaboration. 5 GB free."

export type PageMetadataOptions = {
  /** Full document title, e.g. "Pricing — Spindle". */
  title: string
  description: string
  /** Site-relative canonical path, e.g. "/pricing". */
  path: string
  /** Open Graph type. Defaults to "website". */
  type?: "website" | "article"
  /** ISO 8601 timestamps, only meaningful for `type: "article"`. */
  publishedTime?: string
  modifiedTime?: string
}

/**
 * Builds the standard public-page metadata block: canonical URL, Open Graph,
 * and a `summary_large_image` Twitter card. `metadataBase` is set from
 * `NEXT_PUBLIC_SITE_URL` so relative OG URLs resolve correctly.
 *
 * Social images come from the nearest `opengraph-image` file convention —
 * Next.js injects them into `openGraph.images`/`twitter.images` as long as
 * the page doesn't set `images` itself.
 */
export function createPageMetadata({
  title,
  description,
  path,
  type = "website",
  publishedTime,
  modifiedTime,
}: PageMetadataOptions): Metadata {
  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName,
      type,
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  }
}
