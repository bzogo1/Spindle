import { describe, expect, it } from "vitest"

import { changelogReleases, getReleaseAnchor, getReleasePath } from "@/lib/changelog"

import { createChangelogProvider } from "./providers"

describe("createChangelogProvider", () => {
  it("links each release to its permalink path with anchor fallback", async () => {
    const items = await createChangelogProvider().load()

    expect(items).toHaveLength(changelogReleases.length)
    for (const item of items) {
      const release = changelogReleases.find(
        (entry) => entry.slug === item.id.replace(/^changelog:/, ""),
      )
      expect(release).toBeDefined()
      // Mirrors the provider's href logic: permalink first, anchor fallback.
      expect(item.href).toBe(getReleasePath(release!) || `/changelog#${getReleaseAnchor(release!)}`)
      expect(item.href).toMatch(/^\/changelog(\/[a-z0-9-]+|#release-[a-z0-9-]+)$/)
    }
  })
})
