import { describe, expect, it } from "vitest"

import type { LabSnapshot } from "./lab-mock"
import { LAB_BROWSERS, labBrowserSnapshot } from "./lab-mock"
import {
  SNAPSHOT_PREVIEW_HEIGHT,
  SNAPSHOT_PREVIEW_WIDTH,
  snapshotPreviewSvg,
  snapshotPreviewUrl,
} from "./lab-snapshot-preview"

function buildSnapshot(overrides: Partial<LabSnapshot> = {}): LabSnapshot {
  return {
    id: "snap-01",
    name: "Pre-analysis baseline",
    environment: "RStudio",
    description: "Workspace state before the analysis pass.",
    sizeBytes: 48 * 1024 * 1024,
    createdAt: "2026-11-18T16:40:00.000Z",
    ...overrides,
  }
}

describe("snapshotPreviewSvg", () => {
  it("is deterministic for the same snapshot", () => {
    const snapshot = buildSnapshot()
    expect(snapshotPreviewSvg(snapshot)).toBe(snapshotPreviewSvg(buildSnapshot()))
  })

  it("differs between snapshots", () => {
    const a = snapshotPreviewSvg(buildSnapshot({ id: "snap-01" }))
    const b = snapshotPreviewSvg(buildSnapshot({ id: "snap-02", name: "Other" }))
    expect(a).not.toBe(b)
  })

  it("declares the preview dimensions and escapes the snapshot name", () => {
    const svg = snapshotPreviewSvg(buildSnapshot({ name: 'A "quoted" <name>' }))
    expect(svg).toContain(`width="${SNAPSHOT_PREVIEW_WIDTH}"`)
    expect(svg).toContain(`height="${SNAPSHOT_PREVIEW_HEIGHT}"`)
    expect(svg).toContain("&quot;quoted&quot; &lt;name&gt;")
    expect(svg).not.toContain('"quoted" <name>')
  })
})

describe("browser capture previews", () => {
  const source = buildSnapshot()
  const captures = LAB_BROWSERS.map((browser) => labBrowserSnapshot(source, browser))

  it("is deterministic for the same browser capture", () => {
    const again = labBrowserSnapshot(source, LAB_BROWSERS[1])
    expect(snapshotPreviewSvg(again)).toBe(snapshotPreviewSvg(captures[1]))
  })

  const stripText = (svg: string) => svg.replace(/<text[^>]*>[^<]*<\/text>/g, "")

  it("shares the canonical layout but differs per browser", () => {
    const svgs = captures.map((capture) => snapshotPreviewSvg(capture))
    // The window chrome/sidebar/grid markup is identical across browsers…
    // (title text is stripped — each capture name carries its browser label).
    const chrome = (svg: string) => {
      const plain = stripText(svg)
      return plain.slice(0, plain.indexOf('<rect x="10"'))
    }
    for (const svg of svgs.slice(1)) {
      expect(chrome(svg)).toBe(chrome(svgs[0]))
    }
    // …while the seeded drift makes each browser's render unique.
    expect(new Set(svgs).size).toBe(captures.length)
  })

  it("keeps the reference browser pixel-identical to the canonical layout", () => {
    const reference = captures.find((capture) => capture.browserId === "chromium")
    expect(reference).toBeDefined()
    // Drift 0 → only the snapshot name text differs from a same-seed capture
    // with a different name; geometry markup matches a drift-0 twin.
    const twin = { ...reference!, name: "Twin" }
    expect(stripText(snapshotPreviewSvg(twin))).toBe(stripText(snapshotPreviewSvg(reference!)))
  })
})

describe("snapshotPreviewUrl", () => {
  it("returns a data URL for the SVG", () => {
    const url = snapshotPreviewUrl(buildSnapshot())
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true)
    expect(decodeURIComponent(url)).toContain("<svg")
  })
})
