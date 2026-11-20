/**
 * Lab snapshots → notifications bridge.
 *
 * Pure payload builders for the snapshot events the lab screen already
 * surfaces as toasts (baseline changes, review decisions, diff failures).
 * `lab-screen.tsx` pushes the results through `pushAppNotification`; keeping
 * the copy here — free of React and the DOM — makes it unit-testable, same
 * split as `lib/api/chat-notifications.ts`.
 *
 * All payloads are tagged `category: "lab"` so the per-category preference
 * toggles apply, and carry `projectId` so project-level overrides and the
 * project filter on the notifications page work.
 */

import type { AppNotificationInput } from "./notifications-provider"
import { formatDiffRatioPercent } from "./lab-snapshot-thresholds"
import type { LabSnapshot } from "./lab-mock"
import type { SnapshotComparisonResult } from "./lab-snapshot-compare"

/** Deep link back to the project's lab screen — the only place these events surface. */
export function labNotificationHref(projectId: string): string {
  return `/projects/${projectId}/lab`
}

/**
 * A comparison whose changed-pixel ratio exceeded the fail threshold. `names`
 * resolves the pair's display names (the result only carries ids); unknown
 * ids fall back to the raw id so the copy still identifies the pair.
 */
export function labSnapshotDiffFailInput(
  result: SnapshotComparisonResult,
  names: { base: string; other: string },
  projectId: string,
): AppNotificationInput {
  return {
    type: "error",
    title: `Snapshot comparison failed: ${names.other}`,
    body: `${names.other} differs from ${names.base} by ${formatDiffRatioPercent(result.diffRatio)} changed pixels — above the fail threshold.`,
    href: labNotificationHref(projectId),
    category: "lab",
    projectId,
  }
}

/** Approve/Reject decision on a snapshot. */
export function labSnapshotReviewInput(
  snapshot: LabSnapshot,
  status: "approved" | "rejected",
  projectId: string,
): AppNotificationInput {
  return {
    type: status === "approved" ? "success" : "warning",
    title:
      status === "approved"
        ? `Snapshot approved: ${snapshot.name}`
        : `Snapshot rejected: ${snapshot.name}`,
    body: `${snapshot.name} was marked ${status} for the ${snapshot.environment} environment (mock).`,
    href: labNotificationHref(projectId),
    category: "lab",
    projectId,
  }
}

/** A snapshot took over as its environment's reference baseline. */
export function labSnapshotBaselineInput(
  snapshot: LabSnapshot,
  projectId: string,
): AppNotificationInput {
  return {
    type: "success",
    title: `Baseline updated: ${snapshot.environment}`,
    body: `${snapshot.name} is now the ${snapshot.environment} baseline (mock).`,
    href: labNotificationHref(projectId),
    category: "lab",
    projectId,
  }
}
