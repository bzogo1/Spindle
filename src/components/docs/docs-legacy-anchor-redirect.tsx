"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Hashes never reach the server, so old `/docs#quickstart` style links are
 * resolved here once the index page hydrates.
 */
export function DocsLegacyAnchorRedirect({ anchors }: { anchors: Record<string, string> }) {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return

    let decoded = hash
    try {
      decoded = decodeURIComponent(hash)
    } catch {
      // Keep the raw hash when it is not valid percent-encoding.
    }

    const target = anchors[decoded]
    if (target) router.replace(target)
  }, [anchors, router])

  return null
}
