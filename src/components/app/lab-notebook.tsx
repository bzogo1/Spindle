/**
 * Notebook export + rendering helpers for the Lab screen's JupyterLab pane.
 *
 * The backend has no notebook/kernel API yet, so these are client-side mock
 * helpers: template cells are serialized to `.ipynb` (nbformat 4), Markdown,
 * standalone HTML, or a minimal printable PDF, then downloaded via a Blob
 * anchor — same pattern as `project-activity-screen.tsx` exports.
 * `highlightNotebookCode` returns an HTML string whose `nb-*` token classes
 * are colored by the scoped `<style>` block in `notebook-view.tsx`.
 */

import {
  labNotebookToIpynb,
  type LabNotebookCell,
  type LabNotebookTable,
  type LabNotebookTemplate,
} from "./lab-mock"

export type NotebookTheme = "light" | "dark"

export type NotebookExportFormat = "ipynb" | "html" | "markdown" | "pdf"

export interface NotebookExportOption {
  id: NotebookExportFormat
  label: string
}

/** Formats offered by the notebook export select, in display order. */
export const NOTEBOOK_EXPORT_FORMATS: NotebookExportOption[] = [
  { id: "ipynb", label: "Jupyter (.ipynb)" },
  { id: "markdown", label: "Markdown (.md)" },
  { id: "html", label: "HTML (.html)" },
  { id: "pdf", label: "PDF (printable)" },
]

/** A reviewer comment pinned to a notebook cell (mock until comments persist). */
export interface NotebookComment {
  id: string
  cellId: string
  author: string
  text: string
  createdAt: string
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Case-insensitive match of a search term against a cell's source and its
 * text/table outputs — used by the notebook "search cells" filter. Comments
 * are matched separately by the caller.
 */
export function notebookCellMatches(cell: LabNotebookCell, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  if (cell.source.toLowerCase().includes(needle)) return true
  return cell.outputs.some((output) => {
    if (output.content.toLowerCase().includes(needle)) return true
    const table = output.table
    if (!table) return false
    return table.rows.some((row) =>
      table.columns.some((column) =>
        String(row[column.key] ?? "")
          .toLowerCase()
          .includes(needle),
      ),
    )
  })
}

/* -------------------------------------------------------------------------- */
/* Code highlighting                                                           */
/* -------------------------------------------------------------------------- */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
])

const PYTHON_CONSTANTS = new Set(["True", "False", "None"])

interface CodeToken {
  text: string
  className?: string
}

/** Split Python-ish source into string / comment / number / word tokens. */
function tokenizeNotebookCode(source: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const pattern =
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[^\n]*)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) tokens.push({ text: source.slice(last, match.index) })
    const full = match[0]
    const str = match[1]
    const comment = match[2]
    const num = match[3]
    const word = match[4]
    if (str !== undefined) tokens.push({ text: full, className: "nb-str" })
    else if (comment !== undefined) tokens.push({ text: full, className: "nb-com" })
    else if (num !== undefined) tokens.push({ text: full, className: "nb-num" })
    else if (word !== undefined) {
      if (PYTHON_CONSTANTS.has(word)) tokens.push({ text: full, className: "nb-const" })
      else if (PYTHON_KEYWORDS.has(word)) tokens.push({ text: full, className: "nb-kw" })
      else tokens.push({ text: full })
    }
    last = match.index + full.length
  }
  if (last < source.length) tokens.push({ text: source.slice(last) })
  return tokens
}

/**
 * Highlight a code cell's source into an HTML string with `nb-kw`, `nb-const`,
 * `nb-str`, `nb-num`, and `nb-com` span classes — rendered via
 * `dangerouslySetInnerHTML` and colored by the scoped theme styles in
 * `notebook-view.tsx`. `theme` is accepted for API symmetry; the classes are
 * theme-agnostic.
 */
export function highlightNotebookCode(source: string, _theme: NotebookTheme = "light"): string {
  return tokenizeNotebookCode(source)
    .map((token) => {
      const html = escapeHtml(token.text)
      return token.className ? `<span class="${token.className}">${html}</span>` : html
    })
    .join("")
}

/* -------------------------------------------------------------------------- */
/* Serializers                                                                 */
/* -------------------------------------------------------------------------- */

function markdownForCell(cell: LabNotebookCell): string {
  if (cell.kind === "markdown") return cell.source.trim()
  const lines = ["```python", cell.source, "```"]
  for (const output of cell.outputs) {
    const table = output.table
    if (output.kind === "table" && table) {
      const header = table.columns.map((column) => column.label).join(" | ")
      const divider = table.columns.map(() => "---").join(" | ")
      const body = table.rows.map((row) =>
        table.columns.map((column) => String(row[column.key] ?? "")).join(" | "),
      )
      lines.push("", header, divider, ...body)
    } else if (output.content) {
      lines.push("", "```", output.content, "```")
    }
  }
  return lines.join("\n")
}

function notebookToMarkdown(cells: LabNotebookCell[]): string {
  return `${cells.map(markdownForCell).join("\n\n")}\n`
}

function htmlForTable(table: LabNotebookTable): string {
  const head = table.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")
  const body = table.rows
    .map(
      (row) =>
        `<tr>${table.columns
          .map((column) => `<td>${escapeHtml(String(row[column.key] ?? ""))}</td>`)
          .join("")}</tr>`,
    )
    .join("")
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function htmlForCell(cell: LabNotebookCell, theme: NotebookTheme): string {
  if (cell.kind === "markdown") {
    const html = cell.source
      .split("\n")
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return ""
        if (trimmed.startsWith("#")) {
          const level = Math.min(6, trimmed.match(/^#+/)?.[0].length ?? 1)
          const text = escapeHtml(trimmed.replace(/^#+\s*/, ""))
          return `<h${level}>${text}</h${level}>`
        }
        return `<p>${escapeHtml(trimmed)}</p>`
      })
      .join("")
    return `<section class="nb-cell nb-md">${html}</section>`
  }
  const outputs = cell.outputs
    .map((output) => {
      if (output.kind === "table" && output.table) return htmlForTable(output.table)
      const kind = output.kind === "error" ? "error" : "out"
      return `<pre class="nb-${kind}">${escapeHtml(output.content)}</pre>`
    })
    .join("")
  return (
    `<section class="nb-cell nb-code">` +
    `<div class="nb-in">In [${cell.executionCount ?? ""}]</div>` +
    `<pre class="nb-source nb-code--${theme}"><code>${escapeHtml(cell.source)}</code></pre>` +
    outputs +
    `</section>`
  )
}

function notebookToHtml(
  template: LabNotebookTemplate,
  cells: LabNotebookCell[],
  theme: NotebookTheme,
): string {
  const title = escapeHtml(template.name)
  const body = cells.map((cell) => htmlForCell(cell, theme)).join("\n")
  return `<!doctype html>
<html lang="en" data-nb-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; color: #1c1917; background: #fafaf9; }
  .nb-cell { border: 1px solid #e7e5e4; border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; background: #fff; }
  .nb-md h1, .nb-md h2, .nb-md h3 { margin: 0.4em 0; }
  .nb-md p { margin: 0.4em 0; }
  .nb-in { font: 600 11px/1.4 ui-monospace, monospace; color: #0d9488; margin-bottom: 0.35rem; }
  pre { font: 12px/1.55 ui-monospace, SFMono-Regular, monospace; overflow-x: auto; background: #f5f5f4; border-radius: 8px; padding: 0.5rem 0.75rem; }
  .nb-source { border: none; background: transparent; padding: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 0.5rem; }
  th, td { border: 1px solid #e7e5e4; padding: 4px 8px; text-align: left; }
  th { background: #f5f5f4; }
  .nb-error { color: #b91c1c; }
  html[data-nb-theme="dark"] body { color: #e7e5e4; background: #1c1917; }
  html[data-nb-theme="dark"] .nb-cell { background: #292524; border-color: #44403c; }
  html[data-nb-theme="dark"] pre { background: #1c1917; }
  html[data-nb-theme="dark"] th { background: #292524; }
  html[data-nb-theme="dark"] th, html[data-nb-theme="dark"] td { border-color: #44403c; }
</style>
</head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>
`
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

const PDF_PAGE_WIDTH = 612
const PDF_PAGE_HEIGHT = 792
const PDF_MARGIN = 50
const PDF_LINE_HEIGHT = 13
const PDF_MAX_LINES = 52

function pdfLinesForCells(template: LabNotebookTemplate, cells: LabNotebookCell[]): string[] {
  const lines: string[] = [template.name, ""]
  for (const cell of cells) {
    if (cell.kind === "markdown") {
      for (const line of cell.source.split("\n")) {
        const trimmed = line.trim()
        if (trimmed) lines.push(trimmed.replace(/^#+\s*/, ""))
      }
    } else {
      lines.push(`In [${cell.executionCount ?? ""}]:`)
      for (const line of cell.source.split("\n")) lines.push(`    ${line}`)
      for (const output of cell.outputs) {
        if (output.kind === "table" && output.table) {
          lines.push(output.table.columns.map((column) => column.label).join("  "))
          for (const row of output.table.rows) {
            lines.push(
              output.table.columns
                .map((column) => String(row[column.key] ?? ""))
                .join("  "),
            )
          }
        } else if (output.content) {
          lines.push(output.content)
        }
      }
    }
    lines.push("")
  }
  return lines.slice(0, PDF_MAX_LINES)
}

/**
 * Notebook template + cells as a minimal single-page PDF (Helvetica, US
 * Letter). This is a mock stand-in for a real typeset export — enough for a
 * downloadable artifact until a server-side PDF renderer exists.
 */
function notebookToPdf(template: LabNotebookTemplate, cells: LabNotebookCell[]): string {
  const lines = pdfLinesForCells(template, cells)
  const textOps = lines.map((line) => `(${pdfEscape(line)}) Tj T*`).join("\n")
  const content = `BT /F1 10 Tf ${PDF_LINE_HEIGHT} TL ${PDF_MARGIN} ${PDF_PAGE_HEIGHT - PDF_MARGIN} Td\n${textOps}\nET`

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

const EXPORT_MIME: Record<NotebookExportFormat, string> = {
  ipynb: "application/x-ipynb+json",
  html: "text/html;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  pdf: "application/pdf",
}

const EXPORT_EXT: Record<NotebookExportFormat, string> = {
  ipynb: ".ipynb",
  html: ".html",
  markdown: ".md",
  pdf: ".pdf",
}

function templateForExport(
  cells: LabNotebookCell[],
  fileName: string,
  options: { title?: string },
): LabNotebookTemplate {
  const name = options.title ?? fileName.replace(/\.[^.]+$/, "")
  return { id: "export", name, description: "", fileName, cells }
}

/**
 * Serialize the notebook cells to the chosen format and trigger a browser
 * download — same Blob/anchor pattern as the activity and account exports.
 */
export function downloadNotebookExport(
  format: NotebookExportFormat,
  cells: LabNotebookCell[],
  fileName: string,
  options: { title?: string; theme?: NotebookTheme } = {},
): void {
  const theme = options.theme ?? "light"
  const template = templateForExport(cells, fileName, options)
  const base = fileName.replace(/\.[^.]+$/, "")

  let content: string
  switch (format) {
    case "ipynb":
      content = `${JSON.stringify(labNotebookToIpynb(cells), null, 1)}\n`
      break
    case "html":
      content = notebookToHtml(template, cells, theme)
      break
    case "markdown":
      content = notebookToMarkdown(cells)
      break
    case "pdf":
      content = notebookToPdf(template, cells)
      break
  }

  const blob = new Blob([content], { type: EXPORT_MIME[format] })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${base}${EXPORT_EXT[format]}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
