import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("keeps the last conflicting utility", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })

  it("drops falsy values", () => {
    expect(cn("text-sm", undefined, null, false)).toBe("text-sm")
  })

  it("merges conditional object classes", () => {
    expect(cn("font-bold", { "text-sm": true, italic: false })).toBe("font-bold text-sm")
  })

  it("flattens nested arrays", () => {
    expect(cn(["px-2", ["py-1", { "text-sm": true }]])).toBe("px-2 py-1 text-sm")
  })

  it("returns an empty string for no inputs", () => {
    expect(cn()).toBe("")
  })

  it("preserves non-conflicting tailwind classes", () => {
    expect(cn("font-bold text-red-500", "px-4 py-2")).toBe("font-bold text-red-500 px-4 py-2")
  })
})
