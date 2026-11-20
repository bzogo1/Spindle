import { describe, expect, it } from "vitest"

import {
  buildShareUrl,
  canUseNativeShare,
  sanitizeHashtags,
  SHARE_PLATFORM_IDS,
  SHARE_TARGETS,
  trackShareClick,
  URL_SHARE_PLATFORMS,
} from "./social-share"

const URL = "https://spindle.app/r/SPN-ABCD-EFGH?utm_source=referral"

function queryOf(href: string): URLSearchParams {
  const qIndex = href.indexOf("?")
  return new URLSearchParams(qIndex >= 0 ? href.slice(qIndex + 1) : "")
}

describe("buildShareUrl", () => {
  it("covers every url platform in SHARE_TARGETS", () => {
    const urlTargets = SHARE_TARGETS.filter((t) => t.kind === "url").map((t) => t.id)
    expect([...URL_SHARE_PLATFORMS].sort()).toEqual(urlTargets.sort())
    for (const id of URL_SHARE_PLATFORMS) {
      expect(SHARE_PLATFORM_IDS).toContain(id)
    }
  })

  it("builds an X intent with encoded text, url, and hashtags", () => {
    const href = buildShareUrl("x", {
      url: URL,
      text: "Try Spindle & co — it's free",
      hashtags: ["spindle", "#research", "research"],
    })
    expect(href.startsWith("https://twitter.com/intent/tweet?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("text")).toBe("Try Spindle & co — it's free")
    expect(params.get("url")).toBe(URL)
    // "#" stripped, deduped.
    expect(params.get("hashtags")).toBe("spindle,research")
  })

  it("percent-encodes reserved characters in the shared url", () => {
    const href = buildShareUrl("x", { url: "https://spindle.app/r/SPN-ABCD-EFGH?a=1&b=2" })
    const params = queryOf(href)
    expect(params.get("url")).toBe("https://spindle.app/r/SPN-ABCD-EFGH?a=1&b=2")
    // The raw href must not contain an unencoded & inside the url value.
    expect(href).toContain("url=https%3A%2F%2Fspindle.app%2Fr%2FSPN-ABCD-EFGH%3Fa%3D1%26b%3D2")
  })

  it("builds a LinkedIn share-offsite url (url param only)", () => {
    const href = buildShareUrl("linkedin", { url: URL, text: "ignored", hashtags: ["x"] })
    expect(href.startsWith("https://www.linkedin.com/sharing/share-offsite/?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("url")).toBe(URL)
    expect(params.get("text")).toBeNull()
    expect(params.get("hashtags")).toBeNull()
  })

  it("builds a Facebook sharer url with u and quote", () => {
    const href = buildShareUrl("facebook", {
      url: URL,
      text: "A research workspace",
      hashtags: ["spindle"],
    })
    expect(href.startsWith("https://www.facebook.com/sharer/sharer.php?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("u")).toBe(URL)
    expect(params.get("quote")).toBe("A research workspace #spindle")
  })

  it("builds a WhatsApp wa.me url with text then link", () => {
    const href = buildShareUrl("whatsapp", { url: URL, text: "Join me" })
    expect(href.startsWith("https://wa.me/?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("text")).toBe(`Join me\n${URL}`)
  })

  it("builds a Telegram share url", () => {
    const href = buildShareUrl("telegram", { url: URL, text: "Try this" })
    expect(href.startsWith("https://t.me/share/url?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("url")).toBe(URL)
    expect(params.get("text")).toBe("Try this")
  })

  it("builds a mailto url with subject and body containing the link", () => {
    const href = buildShareUrl("email", {
      url: URL,
      text: "Give Spindle a try",
      subject: "Research workspace invite",
    })
    expect(href.startsWith("mailto:?")).toBe(true)
    const params = queryOf(href)
    expect(params.get("subject")).toBe("Research workspace invite")
    expect(params.get("body")).toContain(URL)
    expect(params.get("body")).toContain("Give Spindle a try")
  })

  it("omits optional params when text/hashtags are absent", () => {
    for (const platform of URL_SHARE_PLATFORMS) {
      const href = buildShareUrl(platform, { url: URL })
      expect(href).toBeTruthy()
      const params = queryOf(href)
      // Every platform must still carry the shared url somewhere.
      const serialized = [...params.values()].join(" ")
      expect(serialized).toContain(URL)
    }
  })

  it("rejects non-https and non-absolute urls", () => {
    const bad = [
      "http://spindle.app/r/SPN-ABCD-EFGH",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "//spindle.app/r/SPN-ABCD-EFGH",
      "/r/SPN-ABCD-EFGH",
      "not a url",
      "",
    ]
    for (const platform of URL_SHARE_PLATFORMS) {
      for (const url of bad) {
        expect(() => buildShareUrl(platform, { url })).toThrow()
      }
    }
  })

  it("never emits javascript: or data: endpoints", () => {
    for (const platform of URL_SHARE_PLATFORMS) {
      const href = buildShareUrl(platform, { url: URL, text: "hi" })
      expect(href).not.toMatch(/javascript:|data:/i)
    }
  })
})

describe("sanitizeHashtags", () => {
  it("strips #, drops invalid chars, dedupes and caps", () => {
    expect(sanitizeHashtags(["#one", "two!", "one", "", "   ", "a b"])).toEqual([
      "one",
      "two",
      "ab",
    ])
  })

  it("caps at five tags", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"]
    expect(sanitizeHashtags(many)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("returns [] for undefined", () => {
    expect(sanitizeHashtags(undefined)).toEqual([])
  })
})

describe("canUseNativeShare", () => {
  it("is false in jsdom (no navigator.share)", () => {
    expect(canUseNativeShare()).toBe(false)
  })
})

describe("trackShareClick", () => {
  it("is a safe no-op without window/fetch", () => {
    expect(() => trackShareClick("x", "SPN-ABCD-EFGH")).not.toThrow()
  })
})
