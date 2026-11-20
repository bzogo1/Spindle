import { describe, expect, it } from "vitest"

import { acceptableUseDocument } from "./acceptable-use"
import { cookiesDocument } from "./cookies"
import { dpaDocument } from "./dpa"
import { privacyDocument } from "./privacy"
import { subprocessors } from "./subprocessors"
import { termsDocument } from "./terms"
import type { LegalDocument, LegalInline, LegalParagraph } from "./types"

const documents: Record<string, LegalDocument> = {
  "terms-of-service": termsDocument,
  "privacy-policy": privacyDocument,
  "cookie-policy": cookiesDocument,
  "data-processing-addendum": dpaDocument,
  "acceptable-use": acceptableUseDocument,
}

function* paragraphs(doc: LegalDocument): Generator<LegalParagraph> {
  if (doc.summary) yield* doc.summary.bullets
  for (const section of doc.sections) {
    yield* section.paragraphs ?? []
    yield* section.bullets ?? []
    yield* section.closingParagraphs ?? []
    for (const subsection of section.subsections ?? []) {
      yield* subsection.paragraphs
      yield* subsection.bullets ?? []
    }
  }
  yield doc.previousVersions.intro
}

function* inlines(paragraph: LegalParagraph): Generator<LegalInline> {
  yield* Array.isArray(paragraph) ? paragraph : [paragraph]
}

function expectValidInlineLink(href: string) {
  // Internal routes, anchors, mailto, and absolute https URLs are all allowed;
  // javascript: and friends are not.
  expect(href).toMatch(/^(\/|#|mailto:|https:\/\/)/)
}

describe("legal documents", () => {
  it.each(Object.keys(documents))("%s has complete metadata and sections", (name) => {
    const doc = documents[name]

    expect(doc.title.length).toBeGreaterThan(0)
    expect(doc.lede.length).toBeGreaterThan(0)
    expect(doc.eyebrow.length).toBeGreaterThan(0)
    expect(doc.version).toMatch(/^\d+\.\d+$/)
    expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(doc.sections.length).toBeGreaterThan(0)
    expect(doc.contact.emails.length).toBeGreaterThan(0)
  })

  it.each(Object.keys(documents))("%s has unique section ids and valid tables", (name) => {
    const doc = documents[name]
    const ids = doc.sections.map((section) => section.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)

    for (const section of doc.sections) {
      if (!section.table) continue
      expect(section.table.caption.length).toBeGreaterThan(0)
      expect(section.table.columns.length).toBeGreaterThan(0)
      for (const row of section.table.rows) {
        expect(row).toHaveLength(section.table.columns.length)
      }
    }
  })

  it.each(Object.keys(documents))("%s only links to safe targets", (name) => {
    const doc = documents[name]

    for (const paragraph of paragraphs(doc)) {
      for (const inline of inlines(paragraph)) {
        if (typeof inline !== "string") expectValidInlineLink(inline.href)
      }
    }
  })

  it.each(Object.keys(documents))("%s contact emails are well-formed", (name) => {
    for (const { address } of documents[name].contact.emails) {
      expect(address).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    }
  })

  it("lists at least one subprocessor with a vendor, purpose, and location", () => {
    expect(subprocessors.length).toBeGreaterThan(0)
    for (const entry of subprocessors) {
      expect(entry.vendor.length).toBeGreaterThan(0)
      expect(entry.purpose.length).toBeGreaterThan(0)
      expect(entry.location.length).toBeGreaterThan(0)
      expect(entry.transfer.length).toBeGreaterThan(0)
    }
  })
})
