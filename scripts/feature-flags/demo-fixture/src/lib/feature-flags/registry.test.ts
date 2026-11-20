import { describe, expect, it } from "vitest"
import { evaluateFlag } from "@/lib/feature-flags/evaluate"

describe("kill switch", () => {
  it("is off in tests", () => {
    expect(evaluateFlag("kill-switch-logs")).toBe(false)
  })
})
