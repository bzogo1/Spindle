import { describe, expect, it } from "vitest"

import type { LabSnapshot } from "./lab-mock"
import type { SnapshotComparisonResult } from "./lab-snapshot-compare"
import {
  labNotificationHref,
  labSnapshotBaselineInput,
  labSnapshotDiffFailInput,
  labSnapshotReviewInput,
} from "./lab-notifications"

function buildSnapshot(overrides: Partial<LabSnapshot> = {}): LabSnapshot {
  return {
    id: "snap-01",
    name: "Pre-analysis baseline",
    environment: "RStudio",
    description: "First capture for RStudio",
    sizeBytes: 1024,
    createdAt: "2026-11-15T10:00:00.000Z",
    ...overrides,
  }
}

function buildDiffResult(
  overrides: Partial<SnapshotComparisonResult> = {},
): SnapshotComparisonResult {
  return {
    baseId: "snap-01",
    otherId: "snap-05",
    status: "fail",
    diffRatio: 0.02,
    diffPixels: 200,
    totalPixels: 10_000,
    ...overrides,
  }
}

describe("labNotificationHref", () => {
  it("deep-links to the project's lab screen", () => {
    expect(labNotificationHref("prj_01")).toBe("/projects/prj_01/lab")
  })
})

describe("labSnapshotDiffFailInput", () => {
  it("builds an error notification tagged lab with the diff ratio", () => {
    const input = labSnapshotDiffFailInput(
      buildDiffResult(),
      { base: "Pre-analysis baseline", other: "Post-review state" },
      "prj_01",
    )

    expect(input.type).toBe("error")
    expect(input.title).toBe("Snapshot comparison failed: Post-review state")
    expect(input.body).toContain("2.000%")
    expect(input.body).toContain("fail threshold")
    expect(input.href).toBe("/projects/prj_01/lab")
    expect(input.category).toBe("lab")
    expect(input.projectId).toBe("prj_01")
  })
})

describe("labSnapshotReviewInput", () => {
  it("builds a success notification for approvals", () => {
    const input = labSnapshotReviewInput(buildSnapshot(), "approved", "prj_01")

    expect(input.type).toBe("success")
    expect(input.title).toBe("Snapshot approved: Pre-analysis baseline")
    expect(input.body).toContain("marked approved")
    expect(input.category).toBe("lab")
    expect(input.projectId).toBe("prj_01")
  })

  it("builds a warning notification for rejections", () => {
    const input = labSnapshotReviewInput(buildSnapshot(), "rejected", "prj_01")

    expect(input.type).toBe("warning")
    expect(input.title).toBe("Snapshot rejected: Pre-analysis baseline")
    expect(input.category).toBe("lab")
  })
})

describe("labSnapshotBaselineInput", () => {
  it("builds a success notification naming the new baseline", () => {
    const input = labSnapshotBaselineInput(buildSnapshot(), "prj_01")

    expect(input.type).toBe("success")
    expect(input.title).toBe("Baseline updated: RStudio")
    expect(input.body).toContain("Pre-analysis baseline")
    expect(input.body).toContain("RStudio baseline")
    expect(input.category).toBe("lab")
    expect(input.projectId).toBe("prj_01")
  })
})
