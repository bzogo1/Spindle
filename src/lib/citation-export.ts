/**
 * Citation export — serializes a list of citable items (search results,
 * help articles, docs pages) into BibTeX, RIS, or CSV and triggers a
 * browser download.
 *
 * The serializers are pure functions so they can be unit-tested and reused
 * anywhere; `downloadCitations` is the only DOM-touching helper and no-ops
 * during SSR.
 */

export type CitationItem = {
  /** Display title of the cited work. */
  title: string
  /** Absolute or site-relative URL of the work. */
  url: string
  /** Short abstract/summary, used for BibTeX `note` and RIS `AB`. */
  excerpt?: string
  /** Author or organisation credited for the work. */
  author?: string
  /**
   * Publication/update date — ISO `YYYY-MM-DD` or a bare `YYYY` year.
   * Used for the BibTeX `year`, RIS `PY`/`Y1`, and CSV `Year` fields.
   */
  date?: string
  /** Work type/category label, e.g. "Help article" or a category title. */
  type?: string
  /** Publisher/organisation, e.g. "Spindle". */
  publisher?: string
}

export type CitationFormat = "bibtex" | "ris" | "csv"

export const CITATION_FORMATS: readonly {
  key: CitationFormat
  label: string
  extension: string
  mimeType: string
}[] = [
  { key: "bibtex", label: "BibTeX (.bib)", extension: "bib", mimeType: "application/x-bibtex" },
  {
    key: "ris",
    label: "RIS (.ris)",
    extension: "ris",
    mimeType: "application/x-research-info-systems",
  },
  { key: "csv", label: "CSV (.csv)", extension: "csv", mimeType: "text/csv" },
]

function formatMeta(format: CitationFormat) {
  return CITATION_FORMATS.find((entry) => entry.key === format)!
}

/** Extracts a four-digit year from an ISO date or bare year string. */
export function citationYear(date?: string): string | undefined {
  if (!date) return undefined
  const match = /(\d{4})/.exec(date)
  return match?.[1]
}

function citationKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "citation"
}

function bibtexValue(value: string): string {
  // Balance braces inside the wrapping pair so titles containing { or }
  // don't corrupt the entry.
  return value.replace(/\\/g, "\\\\").replace(/([{}])/g, "\\$1")
}

/** Serializes items as a BibTeX `@online` entry per item. */
export function toBibtex(items: readonly CitationItem[]): string {
  const seen = new Map<string, number>()
  return items
    .map((item) => {
      const base = citationKey(item.title)
      const occurrences = seen.get(base) ?? 0
      seen.set(base, occurrences + 1)
      const key = occurrences === 0 ? base : `${base}-${occurrences + 1}`

      const fields: [string, string | undefined][] = [
        ["title", item.title],
        ["author", item.author ?? item.publisher],
        ["year", citationYear(item.date)],
        ["url", item.url],
        [
          "note",
          [item.type, item.excerpt].filter(Boolean).join(" — ") || undefined,
        ],
      ]

      const body = fields
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([name, value]) => `  ${name} = {${bibtexValue(value)}},`)
        .join("\n")

      return `@online{${key},\n${body}\n}\n`
    })
    .join("\n")
}

/** Serializes items as RIS records (TY - WEB). */
export function toRis(items: readonly CitationItem[]): string {
  return items
    .map((item) => {
      const lines = [
        "TY  - WEB",
        `TI  - ${item.title}`,
        item.author ?? item.publisher ? `AU  - ${item.author ?? item.publisher}` : undefined,
        citationYear(item.date) ? `PY  - ${citationYear(item.date)}` : undefined,
        item.excerpt ? `AB  - ${item.excerpt}` : undefined,
        `UR  - ${item.url}`,
        item.publisher ? `PB  - ${item.publisher}` : undefined,
        item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? `Y1  - ${item.date}` : undefined,
        item.type ? `KW  - ${item.type}` : undefined,
        "ER  - ",
      ]
      return lines.filter((line): line is string => Boolean(line)).join("\n")
    })
    .join("\n\n")
}

function csvCell(value: string | undefined): string {
  if (value === undefined) return ""
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const CSV_HEADER = ["Title", "Author", "Year", "Type", "Publisher", "URL", "Abstract"]

/** Serializes items as CSV with a header row. */
export function toCsv(items: readonly CitationItem[]): string {
  const rows = items.map((item) =>
    [
      item.title,
      item.author ?? item.publisher,
      citationYear(item.date),
      item.type,
      item.publisher,
      item.url,
      item.excerpt,
    ]
      .map(csvCell)
      .join(","),
  )
  return [CSV_HEADER.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n"
}

export function serializeCitations(format: CitationFormat, items: readonly CitationItem[]): string {
  switch (format) {
    case "bibtex":
      return toBibtex(items)
    case "ris":
      return toRis(items)
    case "csv":
      return toCsv(items)
  }
}

function slugifyFileName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "citations"
  )
}

/**
 * Generates the citation file in the chosen format and triggers a browser
 * download. Returns false when there is nothing to export or when called
 * outside the browser.
 */
export function downloadCitations(
  format: CitationFormat,
  items: readonly CitationItem[],
  options: { fileName?: string } = {},
): boolean {
  if (items.length === 0 || typeof document === "undefined") return false

  const meta = formatMeta(format)
  const content = serializeCitations(format, items)
  const blob = new Blob([content], { type: `${meta.mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${slugifyFileName(options.fileName ?? "citations")}.${meta.extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  // Defer revocation so the download has time to start in every browser.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
