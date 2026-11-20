import { describe, expect, it } from "vitest"
import { PNG } from "pngjs"

import { analyzeSnapshotDiff } from "./analyze"
import { compareSnapshots } from "./diff"

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

const solid = (r: number, g: number, b: number, w = 64, h = 64) => makePng(w, h, () => [r, g, b])

describe("analyzeSnapshotDiff", () => {
  it("reports noise for identical images", () => {
    const img = solid(10, 20, 30)
    const diff = compareSnapshots(img, img, { regionColumns: 4 })
    const analysis = analyzeSnapshotDiff(diff, { name: "case-a" })
    expect(analysis.findings.every((f) => f.category === "noise")).toBe(true)
    expect(analysis.significance).toBe(0)
    expect(analysis.summary.join(" ")).toContain("no meaningful")
  })

  it("categorizes a concentrated interior change as content", () => {
    const base = solid(0, 0, 0)
    // Paint a solid block in the middle of a 64x64 image.
    const actual = makePng(64, 64, (x, y) =>
      x >= 24 && x < 40 && y >= 24 && y < 40 ? [255, 255, 255] : [0, 0, 0],
    )
    const diff = compareSnapshots(actual, base, { regionColumns: 4 })
    const analysis = analyzeSnapshotDiff(diff)
    const categories = analysis.findings.map((f) => f.category)
    expect(categories).toContain("content")
    expect(analysis.significance).toBeGreaterThan(0)
    expect(analysis.summary.length).toBeGreaterThan(1)
  })

  it("categorizes top-strip changes as layout", () => {
    const base = solid(0, 0, 0)
    const actual = makePng(64, 64, (x, y) => (y < 8 ? [255, 255, 255] : [0, 0, 0]))
    const diff = compareSnapshots(actual, base, { regionColumns: 4 })
    const analysis = analyzeSnapshotDiff(diff)
    expect(analysis.findings.some((f) => f.category === "layout")).toBe(true)
  })

  it("flags broad multi-region changes with higher significance", () => {
    const base = solid(0, 0, 0)
    const actual = makePng(64, 64, (x, y) => ((x + y) % 3 === 0 ? [200, 200, 200] : [0, 0, 0]))
    const diff = compareSnapshots(actual, base, { regionColumns: 4 })
    const analysis = analyzeSnapshotDiff(diff)
    expect(analysis.significance).toBeGreaterThan(30)
    expect(analysis.grid.totalCells).toBeGreaterThan(0)
  })

  it("derives its own grid when regions are absent", () => {
    const base = solid(0, 0, 0)
    const actual = makePng(64, 64, (x, y) => (x === 10 && y === 10 ? [255, 255, 255] : [0, 0, 0]))
    const diff = compareSnapshots(actual, base) // no regionColumns
    expect(diff.regions).toHaveLength(0)
    const analysis = analyzeSnapshotDiff(diff, { gridColumns: 8 })
    expect(analysis.grid.columns).toBe(8)
    expect(analysis.grid.changedCells).toBe(1)
  })

  it("produces category breakdown shares summing to ~1", () => {
    const base = solid(0, 0, 0)
    const actual = makePng(64, 64, (x, y) =>
      x >= 16 && x < 48 && y >= 16 && y < 48 ? [255, 255, 255] : [0, 0, 0],
    )
    const diff = compareSnapshots(actual, base, { regionColumns: 4 })
    const analysis = analyzeSnapshotDiff(diff)
    const total = analysis.categories.reduce((s, c) => s + c.share, 0)
    expect(total).toBeCloseTo(1, 5)
  })
})
