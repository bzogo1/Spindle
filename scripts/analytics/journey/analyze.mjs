#!/usr/bin/env node
/**
 * User-journey funnel analysis.
 *
 * Reads analytics events (JSONL) and reconstructs per-journey funnels:
 * how many subjects reached each step, in order, and how long it took.
 *
 * Input: newline-delimited JSON. Each line may be either
 *   - a stored analytics event (the shape produced by the /api/analytics
 *     store / exports): { name, props, timestamp, userId, anonymousId, ... }
 *   - a raw client payload envelope: { events: [ ...same event shape... ] }
 * Blank lines and unparseable lines are skipped with a warning on stderr.
 *
 * Journey events are identified by name === "journey_step" with
 * props.journey and props.step (emitted by src/lib/journey/tracker.ts).
 * Ordering uses props.stepIndex when present, falling back to first-seen
 * timestamp order.
 *
 * Usage:
 *   node scripts/analytics/journey/analyze.mjs <events.jsonl> [--json] [--journey <id>]
 *   cat events.jsonl | node scripts/analytics/journey/analyze.mjs - [--json]
 *
 * Exit codes: 0 ok, 1 usage/IO error.
 */

import { readFileSync } from "node:fs"

const JOURNEY_EVENT_NAME = "journey_step"

function usage() {
  console.error(
    "usage: node scripts/analytics/journey/analyze.mjs <events.jsonl|-> [--json] [--journey <id>]",
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const file = args[0]
if (!file) usage()
const asJson = args.includes("--json")
const journeyFlagIndex = args.indexOf("--journey")
const journeyFilter = journeyFlagIndex >= 0 ? args[journeyFlagIndex + 1] : null
if (journeyFlagIndex >= 0 && !journeyFilter) usage()

function* readLines(path) {
  const text = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed) yield trimmed
  }
}

/** Yields bare event objects from a JSONL stream (handles {events:[...]} envelopes). */
function* iterEvents(path) {
  let skipped = 0
  for (const line of readLines(path)) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const candidates = Array.isArray(parsed?.events) ? parsed.events : [parsed]
    for (const event of candidates) {
      if (event && typeof event === "object") yield event
    }
  }
  if (skipped > 0) {
    console.error(`warning: skipped ${skipped} unparseable line(s)`)
  }
}

/** Extracts { journey, step, stepIndex, ts, subject } from an event, or null. */
function toJourneyEvent(event) {
  const name = event.name
  const props = event.props
  if (name !== JOURNEY_EVENT_NAME || !props || typeof props !== "object") return null
  const { journey, step, stepIndex } = props
  if (typeof journey !== "string" || typeof step !== "string") return null
  if (journeyFilter && journey !== journeyFilter) return null

  const ts =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? event.timestamp
      : typeof event.receivedAt === "number" && Number.isFinite(event.receivedAt)
        ? event.receivedAt
        : null
  if (ts === null) return null

  // Stitching priority: journey session id first — it is emitted on every
  // journey event (props.journeySessionId) and survives the anonymous →
  // authenticated boundary, so it merges pre-auth and post-auth steps into
  // one subject. Fallbacks keep legacy behaviour for events lacking it:
  // signed-in principal > per-tab anonymous id.
  // Matches docs/analytics/user-journeys.md.
  const subject =
    (typeof props.journeySessionId === "string" && props.journeySessionId) ||
    (typeof event.userId === "string" && event.userId) ||
    (typeof event.anonymousId === "string" && event.anonymousId) ||
    null
  if (!subject) return null

  return {
    journey,
    step,
    stepIndex: typeof stepIndex === "number" && Number.isFinite(stepIndex) ? stepIndex : null,
    ts,
    subject,
  }
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Builds the funnel for one journey.
 *
 * A subject "reaches" a step when it emits that step at or after having
 * reached every earlier step (steps may repeat; only forward progress
 * counts). Steps without a declared stepIndex are ordered by first-seen
 * timestamp across all subjects.
 */
function analyzeJourney(events) {
  // Determine step order: prefer stepIndex, fall back to first-seen ts.
  const stepMeta = new Map() // step -> { minIndex, firstTs }
  for (const e of events) {
    const meta = stepMeta.get(e.step) ?? { minIndex: Infinity, firstTs: Infinity }
    if (e.stepIndex !== null) meta.minIndex = Math.min(meta.minIndex, e.stepIndex)
    meta.firstTs = Math.min(meta.firstTs, e.ts)
    stepMeta.set(e.step, meta)
  }
  const orderedSteps = [...stepMeta.entries()]
    .sort((a, b) => {
      const ai = a[1].minIndex === Infinity ? Infinity : a[1].minIndex
      const bi = b[1].minIndex === Infinity ? Infinity : b[1].minIndex
      if (ai !== bi) return ai - bi
      return a[1].firstTs - b[1].firstTs
    })
    .map(([step]) => step)

  // Per subject: sorted unique-forward step progressions.
  const bySubject = new Map() // subject -> events sorted by ts
  for (const e of events) {
    const list = bySubject.get(e.subject) ?? []
    list.push(e)
    bySubject.set(e.subject, list)
  }

  const stepRank = new Map(orderedSteps.map((s, i) => [s, i]))
  const reachedCounts = orderedSteps.map(() => 0)
  const timeToStepMs = orderedSteps.map(() => [])
  let completed = 0

  for (const list of bySubject.values()) {
    list.sort((a, b) => a.ts - b.ts)
    // Collapse to the furthest rank reached, recording first-hit times.
    let maxRank = -1
    const firstHitAt = new Map()
    const startTs = list[0].ts
    for (const e of list) {
      const rank = stepRank.get(e.step)
      if (rank === undefined) continue
      if (!firstHitAt.has(e.step)) firstHitAt.set(e.step, e.ts)
      if (rank > maxRank) maxRank = rank
    }
    // A subject counts as reaching every step up to its furthest rank —
    // funnel semantics assume ordered progression; out-of-order events for
    // earlier steps still count once the subject got there.
    for (let rank = 0; rank <= maxRank; rank += 1) {
      reachedCounts[rank] += 1
      const hitTs = firstHitAt.get(orderedSteps[rank])
      if (hitTs !== undefined) timeToStepMs[rank].push(hitTs - startTs)
    }
    if (maxRank === orderedSteps.length - 1) completed += 1
  }

  // Raw event counts per step (includes repeats/out-of-order).
  const rawCounts = new Map()
  for (const e of events) rawCounts.set(e.step, (rawCounts.get(e.step) ?? 0) + 1)

  const steps = orderedSteps.map((step, i) => {
    const reached = reachedCounts[i]
    const prevReached = i === 0 ? reached : reachedCounts[i - 1]
    return {
      step,
      rank: i,
      subjectsReached: reached,
      stepOverStepConversion: i === 0 || prevReached === 0 ? null : round3(reached / prevReached),
      overallConversion: round3(reached / Math.max(1, bySubject.size)),
      medianTimeFromStartMs: median(timeToStepMs[i]),
      eventCount: rawCounts.get(step) ?? 0,
    }
  })

  return {
    journey: events[0]?.journey ?? journeyFilter ?? null,
    subjects: bySubject.size,
    completed,
    completionRate: round3(completed / Math.max(1, bySubject.size)),
    steps,
  }
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

let hadError = false
try {
  const events = []
  for (const e of iterEvents(file)) {
    const je = toJourneyEvent(e)
    if (je) events.push(je)
  }

  const journeys = new Map()
  for (const e of events) {
    const list = journeys.get(e.journey) ?? []
    list.push(e)
    journeys.set(e.journey, list)
  }

  const funnels = [...journeys.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => analyzeJourney(list))

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: Date.now(), journeys: funnels }, null, 2))
  } else {
    if (funnels.length === 0) {
      console.log("No journey_step events found.")
    }
    for (const f of funnels) {
      console.log(
        `\n${f.journey}  (subjects: ${f.subjects}, completed: ${f.completed}, rate: ${f.completionRate})`,
      )
      for (const s of f.steps) {
        const conv =
          s.stepOverStepConversion === null
            ? "-"
            : `${(s.stepOverStepConversion * 100).toFixed(1)}%`
        const t =
          s.medianTimeFromStartMs === null ? "-" : `${(s.medianTimeFromStartMs / 1000).toFixed(1)}s`
        console.log(
          `  ${String(s.rank + 1).padStart(2)}. ${s.step.padEnd(28)} reached=${String(s.subjectsReached).padStart(5)}  stepConv=${conv.padStart(6)}  overall=${(s.overallConversion * 100).toFixed(1)}%  medianT=${t}  events=${s.eventCount}`,
        )
      }
    }
  }
} catch (error) {
  hadError = true
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
}

process.exit(hadError ? 1 : 0)
