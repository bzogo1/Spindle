import { describe, expect, it } from "vitest"
import { PNG } from "pngjs"

import { SnapshotDimensionError } from "./diff"
import { comparePerceptual } from "./perceptual"

function makePng(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b] = fill(x, y)
      png.data[i] = r
      png.data[i + 1] = g
      png.data[i + 2] = b
      png.data[i + 3] = 255
    }
  }
  return new Uint8Array(PNG.sync.write(png))
}

const solid = (r: number, g: number, b: number, w = 32, h = 32) => makePng(w, h, () => [r, g, b])

describe("comparePerceptual", () => {
  it("reports zero diff and SSIM 1 for identical images", () => {
    const img = solid(120, 80, 40)
    const result = comparePerceptual(img, img)
    expect(result.pixelDiffRatio).toBe(0)
    expect(result.meanLuminanceDelta).toBe(0)
    expect(result.ssim).toBeCloseTo(1, 1)
    expect(result.overlayPng.length).toBeGreaterThan(0)
    expect(result.heatmap.length).toBe(result.grid.columns * result.grid.rows)
    expect(result.heatmap.every((c) => c.diffRatio === 0)).toBe(true)
  })

  it("detects a luminance shift that pixelmatch might tolerate", () => {
    const base = solid(100, 100, 100)
    const lighter = solid(140, 140, 140)
    const result = comparePerceptual(lighter, base)
    expect(result.pixelDiffRatio).toBe(1)
    expect(result.meanLuminanceDelta).toBeGreaterThan(0.1)
    expect(result.ssim).toBeLessThan(1)
  })

  it("keeps SSIM high for a small localized change", () => {
    // Gradient baseline — flat images give SSIM a degenerate zero-variance
    // denominator, so use a realistic non-uniform capture.
    const base = makePng(32, 32, (x, y) => [x * 6, y * 6, (x + y) * 3])
    const actual = makePng(32, 32, (x, y) =>
      x < 4 && y < 4 ? [250, 250, 250] : [x * 6, y * 6, (x + y) * 3],
    )
    const result = comparePerceptual(actual, base)
    expect(result.pixelDiffRatio).toBeLessThan(0.1)
    // SSIM-lite is a single-window metric — assert it stays high relative to
    // a heavily changed pair rather than an absolute 0.9 bar.
    const inverted = comparePerceptual(
      makePng(32, 32, (x, y) => [255 - x * 6, 255 - y * 6, 255 - (x + y) * 3]),
      base,
    )
    expect(result.ssim).toBeGreaterThan(0.6)
    expect(result.ssim).toBeGreaterThan(inverted.ssim + 0.3)
    // Heatmap should localize the change to one corner cell.
    const hot = result.heatmap.filter((c) => c.diffRatio > 0.5)
    expect(hot.length).toBeGreaterThan(0)
    expect(hot.every((c) => c.col <= 1 && c.row <= 1)).toBe(true)
  })

  it("respects a custom epsilon", () => {
    const base = solid(100, 100, 100)
    const near = solid(108, 108, 108) // ~3% luma shift
    const strict = comparePerceptual(near, base, { epsilon: 0.01 })
    const lenient = comparePerceptual(near, base, { epsilon: 0.2 })
    expect(strict.pixelDiffRatio).toBeGreaterThan(0)
    expect(lenient.pixelDiffRatio).toBe(0)
  })

  it("throws SnapshotDimensionError on size mismatch", () => {
    const a = solid(0, 0, 0, 16, 16)
    const b = solid(0, 0, 0, 8, 8)
    expect(() => comparePerceptual(a, b)).toThrow(SnapshotDimensionError)
  })

  it("produces a tinted overlay PNG for changed regions", () => {
    const base = solid(0, 0, 0)
    const actual = solid(255, 255, 255)
    const result = comparePerceptual(actual, base, { tint: [255, 0, 0] })
    const decoded = PNG.sync.read(Buffer.from(result.overlayPng))
    let redish = 0
    for (let i = 0; i < decoded.data.length; i += 4) {
      if (decoded.data[i] > 100 && decoded.data[i + 1] < 100) redish++
    }
    expect(redish).toBeGreaterThan(0)
  })
})
