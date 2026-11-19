import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Token-bearing recovery pages are never useful in search results.
      disallow: ["/reset-password", "/verify-email"],
    },
  }
}
