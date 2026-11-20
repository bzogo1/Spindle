/**
 * Perceptual-ish comparison for lab snapshots — a lightweight, dependency-free
 * complement to the pixel-exact pixelmatch diff.
 *
 * Computes:
 *  - `pixelDiffRatio`: fraction of pixels whose luminance delta exceeds `eps`
 *    (a perceptual threshold, not a color-exact one),
 *  - `meanLuminanceDelta`: average |Δluma| normalized to 0–1,
 *  - `ssim`: global SSIM-lite over the luminance channel (single-window,
 *    downsampled) — a coarse structural-similarity signal in [0, 1],
 *  - `heatmap`: a coarse grid of per-cell diff ratios for region heatmap
 *    overlays in the UI,
 *  - `overlayPng`: baseline image with perceptually-changed pixels tinted.
 *
 * Server/node-side only (pngjs). Not a substitute for `compareSnapshots` —
 * this answers "how different does it *look*", not "did any pixel change".
 */

import { PNG } from "pngjs"

import { SnapshotDimensionError, decodePng, encodePng } from "./diff"

export interface PerceptualOptions {
  /**
   * Luminance delta (0–1, Rec.601 luma normalized) above which a pixel counts
   * as perceptually changed. Default 0.05 — roughly a just-noticeable
   * brightness step; well below pixelmatch's color threshold for hue shifts.
   */
  epsilon?: number
  /** Heatmap grid columns (rows follow aspect ratio). Default 16. */
  gridColumns?: number
  /** Tint color [r,g,b] for changed pixels in `overlayPng`. Default red. */
  tint?: [number, number, number]
}

export interface HeatmapCell {
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  /** Fraction of cell pixels above `epsilon`. */
  diffRatio: number
  /** Mean absolute luminance delta in the cell, 0–1. */
  meanDelta: number
}

export interface PerceptualResult {
  width: number
  height: number
  /** Fraction of pixels with luminance delta > epsilon (0–1). */
  pixelDiffRatio: number
  /** Mean |Δluma| across all pixels, 0–1. */
  meanLuminanceDelta: number
  /** Global SSIM-lite over luminance, 0–1 (1 = identical structure). */
  ssim: number
  heatmap: HeatmapCell[]
  /** Grid dims for rendering the heatmap. */
  grid: { columns: number; rows: number }
  /** PNG: baseline with perceptually-changed pixels tinted. */
  overlayPng: Uint8Array
  options: Required<Pick<PerceptualOptions, "epsilon">>
}

/** Rec.601 luma, normalized to 0–1. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Decode both inputs and enforce identical dimensions. */
function decodePair(actual: Uint8Array, baseline: Uint8Array): { a: PNG; b: PNG } {
  const a = decodePng(actual)
  const b = decodePng(baseline)
  if (a.width !== b.width || a.height !== b.height) {
    throw new SnapshotDimensionError(
      { width: a.width, height: a.height },
      { width: b.width, height: b.height },
    )
  }
  return { a, b }
}

/**
 * Compare two same-size PNGs perceptually. Throws `SnapshotDimensionError`
 * on size mismatch (same contract as `compareSnapshots`).
 */
export function comparePerceptual(
  actual: Uint8Array,
  baseline: Uint8Array,
  options: PerceptualOptions = {},
): PerceptualResult {
  const epsilon = options.epsilon ?? 0.05
  const gridColumns = options.gridColumns ?? 16
  const tint = options.tint ?? [255, 0, 0]

  const { a, b } = decodePair(actual, baseline)
  const { width, height } = a
  const total = width * height

  // Per-pixel luminance delta + accumulators for global SSIM-lite.
  let changedPixels = 0
  let sumDelta = 0

  const overlay = new PNG({ width, height })
  overlay.data = Buffer.from(b.data) // start from baseline

  const cellCount = gridColumns * Math.max(1, Math.round((gridColumns * height) / width))
  const cellChanged = new Uint32Array(cellCount)
  const cellDeltaSum = new Float64Array(cellCount)
  const cellPixels = new Uint32Array(cellCount)
  const cellLumaA = new Float64Array(cellCount)
  const cellLumaB = new Float64Array(cellCount)
  const gridRows = Math.max(1, Math.round((gridColumns * height) / width))

  for (let y = 0; y < height; y++) {
    const row = Math.min(gridRows - 1, Math.floor((y * gridRows) / height))
    for (let x = 0; x < width; x++) {
      const col = Math.min(gridColumns - 1, Math.floor((x * gridColumns) / width))
      const cellIndex = row * gridColumns + col
      const i = (y * width + x) * 4

      const la = luminance(a.data[i], a.data[i + 1], a.data[i + 2])
      const lb = luminance(b.data[i], b.data[i + 1], b.data[i + 2])
      const delta = Math.abs(la - lb)

      sumDelta += delta
      cellDeltaSum[cellIndex] += delta
      cellPixels[cellIndex]++
      cellLumaA[cellIndex] += la
      cellLumaB[cellIndex] += lb

      if (delta > epsilon) {
        changedPixels++
        cellChanged[cellIndex]++
        // Tint the overlay at ~55% strength so the baseline stays readable.
        overlay.data[i] = Math.round(b.data[i] * 0.45 + tint[0] * 0.55)
        overlay.data[i + 1] = Math.round(b.data[i + 1] * 0.45 + tint[1] * 0.55)
        overlay.data[i + 2] = Math.round(b.data[i + 2] * 0.45 + tint[2] * 0.55)
      }
    }
  }

  // SSIM-lite: structural similarity over the grid's mean-luminance map.
  // Per-cell means act as a coarse downsample — stable on flat regions where
  // a single global window would degenerate (zero variance).
  const n = cellCount
  let sA = 0
  let sB = 0
  const meanACells = new Float64Array(n)
  const meanBCells = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const px = cellPixels[i] || 1
    meanACells[i] = cellLumaA[i] / px
    meanBCells[i] = cellLumaB[i] / px
    sA += meanACells[i]
    sB += meanBCells[i]
  }
  const muA = sA / n
  const muB = sB / n
  let va = 0
  let vb = 0
  let cov = 0
  for (let i = 0; i < n; i++) {
    const da = meanACells[i] - muA
    const db = meanBCells[i] - muB
    va += da * da
    vb += db * db
    cov += da * db
  }
  va /= n
  vb /= n
  cov /= n
  const C1 = 0.01 * 0.01
  const C2 = 0.03 * 0.03
  const ssim =
    ((2 * muA * muB + C1) * (2 * cov + C2)) / ((muA * muA + muB * muB + C1) * (va + vb + C2))

  const heatmap: HeatmapCell[] = []
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridColumns; col++) {
      const idx = row * gridColumns + col
      const x0 = Math.floor((col * width) / gridColumns)
      const x1 = Math.floor(((col + 1) * width) / gridColumns)
      const y0 = Math.floor((row * height) / gridRows)
      const y1 = Math.floor(((row + 1) * height) / gridRows)
      const px = cellPixels[idx] || 1
      heatmap.push({
        col,
        row,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        diffRatio: cellChanged[idx] / px,
        meanDelta: cellDeltaSum[idx] / px,
      })
    }
  }

  return {
    width,
    height,
    pixelDiffRatio: total === 0 ? 0 : changedPixels / total,
    meanLuminanceDelta: total === 0 ? 0 : sumDelta / total,
    ssim: Math.min(1, Math.max(0, ssim)),
    heatmap,
    grid: { columns: gridColumns, rows: gridRows },
    overlayPng: encodePng(overlay),
    options: { epsilon },
  }
}

/** Convenience wrapper for `SnapshotImage` pairs. */
export function comparePerceptualImages(
  actual: { png: Uint8Array },
  baseline: { png: Uint8Array },
  options?: PerceptualOptions,
): PerceptualResult {
  return comparePerceptual(actual.png, baseline.png, options)
}
