import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("keeps the last conflicting utility", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })

  it("drops falsy values", () => {
    expect(cn("text-sm", undefined, null, false)).toBe("text-sm")
  })
})
