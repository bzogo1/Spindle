import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const SCRIPT = join(process.cwd(), "scripts/analytics/journey/analyze.mjs")

function runAnalyze(lines: string[], args: string[] = ["--json"]) {
  const dir = mkdtempSync(join(tmpdir(), "journey-analyze-"))
  const file = join(dir, "events.jsonl")
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8")
  const out = execFileSync("node", [SCRIPT, file, ...args], { encoding: "utf8" })
  return JSON.parse(out)
}

function journeyEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: "journey_step",
    props: {
      journey: "signup_to_first_project",
      step: "landing_view",
      stepIndex: 0,
      journeySessionId: "sess-1",
      ...((overrides.props as Record<string, unknown>) ?? {}),
    },
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    ...overrides,
  }
}

describe("scripts/analytics/journey/analyze.mjs", () => {
  it("computes an ordered funnel with conversion and timing", () => {
    const base = 1_700_000_000_000
    const events = [
      // Subject A completes the whole funnel.
      journeyEvent({
        props: {
          journey: "signup_to_first_project",
          step: "landing_view",
          stepIndex: 0,
          journeySessionId: "sess-A",
        },
        timestamp: base,
        anonymousId: "anon-A",
      }),
      journeyEvent({
        props: {
          journey: "signup_to_first_project",
          step: "signup_view",
          stepIndex: 1,
          journeySessionId: "sess-A",
        },
        timestamp: base + 5_000,
        anonymousId: "anon-A",
      }),
      journeyEvent({
        props: {
          journey: "signup_to_first_project",
          step: "signup_submitted",
          stepIndex: 2,
          journeySessionId: "sess-A",
        },
        timestamp: base + 10_000,
        anonymousId: "anon-A",
      }),
      // Subject B drops off after step 1.
      journeyEvent({
        props: {
          journey: "signup_to_first_project",
          step: "landing_view",
          stepIndex: 0,
          journeySessionId: "sess-B",
        },
        timestamp: base + 1_000,
        anonymousId: "anon-B",
      }),
      journeyEvent({
        props: {
          journey: "signup_to_first_project",
          step: "signup_view",
          stepIndex: 1,
          journeySessionId: "sess-B",
        },
        timestamp: base + 6_000,
        anonymousId: "anon-B",
      }),
      // Non-journey noise is ignored.
      JSON.stringify({ name: "page_view", props: { path: "/" }, timestamp: base }),
      "not json at all",
    ].map((e) => (typeof e === "string" ? e : JSON.stringify(e)))

    const report = runAnalyze(events)
    expect(report.journeys).toHaveLength(1)
    const funnel = report.journeys[0]
    expect(funnel.journey).toBe("signup_to_first_project")
    expect(funnel.subjects).toBe(2)
    expect(funnel.completed).toBe(1)
    expect(funnel.completionRate).toBe(0.5)

    const steps = funnel.steps
    expect(steps.map((s: { step: string }) => s.step)).toEqual([
      "landing_view",
      "signup_view",
      "signup_submitted",
    ])
    expect(steps[0].subjectsReached).toBe(2)
    expect(steps[1].subjectsReached).toBe(2)
    expect(steps[1].stepOverStepConversion).toBe(1)
    expect(steps[2].subjectsReached).toBe(1)
    expect(steps[2].stepOverStepConversion).toBe(0.5)
    expect(steps[2].medianTimeFromStartMs).toBe(10_000)
  })

  it("prefers userId over anonymousId for stitching and filters by journey", () => {
    const lines = [
      JSON.stringify({
        name: "journey_step",
        props: { journey: "oauth_signin", step: "signin_view", stepIndex: 0 },
        timestamp: 100,
        userId: "user:42",
      }),
      JSON.stringify({
        name: "journey_step",
        props: { journey: "oauth_signin", step: "session_established", stepIndex: 3 },
        timestamp: 200,
        anonymousId: "anon-x",
        userId: "user:42",
      }),
      JSON.stringify({
        name: "journey_step",
        props: { journey: "invite_to_accept", step: "invite_sent", stepIndex: 0 },
        timestamp: 100,
        userId: "user:42",
      }),
    ]
    const report = runAnalyze(lines, ["--json", "--journey", "oauth_signin"])
    expect(report.journeys).toHaveLength(1)
    expect(report.journeys[0].subjects).toBe(1)
    expect(report.journeys[0].completed).toBe(1)
  })

  it("stitches anonymous pre-auth and authenticated post-auth steps via journeySessionId", () => {
    // Regression: when userId is preferred over journeySessionId, the
    // anonymous tail and the authenticated tail split into two subjects and
    // completion rates collapse to ~0. journeySessionId is present on both
    // sides of the auth boundary, so it must win.
    const base = 1_700_000_000_000
    const sessionId = "sess-auth"
    const lines = [
      // Anonymous steps: no userId yet.
      JSON.stringify({
        name: "journey_step",
        props: {
          journey: "signup_to_first_project",
          step: "landing_view",
          stepIndex: 0,
          journeySessionId: sessionId,
        },
        timestamp: base,
        anonymousId: "anon-pre",
      }),
      JSON.stringify({
        name: "journey_step",
        props: {
          journey: "signup_to_first_project",
          step: "signup_view",
          stepIndex: 1,
          journeySessionId: sessionId,
        },
        timestamp: base + 5_000,
        anonymousId: "anon-pre",
      }),
      // Post-auth steps: userId present, journeySessionId unchanged.
      JSON.stringify({
        name: "journey_step",
        props: {
          journey: "signup_to_first_project",
          step: "signup_submitted",
          stepIndex: 2,
          journeySessionId: sessionId,
        },
        timestamp: base + 10_000,
        anonymousId: "anon-pre",
        userId: "user:7",
      }),
      // A second subject in a different session, drops off early.
      JSON.stringify({
        name: "journey_step",
        props: {
          journey: "signup_to_first_project",
          step: "landing_view",
          stepIndex: 0,
          journeySessionId: "sess-other",
        },
        timestamp: base + 1_000,
        anonymousId: "anon-other",
      }),
    ]
    const report = runAnalyze(lines)
    expect(report.journeys).toHaveLength(1)
    const funnel = report.journeys[0]
    expect(funnel.subjects).toBe(2)
    expect(funnel.completed).toBe(1)
    expect(funnel.completionRate).toBe(0.5)
    expect(funnel.steps[2].subjectsReached).toBe(1)
  })

  it("handles {events:[...]} envelope lines", () => {
    const envelope = JSON.stringify({
      events: [
        {
          name: "journey_step",
          props: { journey: "agent_task", step: "project_opened", stepIndex: 0 },
          timestamp: 50,
          anonymousId: "anon-z",
        },
      ],
    })
    const report = runAnalyze([envelope])
    expect(report.journeys[0].journey).toBe("agent_task")
    expect(report.journeys[0].steps[0].subjectsReached).toBe(1)
  })
})
