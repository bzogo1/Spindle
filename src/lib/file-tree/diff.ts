/**
 * Client-side line diffing for the file-tree diff panel.
 *
 * `diffLines(oldText, newText)` computes an LCS-based line diff and returns
 * a flat list of rows (`context` | `add` | `del`) ready for rendering.
 * Line endings are normalised to `\n`; the diff is computed on exact lines.
 */

export type DiffLineType = "context" | "add" | "del"

export interface DiffLine {
  type: DiffLineType
  /** Line content without the trailing newline. */
  text: string
  /** 1-based line number in the old file (`del`/`context`), null for `add`. */
  oldLine: number | null
  /** 1-based line number in the new file (`add`/`context`), null for `del`. */
  newLine: number | null
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const normalized = text.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  // A trailing newline produces a final empty element that isn't a real line.
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

/**
 * Classic LCS dynamic-programming diff. O(n*m) in memory — fine for the
 * file sizes a tree diff panel handles; very large files should be paged by
 * the caller before diffing.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const n = a.length
  const m = b.length

  // lcs[i][j] = length of LCS of a[i:] and b[j:]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i], oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null })
      i += 1
    } else {
      out.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null })
    i += 1
  }
  while (j < m) {
    out.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 })
    j += 1
  }
  return out
}

export interface FileDiff {
  lines: DiffLine[]
  added: number
  removed: number
  changed: boolean
}

export function diffFileContents(oldText: string, newText: string): FileDiff {
  const lines = diffLines(oldText, newText)
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === "add") added += 1
    else if (line.type === "del") removed += 1
  }
  return { lines, added, removed, changed: added > 0 || removed > 0 }
}
