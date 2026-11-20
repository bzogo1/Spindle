import { describe, expect, it } from "vitest"

import {
  changelogReleases,
  formatReleaseDate,
  getRelease,
  getReleaseAnchor,
  getReleasePath,
  getReleaseUrl,
  type ChangelogRelease,
} from "./changelog"

describe("changelog helpers", () => {
  it("formats release dates in UTC", () => {
    expect(formatReleaseDate("2026-11-19")).toBe("November 19, 2026")
    expect(formatReleaseDate("2026-01-01")).toBe("January 1, 2026")
  })

  it("derives a stable anchor from the slug", () => {
    const release = { slug: "1-0" } as ChangelogRelease
    expect(getReleaseAnchor(release)).toBe("release-1-0")
  })

  it("finds releases by slug", () => {
    expect(getRelease("1-0")?.version).toBe("1.0")
    expect(getRelease("does-not-exist")).toBeUndefined()
  })

  it("builds the dedicated permalink path and absolute URL", () => {
    const release = { slug: "1-0" } as ChangelogRelease

    expect(getReleasePath(release)).toBe("/changelog/1-0")
    expect(getReleaseUrl(release)).toMatch(/^https?:\/\/.+\/changelog\/1-0$/)
  })

  it("keeps release data internally consistent", () => {
    const slugs = new Set<string>()

    for (const release of changelogReleases) {
      expect(slugs.has(release.slug)).toBe(false)
      slugs.add(release.slug)

      expect(release.slug).toMatch(/^[a-z0-9-]+$/)
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(release.title.length).toBeGreaterThan(0)
      expect(release.summary.length).toBeGreaterThan(0)
      expect(release.body.length).toBeGreaterThan(0)

      if (release.media) {
        expect(release.media.width).toBeGreaterThan(0)
        expect(release.media.height).toBeGreaterThan(0)
        expect(release.media.alt.length).toBeGreaterThan(0)
      }
    }
  })
})
