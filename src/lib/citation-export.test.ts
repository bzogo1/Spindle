import { describe, expect, it } from "vitest"

import {
  citationYear,
  serializeCitations,
  toBibtex,
  toCsv,
  toRis,
  type CitationItem,
} from "./citation-export"

const ITEMS: CitationItem[] = [
  {
    title: "Create your first workspace",
    url: "https://spindle.app/help/create-your-first-workspace",
    excerpt: "Workspaces are where projects live.",
    author: "Spindle",
    publisher: "Spindle",
    date: "2025-11-02",
    type: "Getting started",
  },
  {
    title: 'Invoices & "billing" cycles',
    url: "https://spindle.app/help/billing",
    date: "2024",
  },
]

describe("citationYear", () => {
  it("extracts a four-digit year from ISO dates and bare years", () => {
    expect(citationYear("2025-11-02")).toBe("2025")
    expect(citationYear("2024")).toBe("2024")
    expect(citationYear(undefined)).toBeUndefined()
    expect(citationYear("not a date")).toBeUndefined()
  })
})

describe("toBibtex", () => {
  it("emits one @online entry per item with deduplicated keys", () => {
    const bibtex = toBibtex([
      ...ITEMS,
      { title: "Create your first workspace", url: "https://spindle.app/x" },
    ])
    const entries = bibtex.match(/@online\{/g) ?? []
    expect(entries).toHaveLength(3)
    expect(bibtex).toContain("@online{create-your-first-workspace,")
    expect(bibtex).toContain("title = {Create your first workspace},")
    expect(bibtex).toContain("year = {2025},")
    expect(bibtex).toContain("url = {https://spindle.app/help/create-your-first-workspace},")
    // Duplicate title gets a suffixed key.
    expect(bibtex).toContain("@online{create-your-first-workspace-2,")
  })

  it("escapes braces inside field values", () => {
    const bibtex = toBibtex([{ title: "A {nested} title", url: "https://x.test" }])
    expect(bibtex).toContain("title = {A \\{nested\\} title},")
  })
})

describe("toRis", () => {
  it("emits RIS records with WEB type and ER terminator", () => {
    const ris = toRis(ITEMS)
    expect(ris).toContain("TY  - WEB")
    expect(ris).toContain("TI  - Create your first workspace")
    expect(ris).toContain("AU  - Spindle")
    expect(ris).toContain("PY  - 2025")
    expect(ris).toContain("UR  - https://spindle.app/help/create-your-first-workspace")
    expect(ris).toContain("Y1  - 2025-11-02")
    expect(ris.trimEnd().endsWith("ER  -")).toBe(true)
    // Two records separated by a blank line.
    expect(ris).toContain("ER  - \n\nTY  - WEB")
  })
})

describe("toCsv", () => {
  it("writes a header row and quotes fields containing commas or quotes", () => {
    const csv = toCsv(ITEMS)
    const lines = csv.trim().split("\r\n")
    expect(lines[0]).toBe("Title,Author,Year,Type,Publisher,URL,Abstract")
    expect(lines[1]).toContain("Create your first workspace")
    expect(lines[2]).toContain('"Invoices & ""billing"" cycles"')
    expect(csv.endsWith("\r\n")).toBe(true)
  })
})

describe("serializeCitations", () => {
  it("dispatches to the right serializer per format", () => {
    expect(serializeCitations("bibtex", ITEMS)).toContain("@online{")
    expect(serializeCitations("ris", ITEMS)).toContain("TY  - WEB")
    expect(serializeCitations("csv", ITEMS)).toContain("Title,Author")
  })
})
