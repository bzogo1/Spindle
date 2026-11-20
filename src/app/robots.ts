import type { MetadataRoute } from "next"

import { siteUrl } from "@/lib/changelog"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Token-bearing recovery pages are never useful in search results.
      // Authenticated app routes and API endpoints are also private.
      disallow: [
        "/reset-password",
        "/verify-email",
        "/magic-link",
        "/sign-in",
        "/sign-up",
        "/oauth/callback",
        "/app",
        "/dashboard",
        "/projects",
        "/api",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
