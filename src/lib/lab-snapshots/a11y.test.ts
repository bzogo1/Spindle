import { describe, expect, it } from "vitest"

import { analyzeHtmlForA11y } from "./a11y"

describe("analyzeHtmlForA11y", () => {
  it("passes clean accessible markup", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>t</title></head>
      <body><h1>Hi</h1><h2>Sub</h2>
      <img src="a.png" alt="A chart">
      <label for="name">Name</label><input id="name" type="text">
      <button style="color:#ffffff;background:#1a1a2e;">Go</button>
      </body></html>`
    const report = analyzeHtmlForA11y(html)
    expect(report.findings).toHaveLength(0)
    expect(report.score).toBe(100)
    expect(report.pass).toBe(true)
  })

  it("flags missing alt, labels, lang, and heading skips", () => {
    const html = `<html><body>
      <h1>Title</h1><h3>Skipped</h3>
      <img src="chart.png">
      <input type="text">
      </body></html>`
    const report = analyzeHtmlForA11y(html)
    const rules = report.findings.map((f) => f.rule)
    expect(rules).toContain("html-lang")
    expect(rules).toContain("image-alt")
    expect(rules).toContain("form-label")
    expect(rules).toContain("heading-order")
    expect(report.pass).toBe(false) // form-label is critical
    expect(report.byRule["form-label"]).toBe(1)
  })

  it("estimates inline color contrast", () => {
    const low = analyzeHtmlForA11y(
      `<html lang="en"><body><p style="color:#777777;background:#888888;">x</p></body></html>`,
    )
    expect(low.findings.some((f) => f.rule === "color-contrast")).toBe(true)

    const high = analyzeHtmlForA11y(
      `<html lang="en"><body><p style="color:#000000;background:#ffffff;">x</p></body></html>`,
    )
    expect(high.findings).toHaveLength(0)
  })

  it("accepts aria-label as an accessible name", () => {
    const html = `<html lang="en"><body><input aria-label="Search"></body></html>`
    const report = analyzeHtmlForA11y(html)
    expect(report.findings.filter((f) => f.rule === "form-label")).toHaveLength(0)
  })

  it("ignores hidden inputs and decorative empty alt gracefully", () => {
    const html = `<html lang="en"><body>
      <input type="hidden" name="csrf">
      <img src="spacer.gif" alt="">
      </body></html>`
    const report = analyzeHtmlForA11y(html)
    // empty alt → minor finding at most, never critical
    expect(report.findings.filter((f) => f.severity === "critical")).toHaveLength(0)
  })
})
