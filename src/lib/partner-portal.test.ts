// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  PARTNER_ANNOUNCEMENTS_STORE_MAX,
  PARTNER_LINKS_STORE_MAX,
  PARTNER_PAYOUT_LABEL_MAX,
  PARTNER_PROFILES_STORE_MAX,
  PARTNER_TAX_INFO_STATUSES,
  PartnerPortalError,
  clearPartnerPortalStoreForTests,
  createPartnerAnnouncement,
  createPartnerResourceLink,
  getPartnerProfile,
  isPartnerAnnouncementVisibleOnPortal,
  listPartnerAnnouncements,
  listPartnerResourceLinks,
  updatePartnerProfile,
} from "./partner-portal"

beforeEach(() => {
  clearPartnerPortalStoreForTests()
})

describe("updatePartnerProfile / getPartnerProfile", () => {
  it("creates a profile with a safe default tax status", () => {
    const profile = updatePartnerProfile("aff_1", { payoutMethodLabel: "PayPal" })

    expect(profile.affiliateId).toBe("aff_1")
    expect(profile.payoutMethodLabel).toBe("PayPal")
    expect(profile.taxInfoStatus).toBe("not_submitted")
    expect(profile.createdAt).toBeTruthy()
    expect(profile.updatedAt).toBeTruthy()
    expect(getPartnerProfile("aff_1")).toEqual(profile)
  })

  it("returns null for an unknown affiliate", () => {
    expect(getPartnerProfile("aff_missing")).toBeNull()
  })

  it("updates fields without clobbering unset ones and clears the label on null", () => {
    updatePartnerProfile("aff_1", { payoutMethodLabel: "Wise", taxInfoStatus: "submitted" })
    const updated = updatePartnerProfile("aff_1", { taxInfoStatus: "verified" })

    expect(updated.payoutMethodLabel).toBe("Wise")
    expect(updated.taxInfoStatus).toBe("verified")

    const cleared = updatePartnerProfile("aff_1", { payoutMethodLabel: null })
    expect(cleared.payoutMethodLabel).toBeUndefined()
    expect(cleared.taxInfoStatus).toBe("verified")
    expect(cleared.createdAt).toBe(updated.createdAt)
  })

  it("rejects an invalid tax info status", () => {
    expect(() =>
      updatePartnerProfile("aff_1", {
        // @ts-expect-error — runtime guard for untyped callers
        taxInfoStatus: "approved",
      }),
    ).toThrow(PartnerPortalError)
  })

  it("rejects a payout method label over PARTNER_PAYOUT_LABEL_MAX", () => {
    expect(() =>
      updatePartnerProfile("aff_1", {
        payoutMethodLabel: "x".repeat(PARTNER_PAYOUT_LABEL_MAX + 1),
      }),
    ).toThrow(PartnerPortalError)
    // Boundary: exactly at the cap is allowed.
    expect(() =>
      updatePartnerProfile("aff_1", {
        payoutMethodLabel: "x".repeat(PARTNER_PAYOUT_LABEL_MAX),
      }),
    ).not.toThrow()
  })

  it("enforces the profile store bound for new profiles only", () => {
    for (let i = 0; i < PARTNER_PROFILES_STORE_MAX; i += 1) {
      updatePartnerProfile(`aff_${i}`, {})
    }
    expect(() => updatePartnerProfile("aff_overflow", {})).toThrow(/capacity/)
    // Existing profiles remain updatable at capacity.
    expect(() => updatePartnerProfile("aff_0", { taxInfoStatus: "submitted" })).not.toThrow()
  })
})

describe("partner announcements", () => {
  it("creates and lists announcements newest first with a default audience", () => {
    const first = createPartnerAnnouncement({ title: "One", body: "First" })
    const second = createPartnerAnnouncement({
      title: "Two",
      body: "Second",
      audience: "active",
    })

    expect(first.audience).toBe("all")
    expect(second.audience).toBe("active")
    expect(listPartnerAnnouncements().map((a) => a.id)).toEqual([second.id, first.id])
  })

  it("rejects empty titles/bodies and invalid audiences", () => {
    expect(() => createPartnerAnnouncement({ title: "  ", body: "x" })).toThrow(/Title/)
    expect(() => createPartnerAnnouncement({ title: "t", body: "" })).toThrow(/Body/)
    expect(() =>
      createPartnerAnnouncement({
        title: "t",
        body: "b",
        // @ts-expect-error — runtime guard for untyped callers
        audience: "everyone",
      }),
    ).toThrow(/audience/)
  })

  it("evicts the oldest announcement at capacity", () => {
    for (let i = 0; i < PARTNER_ANNOUNCEMENTS_STORE_MAX; i += 1) {
      createPartnerAnnouncement({ title: `t${i}`, body: "b" })
    }
    createPartnerAnnouncement({ title: "overflow", body: "b" })
    const list = listPartnerAnnouncements()
    expect(list).toHaveLength(PARTNER_ANNOUNCEMENTS_STORE_MAX)
    expect(list[0].title).toBe("overflow")
    expect(list.some((a) => a.title === "t0")).toBe(false)
  })
})

describe("partner resource links", () => {
  it("creates links and lists them newest first", () => {
    const first = createPartnerResourceLink({ title: "Guide", url: "/docs/guide" })
    const second = createPartnerResourceLink({
      title: "Brand kit",
      url: "https://example.com/brand",
      description: "Logos and colors",
    })

    expect(listPartnerResourceLinks().map((l) => l.id)).toEqual([second.id, first.id])
    expect(second.description).toBe("Logos and colors")
  })

  it("rejects unsafe or malformed URLs", () => {
    expect(() =>
      createPartnerResourceLink({ title: "t", url: "http://insecure.example.com" }),
    ).toThrow(/https/)
    expect(() => createPartnerResourceLink({ title: "t", url: "//evil.example.com" })).toThrow(
      /internal path/,
    )
    expect(() => createPartnerResourceLink({ title: "t", url: "javascript:alert(1)" })).toThrow()
    expect(() => createPartnerResourceLink({ title: "t", url: "" })).toThrow(/URL/)
  })

  it("rejects internal paths that WHATWG parsing would resolve cross-origin", () => {
    // `/\evil.com` (and doubled backslashes / control chars) start with
    // "/" but `new URL()` treats `\` as `/` in special schemes, producing
    // https://evil.com — same bypass the affiliate click route guards.
    for (const url of [
      "/\\evil.com",
      "/\\\\evil.com",
      "/\\tevil.com",
      "/\nevil.com",
      "//evil.com",
      "javascript:alert(1)",
    ]) {
      expect(() => createPartnerResourceLink({ title: "t", url })).toThrow(PartnerPortalError)
    }
    // Sanity: a plain internal path still works.
    expect(() => createPartnerResourceLink({ title: "t", url: "/docs/guide" })).not.toThrow()
  })

  it("evicts the oldest link at capacity", () => {
    for (let i = 0; i < PARTNER_LINKS_STORE_MAX; i += 1) {
      createPartnerResourceLink({ title: `l${i}`, url: "/x" })
    }
    createPartnerResourceLink({ title: "overflow", url: "/y" })
    const list = listPartnerResourceLinks()
    expect(list).toHaveLength(PARTNER_LINKS_STORE_MAX)
    expect(list[0].title).toBe("overflow")
  })
})

describe("isPartnerAnnouncementVisibleOnPortal", () => {
  it("shows both current audiences and fails closed on unknown ones", () => {
    // Every portal viewer is an active affiliate, so "all" and "active"
    // are both visible today.
    expect(isPartnerAnnouncementVisibleOnPortal("all")).toBe(true)
    expect(isPartnerAnnouncementVisibleOnPortal("active")).toBe(true)
    // A future audience value must be added to the allowlist deliberately;
    // anything else stays hidden.
    expect(isPartnerAnnouncementVisibleOnPortal("vip")).toBe(false)
    expect(isPartnerAnnouncementVisibleOnPortal("")).toBe(false)
  })
})

describe("clearPartnerPortalStoreForTests", () => {
  it("clears profiles, announcements, and links", () => {
    updatePartnerProfile("aff_1", {})
    createPartnerAnnouncement({ title: "t", body: "b" })
    createPartnerResourceLink({ title: "l", url: "/x" })

    clearPartnerPortalStoreForTests()

    expect(getPartnerProfile("aff_1")).toBeNull()
    expect(listPartnerAnnouncements()).toHaveLength(0)
    expect(listPartnerResourceLinks()).toHaveLength(0)
  })
})

describe("PARTNER_TAX_INFO_STATUSES", () => {
  it("exposes only non-sensitive coarse statuses", () => {
    expect(PARTNER_TAX_INFO_STATUSES).toEqual(["not_submitted", "submitted", "verified"])
  })
})
