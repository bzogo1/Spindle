/** A run of legal copy. A string renders as text; an object renders as a link. */
export type LegalInline = string | { text: string; href: string }

export type LegalParagraph = LegalInline | LegalInline[]

/** A titled group of copy inside a section, rendered under an h3. */
export type LegalSubsection = {
  title: string
  paragraphs: LegalParagraph[]
  bullets?: LegalParagraph[]
}

/** A simple table rendered inside a section, with horizontally scrollable cells. */
export type LegalTable = {
  /** Accessible name for the table. */
  caption: string
  columns: string[]
  rows: string[][]
}

export type LegalSection = {
  /** Anchor used by the table of contents. */
  id: string
  title: string
  paragraphs?: LegalParagraph[]
  bullets?: LegalParagraph[]
  subsections?: LegalSubsection[]
  table?: LegalTable
  /** Copy rendered after bullets and any table, such as a closing note. */
  closingParagraphs?: LegalParagraph[]
}

export type LegalVersion = {
  version: string
  /** ISO date, formatted for display by the legal layout. */
  effectiveDate: string
  note?: string
  /** Set for superseded versions that remain available at their own URL. */
  href?: string
}

/** A template or signed copy offered as a file download. */
export type LegalDownload = {
  /** Short name of the document, shown as the download heading. */
  label: string
  description: string
  /** Path to the file in `public/`. */
  href: string
  /** File type and format, shown next to the download action. */
  meta: string
  version: string
  /** ISO date, formatted for display by the legal layout. */
  effectiveDate: string
}

export type LegalDocument = {
  eyebrow: string
  title: string
  lede: string
  version: string
  /** ISO date, formatted for display by the legal layout. */
  effectiveDate: string
  /** Files offered from the hero, such as a countersignable template. */
  downloads?: LegalDownload[]
  /** Optional plain-language summary shown before the numbered sections. */
  summary?: {
    title: string
    bullets: LegalParagraph[]
  }
  sections: LegalSection[]
  previousVersions: {
    intro: LegalParagraph
    entries: LegalVersion[]
  }
  contact: {
    intro: string
    emails: { label: string; address: string }[]
  }
}
