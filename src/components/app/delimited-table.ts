/**
 * Minimal delimited-text (CSV/TSV) parser for the file preview drawer.
 *
 * Handles double-quoted fields (including embedded delimiters, newlines, and
 * `""` escapes) and caps the number of data rows parsed so very large files
 * do not block the UI.
 */

export const DELIMITED_MAX_ROWS = 200

export interface ParsedTable {
  /** First record of the file, used as column headers. */
  headers: string[]
  /** Remaining records, each padded/truncated to `headers.length` cells. */
  rows: string[][]
  /** True when the source had more data rows than `DELIMITED_MAX_ROWS`. */
  truncated: boolean
}

interface RawRecord {
  fields: string[]
}

function parseRecords(source: string, delimiter: string, maxRecords: number) {
  const records: RawRecord[] = []
  let fields: string[] = []
  let field = ""
  let inQuotes = false
  let atFieldStart = true
  let truncated = false

  const pushField = () => {
    fields.push(field)
    field = ""
    atFieldStart = true
  }
  const pushRecord = () => {
    pushField()
    // Skip fully empty trailing records produced by a final newline.
    if (fields.length > 1 || fields[0] !== "") {
      records.push({ fields })
      if (records.length >= maxRecords) truncated = true
    }
    fields = []
  }

  for (let index = 0; index < source.length; index += 1) {
    if (records.length >= maxRecords) {
      truncated = true
      break
    }
    const char = source[index]

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
      continue
    }
    if (char === delimiter) {
      pushField()
      continue
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1
      pushRecord()
      continue
    }
    field += char
    atFieldStart = false
  }

  // Flush the final record when the file does not end with a newline.
  if (!truncated && (field !== "" || fields.length > 0 || records.length === 0)) {
    pushRecord()
  }

  return { records, truncated }
}

export function parseDelimitedTable(source: string, delimiter: string): ParsedTable {
  // Parse at most header + DELIMITED_MAX_ROWS data rows.
  const { records, truncated } = parseRecords(source, delimiter, DELIMITED_MAX_ROWS + 1)

  if (records.length === 0) {
    return { headers: [], rows: [], truncated: false }
  }

  const [headerRecord, ...dataRecords] = records
  const columnCount = Math.max(
    headerRecord.fields.length,
    ...dataRecords.map((record) => record.fields.length),
    0,
  )

  const normalize = (fields: string[]) => {
    const cells = fields.slice(0, columnCount)
    while (cells.length < columnCount) cells.push("")
    return cells
  }

  return {
    headers: normalize(headerRecord.fields),
    rows: dataRecords.map((record) => normalize(record.fields)),
    truncated,
  }
}
