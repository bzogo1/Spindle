import { describe, expect, it } from "vitest"

import type { ChangelogRelease } from "@/lib/changelog"

import { composeReleaseNotesEmail } from "./release-notes"

const entry: ChangelogRelease = {
  slug: "x-1",
  version: "2.0",
  date: "2026-02-01",
  title: "Spindle 2.0 — <script>alert(1)</script>",
  summary: "A <b>bold</b> summary & more",
  tags: ["Release"],
  body: [
    { type: "paragraph", text: "Paragraph with <em>html</em> & entities." },
    {
      type: "list",
      items: [{ label: "Feature", text: "Does <script> things & stuff" }],
    },
  ],
}

describe("composeReleaseNotesEmail", () => {
  it("renders subject, text, and html for a single entry", () => {
    const email = composeReleaseNotesEmail([entry])
    expect(email.subject).toBe(entry.title)
    expect(email.text).toContain("2.0 — Spindle 2.0")
    expect(email.text).toContain("- Feature: Does <script> things & stuff")
    expect(email.text).toContain("Full notes: http")
    expect(email.html).toContain("<!doctype html>")
    expect(email.html).toContain("2.0 —")
  })

  it("HTML-escapes all entry content", () => {
    const email = composeReleaseNotesEmail([entry])
    expect(email.html).not.toContain("<script>alert(1)</script>")
    expect(email.html).not.toContain("<em>html</em>")
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(email.html).toContain("&lt;em&gt;html&lt;/em&gt;")
    expect(email.html).toContain("&amp;")
  })

  it("includes the entry summary in the HTML body, escaped", () => {
    const email = composeReleaseNotesEmail([entry])
    expect(email.html).toContain("A &lt;b&gt;bold&lt;/b&gt; summary &amp; more")
    expect(email.html).not.toContain("<b>bold</b> summary")
  })

  it("embeds the unsubscribe URL in the HTML footer and text footer", () => {
    const unsubscribeUrl = "https://spindle.example/unsubscribe?token=tok&email=a%40b.c"
    const email = composeReleaseNotesEmail([entry], { unsubscribeUrl })
    expect(email.html).toContain(">Unsubscribe</a>")
    expect(email.html).toContain("unsubscribe?token=tok&amp;email=a%40b.c")
    expect(email.text).toContain(`Unsubscribe: ${unsubscribeUrl}`)
  })

  it("omits the unsubscribe link when no URL is provided", () => {
    const email = composeReleaseNotesEmail([entry])
    expect(email.html).not.toContain(">Unsubscribe</a>")
    expect(email.text).not.toContain("Unsubscribe:")
  })

  it("escapes the optional userName in both renderings", () => {
    const email = composeReleaseNotesEmail([entry], { userName: "<b>Ada</b>" })
    expect(email.html).toContain("Hi &lt;b&gt;Ada&lt;/b&gt;,")
    expect(email.text).toContain("Hi <b>Ada</b>,")
  })

  it("uses a count-based subject and intro for multiple entries", () => {
    const second: ChangelogRelease = { ...entry, slug: "x-2", version: "1.9" }
    const email = composeReleaseNotesEmail([entry, second])
    expect(email.subject).toBe("Spindle release notes (2 updates)")
    expect(email.text).toContain("Here is what shipped")
  })

  it("handles an empty entry list gracefully", () => {
    const email = composeReleaseNotesEmail([])
    expect(email.subject).toBe("Spindle release notes")
    expect(email.text).toContain("no published release notes")
    expect(email.html).toContain("no published release notes")
  })
})
