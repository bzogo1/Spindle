import { describe, expect, it } from "vitest"

import { getLanguageLabel, highlightCode, parseLineHighlights } from "@/lib/code-highlight"

describe("parseLineHighlights", () => {
  it("expands ranges and ignores invalid entries", () => {
    expect([...parseLineHighlights("{2,5-7,9-8,nope}")]).toEqual([2, 5, 6, 7])
    expect([...parseLineHighlights()]).toEqual([])
  })
})

describe("getLanguageLabel", () => {
  it("maps aliases to readable labels", () => {
    expect(getLanguageLabel("sh")).toBe("Shell")
    expect(getLanguageLabel("py")).toBe("Python")
    expect(getLanguageLabel("custom")).toBe("custom")
  })
})

describe("highlightCode", () => {
  it("highlights cron without changing the copied text", async () => {
    const code = "0 7 * * 1  refresh /data/tides.csv\n# weekly"
    const lines = await highlightCode(code, "cron")

    expect(lines.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(code)
    expect(lines[1][0].color).toBe("var(--code-comment)")
  })

  it("falls back to plain text for unknown languages", async () => {
    const lines = await highlightCode("plain <text>", "not-a-language")

    expect(
      lines
        .flat()
        .map((token) => token.content)
        .join(""),
    ).toBe("plain <text>")
    expect(lines[0][0].color).toBe("var(--code-text)")
  })
})
