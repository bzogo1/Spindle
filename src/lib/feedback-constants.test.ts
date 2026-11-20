import { describe, expect, it } from "vitest"

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_LIMITS,
} from "./feedback-constants"

describe("feedback constants", () => {
  it("has a label for every category", () => {
    for (const category of FEEDBACK_CATEGORIES) {
      expect(FEEDBACK_CATEGORY_LABELS[category]).toBeTruthy()
    }
    expect(Object.keys(FEEDBACK_CATEGORY_LABELS).sort()).toEqual([...FEEDBACK_CATEGORIES].sort())
  })

  it("keeps message limits sane", () => {
    expect(FEEDBACK_LIMITS.messageMin).toBeGreaterThan(0)
    expect(FEEDBACK_LIMITS.messageMax).toBeGreaterThan(FEEDBACK_LIMITS.messageMin)
  })
})
