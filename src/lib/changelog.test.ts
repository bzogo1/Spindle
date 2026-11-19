import { describe, expect, it } from "vitest"

import {
  formatReleaseDate,
  getReleaseAnchor,
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

  it("builds an absolute permalink for the feed", () => {
    const url = getReleaseUrl({ slug: "1-0" } as ChangelogRelease)

    expect(url).toMatch(/^https?:\/\/.+\/changelog#release-1-0$/)
  })
})
