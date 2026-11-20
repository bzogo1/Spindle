import { describe, expect, it } from "vitest"

import { diffFileContents, diffLines } from "./diff"

describe("diffLines", () => {
  it("returns all-context for identical inputs", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc")
    expect(lines.map((l) => l.type)).toEqual(["context", "context", "context"])
    expect(lines[0]).toMatchObject({ oldLine: 1, newLine: 1 })
  })

  it("marks additions and deletions", () => {
    const lines = diffLines("a\nc", "a\nb\nc")
    expect(lines.map((l) => l.type)).toEqual(["context", "add", "context"])
    const added = lines[1]
    expect(added.text).toBe("b")
    expect(added.oldLine).toBeNull()
    expect(added.newLine).toBe(2)
  })

  it("marks deletions", () => {
    const lines = diffLines("a\nb\nc", "a\nc")
    expect(lines.map((l) => l.type)).toEqual(["context", "del", "context"])
    expect(lines[1].oldLine).toBe(2)
    expect(lines[1].newLine).toBeNull()
  })

  it("handles empty sides", () => {
    expect(diffLines("", "x").map((l) => l.type)).toEqual(["add"])
    expect(diffLines("x", "").map((l) => l.type)).toEqual(["del"])
    expect(diffLines("", "")).toEqual([])
  })

  it("normalises CRLF line endings", () => {
    const lines = diffLines("a\r\nb", "a\nb")
    expect(lines.every((l) => l.type === "context")).toBe(true)
  })

  it("does not treat a trailing newline as an extra line", () => {
    expect(diffLines("a\n", "a")).toEqual(diffLines("a", "a"))
  })
})

describe("diffFileContents", () => {
  it("counts added and removed lines", () => {
    const diff = diffFileContents("one\ntwo\nthree", "one\nTWO\nthree\nfour")
    expect(diff.changed).toBe(true)
    expect(diff.removed).toBe(1)
    expect(diff.added).toBe(2)
  })

  it("reports unchanged for identical content", () => {
    const diff = diffFileContents("same", "same")
    expect(diff.changed).toBe(false)
    expect(diff.added).toBe(0)
    expect(diff.removed).toBe(0)
  })
})
