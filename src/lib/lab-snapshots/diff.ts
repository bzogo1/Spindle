/**
 * Pixel-perfect visual diff for lab run snapshots, built on pixelmatch + pngjs.
 *
 * Server/node-side only — pngjs is a Node library. Do not import this from
 * client components; the UI consumes pre-rendered diff PNGs instead.
 */

import { PNG } from "pngjs"
// pixelmatch is ESM-only in v8; a dynamic-free default import works under the
// project's bundler/tsx/vitest resolution.
import pixelmatch from "pixelmatch"

import type { DiffOptions, DiffResult, MaskRegion, RegionDiff, SnapshotImage } from "./types"

export class SnapshotDimensionError extends Error {
  constructor(
    public readonly actual: { width: number; height: number },
    public readonly baseline: { width: number; height: number },
  ) {
    super(
      `Snapshot size mismatch: actual ${actual.width}x${actual.height} vs baseline ${baseline.width}x${baseline.height}`,
    )
    this.name = "SnapshotDimensionError"
  }
}

export function decodePng(png: Uint8Array): PNG {
  return PNG.sync.read(Buffer.from(png))
}

export function encodePng(image: PNG): Uint8Array {
  return new Uint8Array(PNG.sync.write(image))
}

/**
 * Build a pixelmatch `ignoreMask` (one byte per pixel, non-zero = skip) from
 * a list of rectangles. Used to exclude dynamic regions (timestamps, live
 * counters) from comparison.
 */
export function buildIgnoreMask(width: number, height: number, regions: MaskRegion[]): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (const region of regions) {
    const x0 = Math.max(0, Math.min(width, Math.floor(region.x)))
    const y0 = Math.max(0, Math.min(height, Math.floor(region.y)))
    const x1 = Math.max(x0, Math.min(width, Math.ceil(region.x + region.width)))
    const y1 = Math.max(y0, Math.min(height, Math.ceil(region.y + region.height)))
    for (let y = y0; y < y1; y++) {
      mask.fill(1, y * width + x0, y * width + x1)
    }
  }
  return mask
}

/** Count diff pixels per grid cell by scanning the diff output for the
 * highlight colors. Unchanged pixels are drawn grayscale and AA pixels use
 * `aaColor`, so an exact match on `diffColor`/`diffColorAlt` is reliable. */
function countRegionDiffs(
  diffData: Uint8Array,
  width: number,
  height: number,
  columns: number,
  diffColor: [number, number, number],
  diffColorAlt: [number, number, number],
  ignoreMask: Uint8Array | null,
): RegionDiff[] {
  const rows = Math.max(1, Math.round((columns * height) / width))
  const regions: RegionDiff[] = []
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
          const i = y * width + x
          if (ignoreMask && ignoreMask[i]) continue
          totalPixels++
          const p = i * 4
          const r = diffData[p]
          const g = diffData[p + 1]
          const b = diffData[p + 2]
          if (
            (r === diffColor[0] && g === diffColor[1] && b === diffColor[2]) ||
            (r === diffColorAlt[0] && g === diffColorAlt[1] && b === diffColorAlt[2])
          ) {
            diffPixels++
          }
        }
      }
      regions.push({
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
  return regions
}

/**
 * Compare an actual capture against a baseline image.
 *
 * Both inputs are PNG buffers of identical dimensions — a size mismatch
 * throws `SnapshotDimensionError` (callers should treat that as a hard fail).
 */
export function compareSnapshots(
  actual: Uint8Array,
  baseline: Uint8Array,
  options: DiffOptions = {},
): DiffResult {
  const threshold = options.threshold ?? 0.1
  const maxDiffRatio = options.maxDiffRatio ?? 0
  const includeAA = options.includeAA ?? false
  const diffColor = options.diffColor ?? [255, 0, 0]
  const diffColorAlt = options.diffColorAlt ?? diffColor

  const actualPng = decodePng(actual)
  const baselinePng = decodePng(baseline)

  if (actualPng.width !== baselinePng.width || actualPng.height !== baselinePng.height) {
    throw new SnapshotDimensionError(
      { width: actualPng.width, height: actualPng.height },
      { width: baselinePng.width, height: baselinePng.height },
    )
  }

  const { width, height } = actualPng
  const ignoreMask =
    options.maskRegions && options.maskRegions.length > 0
      ? buildIgnoreMask(width, height, options.maskRegions)
      : null

  // pixelmatch writes the visualization into `output`; we pass a fresh buffer
  // cloned from the baseline so unchanged pixels render as a dimmed baseline.
  const output = new PNG({ width, height })
  output.data = Buffer.from(baselinePng.data)

  const diffPixels = pixelmatch(actualPng.data, baselinePng.data, output.data, width, height, {
    threshold,
    includeAA,
    diffColor,
    diffColorAlt,
    ignoreMask: ignoreMask ?? undefined,
  })

  const totalPixels = width * height
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels

  const regions =
    options.regionColumns && options.regionColumns > 0
      ? countRegionDiffs(
          output.data,
          width,
          height,
          options.regionColumns,
          diffColor,
          diffColorAlt,
          ignoreMask,
        )
      : []

  return {
    pass: diffRatio <= maxDiffRatio,
    diffPixels,
    totalPixels,
    diffRatio,
    diffPng: encodePng(output),
    regions,
    options: { threshold, maxDiffRatio, includeAA },
  }
}

/** Convenience wrapper for `SnapshotImage` pairs. */
export function compareSnapshotImages(
  actual: SnapshotImage,
  baseline: SnapshotImage,
  options?: DiffOptions,
): DiffResult {
  return compareSnapshots(actual.png, baseline.png, options)
}
