import { describe, expect, it } from "vitest"
import { PNG } from "pngjs"

import { SnapshotDimensionError, buildIgnoreMask, compareSnapshots } from "./diff"

function makePng(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number?],
): Uint8Array {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b, a = 255] = fill(x, y)
      png.data[i] = r
      png.data[i + 1] = g
      png.data[i + 2] = b
      png.data[i + 3] = a
    }
  }
  return new Uint8Array(PNG.sync.write(png))
}

const solid = (r: number, g: number, b: number) => makePng(16, 16, () => [r, g, b])

describe("compareSnapshots", () => {
  it("passes for identical images with zero diff pixels", () => {
    const img = solid(10, 20, 30)
    const result = compareSnapshots(img, img)
    expect(result.pass).toBe(true)
    expect(result.diffPixels).toBe(0)
    expect(result.diffRatio).toBe(0)
    expect(result.diffPng.length).toBeGreaterThan(0)
  })

  it("counts a single changed pixel and fails by default", () => {
    const base = makePng(16, 16, () => [0, 0, 0])
    const actual = makePng(16, 16, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : [0, 0, 0]))
    const result = compareSnapshots(actual, base)
    expect(result.pass).toBe(false)
    expect(result.diffPixels).toBe(1)
    expect(result.diffRatio).toBeCloseTo(1 / 256)
  })

  it("respects maxDiffRatio for pass/fail", () => {
    const base = makePng(16, 16, () => [0, 0, 0])
    const actual = makePng(16, 16, (x, y) => (x < 4 && y < 4 ? [255, 255, 255] : [0, 0, 0]))
    // 16/256 = 0.0625 diff ratio
    const strict = compareSnapshots(actual, base)
    expect(strict.pass).toBe(false)
    const lenient = compareSnapshots(actual, base, { maxDiffRatio: 0.1 })
    expect(lenient.pass).toBe(true)
    expect(lenient.diffPixels).toBe(16)
  })

  it("tolerates sub-threshold color differences", () => {
    const base = makePng(8, 8, () => [100, 100, 100])
    // Tiny color shift — below the default OKLab threshold.
    const near = makePng(8, 8, () => [102, 101, 100])
    const result = compareSnapshots(near, base)
    expect(result.pass).toBe(true)
    expect(result.diffPixels).toBe(0)
  })

  it("detects a shifted pattern as a large diff", () => {
    const base = makePng(16, 16, (x) => (x % 2 === 0 ? [255, 255, 255] : [0, 0, 0]))
    const shifted = makePng(16, 16, (x) => ((x + 1) % 2 === 0 ? [255, 255, 255] : [0, 0, 0]))
    const result = compareSnapshots(shifted, base)
    expect(result.pass).toBe(false)
    expect(result.diffPixels).toBeGreaterThan(100)
    expect(result.diffRatio).toBeGreaterThan(0.4)
  })

  it("excludes masked regions from comparison", () => {
    const base = makePng(16, 16, () => [0, 0, 0])
    const actual = makePng(16, 16, (x, y) =>
      x >= 4 && x < 8 && y >= 4 && y < 8 ? [255, 255, 255] : [0, 0, 0],
    )
    const masked = compareSnapshots(actual, base, {
      maskRegions: [{ x: 4, y: 4, width: 4, height: 4 }],
    })
    expect(masked.pass).toBe(true)
    expect(masked.diffPixels).toBe(0)

    const unmasked = compareSnapshots(actual, base)
    expect(unmasked.diffPixels).toBe(16)
  })

  it("produces a per-region breakdown when regionColumns is set", () => {
    const base = makePng(16, 16, () => [0, 0, 0])
    // Change one pixel in the top-left quadrant only.
    const actual = makePng(16, 16, (x, y) => (x === 1 && y === 1 ? [255, 255, 255] : [0, 0, 0]))
    const result = compareSnapshots(actual, base, { regionColumns: 2 })
    // 2 columns × ~1 row for a square image → regions cover the grid.
    expect(result.regions.length).toBeGreaterThan(0)
    const changed = result.regions.filter((r) => r.diffPixels > 0)
    expect(changed.length).toBe(1)
    expect(changed[0].col).toBe(0)
    expect(changed[0].row).toBe(0)
  })

  it("throws SnapshotDimensionError on size mismatch", () => {
    const a = solid(16, 16, 0)
    const b = makePng(8, 8, () => [0, 0, 0])
    expect(() => compareSnapshots(a, b)).toThrow(SnapshotDimensionError)
  })
})

describe("buildIgnoreMask", () => {
  it("marks pixels inside regions and clamps to bounds", () => {
    const mask = buildIgnoreMask(4, 4, [
      { x: 1, y: 1, width: 2, height: 2 },
      { x: -10, y: -10, width: 100, height: 100 },
    ])
    // Second region covers everything.
    expect(mask.every((v) => v === 1)).toBe(true)

    const partial = buildIgnoreMask(4, 4, [{ x: 1, y: 1, width: 2, height: 2 }])
    expect(partial[1 * 4 + 1]).toBe(1)
    expect(partial[0]).toBe(0)
    expect(partial[3 * 4 + 3]).toBe(0)
  })
})
