import type { SearchEvent } from "./schema"

/**
 * Conversion tracking for search (task 49).
 *
 * Conversions are local events that indicate a search led somewhere useful:
 * `result_clicked` (engaged a result), `doc_opened` (landed on documentation),
 * and `feedback_submitted` (completed a feedback flow). The funnel is
 * computed over stored events — no network, no PII beyond the anonymous id.
 */

export const SEARCH_CONVERSIONS = ["result_clicked", "doc_opened", "feedback_submitted"] as const
export type SearchConversion = (typeof SEARCH_CONVERSIONS)[number]

export type FunnelStage = {
  key: string
  label: string
  /** Event type(s) counted at this stage. */
  eventTypes: string[]
  /** Number of events matching this stage. */
  count: number
  /**
   * count / previous stage count. Assumes funnel ordering (each stage should
   * be a subset of the previous); if events arrive out of order or a later
   * stage has more events than an earlier one, the rate can exceed 1 — it is
   * a raw ratio, not clamped.
   */
  stepRate: number
  /** count / first stage count; same caveat as stepRate (can exceed 1). */
  overallRate: number
}

export type SearchFunnel = {
  stages: FunnelStage[]
  /** Total query_submitted events — funnel entry. */
  searches: number
  /**
   * "Deep" conversion rate: searches that ended in a doc open or feedback
   * submission (result_clicked is an engagement step, not a conversion).
   * Counts events, not unique searches, so it can exceed 1 when a single
   * search produces multiple conversions — treat as directional.
   */
  deepConversionRate: number
}

const STAGE_DEFS: { key: string; label: string; eventTypes: string[] }[] = [
  { key: "search", label: "Searches", eventTypes: ["query_submitted"] },
  { key: "click", label: "Result clicks", eventTypes: ["result_clicked"] },
  { key: "doc_open", label: "Docs opened", eventTypes: ["doc_opened"] },
  { key: "feedback", label: "Feedback submitted", eventTypes: ["feedback_submitted"] },
]

export function computeSearchFunnel(events: SearchEvent[]): SearchFunnel {
  const counts = new Map<string, number>()
  for (const def of STAGE_DEFS) counts.set(def.key, 0)

  for (const event of events) {
    for (const def of STAGE_DEFS) {
      if (def.eventTypes.includes(event.type)) {
        counts.set(def.key, (counts.get(def.key) ?? 0) + 1)
        break
      }
    }
  }

  const searches = counts.get("search") ?? 0
  const stages: FunnelStage[] = []
  let previous = searches

  for (const def of STAGE_DEFS) {
    const count = counts.get(def.key) ?? 0
    stages.push({
      key: def.key,
      label: def.label,
      eventTypes: def.eventTypes,
      count,
      stepRate: def.key === "search" ? 1 : previous > 0 ? count / previous : 0,
      overallRate: searches > 0 ? count / searches : 0,
    })
    if (def.key !== "search") previous = count
  }

  const conversions = (counts.get("doc_open") ?? 0) + (counts.get("feedback") ?? 0)
  return {
    stages,
    searches,
    deepConversionRate: searches > 0 ? conversions / searches : 0,
  }
}

export type ConversionRate = {
  conversion: SearchConversion
  count: number
  /** Conversions per search (query_submitted). */
  perSearch: number
  /** Conversions per result click. */
  perClick: number
}

/** Per-conversion-type rates against searches and clicks. */
export function computeConversionRates(events: SearchEvent[]): ConversionRate[] {
  let searches = 0
  let clicks = 0
  const counts = new Map<SearchConversion, number>([
    ["result_clicked", 0],
    ["doc_opened", 0],
    ["feedback_submitted", 0],
  ])

  for (const event of events) {
    switch (event.type) {
      case "query_submitted":
        searches += 1
        break
      case "result_clicked":
        clicks += 1
        counts.set("result_clicked", (counts.get("result_clicked") ?? 0) + 1)
        break
      case "doc_opened":
        counts.set("doc_opened", (counts.get("doc_opened") ?? 0) + 1)
        break
      case "feedback_submitted":
        counts.set("feedback_submitted", (counts.get("feedback_submitted") ?? 0) + 1)
        break
      default:
        break
    }
  }

  return SEARCH_CONVERSIONS.map((conversion) => {
    const count = counts.get(conversion) ?? 0
    return {
      conversion,
      count,
      perSearch: searches > 0 ? count / searches : 0,
      perClick: clicks > 0 ? count / clicks : 0,
    }
  })
}
