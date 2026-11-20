/**
 * Heuristic "AI-style" analysis of snapshot diffs.
 *
 * No external AI: this is a rule-based analyzer that turns a `DiffResult`
 * (pixelmatch output + optional region grid) into:
 *
 *  - categorized findings (layout / visual / content / noise),
 *  - a 0–100 significance score,
 *  - rule-based natural-language-ish summary sentences.
 *
 * When `DiffResult.regions` is empty (no `regionColumns` was requested) the
 * analyzer derives its own coarse grid by scanning the diff PNG for the
 * pixelmatch highlight colors — enough spatial signal for categorization.
 *
 * Server/node-side only (pngjs via `./diff`).
 */

import { decodePng } from "./diff"
import type { DiffResult, RegionDiff } from "./types"

export type ChangeCategory = "layout" | "visual" | "content" | "noise"

export interface DiffFinding {
  category: ChangeCategory
  /** Human-readable explanation of why this was classified. */
  reason: string
  /** Weight 0–1 contributing to significance. */
  weight: number
  /** Region this finding is anchored to, when known. */
  region?: Pick<
    RegionDiff,
    "col" | "row" | "x" | "y" | "width" | "height" | "diffRatio" | "diffPixels"
  >
}

export interface CategoryBreakdown {
  category: ChangeCategory
  /** Fraction of total diff pixels attributed to this category (0–1). */
  share: number
  findings: number
}

export interface SnapshotAnalysis {
  /** Per-category attribution of the diff. */
  categories: CategoryBreakdown[]
  /** 0–100 — how much this diff matters. 0 = identical/noise, 100 = total rewrite. */
  significance: number
  /** Ordered, human-readable summary lines (rule-based templates). */
  summary: string[]
  findings: DiffFinding[]
  /** Grid stats used for classification (exposed for debugging/tests). */
  grid: { columns: number; rows: number; changedCells: number; totalCells: number }
}

export interface AnalyzeOptions {
  /**
   * Columns for the internal grid when `result.regions` is empty.
   * Default 8. Ignored when the diff already carries a region breakdown.
   */
  gridColumns?: number
  /** Highlight colors to scan for in the diff PNG (defaults match diff.ts). */
  diffColors?: [number, number, number][]
  /** Case/run name used in summary sentences. */
  name?: string
}

const DEFAULT_GRID_COLUMNS = 8
const DEFAULT_DIFF_COLORS: [number, number, number][] = [
  [255, 0, 0],
  // pixelmatch default alt color family; diff.ts defaults alt = diffColor, but
  // callers may pass a custom one — matching both keeps us robust.
  [255, 51, 85],
]

/** Fraction of a region's pixels that must differ before it counts as "hot". */
const HOT_CELL_RATIO = 0.05
/** Cells with diffRatio below this are treated as noise/AA residue. */
const NOISE_CELL_RATIO = 0.005
/** A cell is "edge" when it touches the image border. */

interface Cell {
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  diffPixels: number
  totalPixels: number
  diffRatio: number
}

function matchesColor(
  data: Uint8Array,
  offset: number,
  colors: [number, number, number][],
): boolean {
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  return colors.some(([cr, cg, cb]) => r === cr && g === cg && b === cb)
}

/**
 * Build a coarse diff grid by scanning the diff PNG for highlight colors.
 * Only used when the diff result has no `regions` of its own.
 */
function gridFromDiffPng(
  result: DiffResult,
  columns: number,
  colors: [number, number, number][],
): Cell[] {
  const png = decodePng(result.diffPng)
  const { width, height } = png
  const rows = Math.max(1, Math.round((columns * height) / width))
  const cells: Cell[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = Math.floor((col * width) / columns)
      const x1 = Math.floor(((col + 1) * width) / columns)
      const y0 = Math.floor((row * height) / rows)
      const y1 = Math.floor(((row + 1) * height) / rows)
      let diffPixels = 0
      let totalPixels = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          totalPixels++
          if (matchesColor(png.data, (y * width + x) * 4, colors)) diffPixels++
        }
      }
      cells.push({
        col,
        row,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        diffPixels,
        totalPixels,
        diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
      })
    }
  }
  return cells
}

function toCell(region: RegionDiff, _columns: number, _rows: number): Cell {
  return {
    col: region.col,
    row: region.row,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    diffPixels: region.diffPixels,
    totalPixels: region.totalPixels,
    diffRatio: region.diffRatio,
  }
}

function isEdgeCell(cell: Cell, columns: number, rows: number): boolean {
  return cell.col === 0 || cell.row === 0 || cell.col === columns - 1 || cell.row === rows - 1
}

function isTopStrip(cell: Cell, rows: number): boolean {
  return cell.row === 0 && rows > 1
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}

/**
 * Analyze a snapshot diff and produce categorized findings, a significance
 * score, and a plain-language summary.
 */
export function analyzeSnapshotDiff(
  result: DiffResult,
  options: AnalyzeOptions = {},
): SnapshotAnalysis {
  const columns = options.gridColumns ?? DEFAULT_GRID_COLUMNS
  const colors = options.diffColors ?? DEFAULT_DIFF_COLORS
  const name = options.name ? `"${options.name}"` : "the snapshot"

  let cells: Cell[]
  let gridColumns: number
  let gridRows: number
  if (result.regions.length > 0) {
    // Infer grid dims from the region indices.
    gridColumns = Math.max(...result.regions.map((r) => r.col)) + 1
    gridRows = Math.max(...result.regions.map((r) => r.row)) + 1
    cells = result.regions.map((r) => toCell(r, gridColumns, gridRows))
  } else {
    cells = gridFromDiffPng(result, columns, colors)
    gridColumns = columns
    gridRows = Math.max(...cells.map((c) => c.row)) + 1
  }

  const findings: DiffFinding[] = []
  const hot = cells.filter((c) => c.diffRatio >= HOT_CELL_RATIO && c.diffPixels > 0)
  const warm = cells.filter(
    (c) => c.diffRatio > NOISE_CELL_RATIO && c.diffRatio < HOT_CELL_RATIO && c.diffPixels > 0,
  )
  const totalCells = cells.length
  const changedCells = cells.filter((c) => c.diffPixels > 0).length

  // --- Layout signals: edge cells + top strip dominate the diff. ---
  const edgeHot = hot.filter((c) => isEdgeCell(c, gridColumns, gridRows))
  const topHot = hot.filter((c) => isTopStrip(c, gridRows))
  const edgeShare =
    result.diffPixels === 0
      ? 0
      : edgeHot.reduce((sum, c) => sum + c.diffPixels, 0) / result.diffPixels
  const topShare =
    result.diffPixels === 0
      ? 0
      : topHot.reduce((sum, c) => sum + c.diffPixels, 0) / result.diffPixels

  if (edgeShare >= 0.5 && edgeHot.length > 0) {
    findings.push({
      category: "layout",
      reason: `${pct(edgeShare)} of changed pixels sit on image edges/borders — consistent with layout, spacing, or chrome changes rather than content edits.`,
      weight: Math.min(1, edgeShare * 1.5),
      region: edgeHot[0],
    })
  }
  if (topShare >= 0.4 && topHot.length > 0) {
    findings.push({
      category: "layout",
      reason: `${pct(topShare)} of changed pixels are in the top strip — likely a header, nav, or title-area change.`,
      weight: Math.min(1, topShare * 1.5),
      region: topHot[0],
    })
  }

  // --- Content signals: one or a few contiguous hot interior cells. ---
  const interiorHot = hot.filter(
    (c) => !isEdgeCell(c, gridColumns, gridRows) && !isTopStrip(c, gridRows),
  )
  if (interiorHot.length > 0 && interiorHot.length <= Math.max(2, Math.ceil(totalCells * 0.25))) {
    const worst = interiorHot.reduce((a, b) => (b.diffRatio > a.diffRatio ? b : a))
    findings.push({
      category: "content",
      reason: `Changes concentrate in ${interiorHot.length} interior region${interiorHot.length === 1 ? "" : "s"} (peak cell diff ${pct(worst.diffRatio)}) — a localized content block changed.`,
      weight: Math.min(1, 0.4 + worst.diffRatio),
      region: worst,
    })
  } else if (interiorHot.length > Math.ceil(totalCells * 0.25)) {
    findings.push({
      category: "content",
      reason: `Changes span ${interiorHot.length} interior regions — broad content change across the capture.`,
      weight: Math.min(1, interiorHot.length / totalCells + result.diffRatio),
    })
  }

  // --- Visual signals: many warm cells, low peak ratio — color/AA-level churn. ---
  if (
    warm.length >= Math.ceil(totalCells * 0.3) &&
    (hot.length === 0 || warm.length > hot.length * 2)
  ) {
    findings.push({
      category: "visual",
      reason: `${warm.length} regions show low-level pixel churn (${pct(result.diffRatio)} overall) — likely color, anti-aliasing, or sub-pixel rendering drift rather than structural edits.`,
      weight: Math.min(1, warm.length / totalCells),
    })
  }

  // --- Noise floor: nothing meaningful changed. ---
  if (result.diffPixels === 0 || (hot.length === 0 && warm.length <= 2)) {
    findings.push({
      category: "noise",
      reason:
        result.diffPixels === 0
          ? "No pixels differ from baseline."
          : `Only ${result.diffPixels} pixel(s) differ — below classification thresholds, treated as noise.`,
      weight: 0,
    })
  }

  // --- Significance score (0–100). ---
  // Diff ratio contributes on a log-ish scale; concentration and coverage add.
  const ratioScore = Math.min(1, result.diffRatio * 20) // 5% diff ≈ max
  const coverage = changedCells / totalCells
  const concentration = hot.length === 0 ? 0 : Math.max(...hot.map((c) => c.diffRatio))
  const raw =
    ratioScore * 45 +
    Math.min(1, coverage * 1.5) * 25 +
    Math.min(1, concentration * 2) * 20 +
    Math.min(1, findings.filter((f) => f.category === "content").length) * 10
  const significance = Math.round(Math.min(100, Math.max(0, raw)))

  // --- Category attribution: split diff pixels across findings' categories. ---
  // NOTE: a cell can anchor more than one finding (e.g. a top-row cell is both
  // "edge" and "top strip"), so raw pixel sums may double-count. Shares are
  // normalized over the attributed total, so overlaps distort proportions but
  // never inflate the overall diff — acceptable for a heuristic breakdown.
  const categoryPixels = new Map<ChangeCategory, number>()
  for (const f of findings) {
    if (f.category === "noise") continue
    const px = f.region ? (f.region.diffPixels ?? 0) : Math.round(result.diffPixels * f.weight)
    categoryPixels.set(f.category, (categoryPixels.get(f.category) ?? 0) + px)
  }
  const attributed = [...categoryPixels.values()].reduce((a, b) => a + b, 0)
  const categories: CategoryBreakdown[] = [...categoryPixels.entries()].map(([category, px]) => ({
    category,
    share: attributed === 0 ? 0 : px / attributed,
    findings: findings.filter((f) => f.category === category).length,
  }))
  if (categories.length === 0) {
    categories.push({ category: "noise", share: 1, findings: findings.length })
  }

  // --- Summary sentences (rule-based templates). ---
  const summary: string[] = []
  summary.push(
    `${name}: ${result.diffPixels.toLocaleString()} of ${result.totalPixels.toLocaleString()} pixels differ (${pct(result.diffRatio)}) across ${changedCells}/${totalCells} regions — significance ${significance}/100.`,
  )
  const layoutFindings = findings.filter((f) => f.category === "layout")
  const contentFindings = findings.filter((f) => f.category === "content")
  const visualFindings = findings.filter((f) => f.category === "visual")
  if (layoutFindings.length > 0) {
    summary.push(`Layout impact: ${layoutFindings.map((f) => f.reason).join(" ")}`)
  }
  if (contentFindings.length > 0) {
    summary.push(`Content impact: ${contentFindings.map((f) => f.reason).join(" ")}`)
  }
  if (visualFindings.length > 0) {
    summary.push(`Visual impact: ${visualFindings.map((f) => f.reason).join(" ")}`)
  }
  if (findings.every((f) => f.category === "noise")) {
    summary.push("Verdict: no meaningful visual change detected.")
  } else if (significance >= 70) {
    summary.push("Verdict: major visual change — review the diff image before approving.")
  } else if (significance >= 30) {
    summary.push("Verdict: moderate change — likely intentional, but verify affected regions.")
  } else {
    summary.push("Verdict: minor change — probably cosmetic or noise-level.")
  }

  return {
    categories,
    significance,
    summary,
    findings,
    grid: { columns: gridColumns, rows: gridRows, changedCells, totalCells },
  }
}
