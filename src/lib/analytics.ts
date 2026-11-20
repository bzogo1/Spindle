/**
 * Consent-gated analytics.
 *
 * The single entry point for product analytics. `trackEvent()` is safe to call
 * from anywhere — client components, server actions, route handlers — because
 * it decides for itself whether anything should happen:
 *
 * - No `analytics` consent (undecided or explicitly rejected): the event is
 *   queued while the visitor hasn't decided yet, and dropped once they have
 *   rejected. Nothing is ever sent or logged before an affirmative choice.
 * - Consent granted: the event is POSTed to `/api/analytics` (and echoed to
 *   `console.debug` outside production), where the ingest route validates it,
 *   re-checks the consent cookie, rate-limits, and stores it in the in-memory
 *   aggregation store defined at the bottom of this file.
 *
 * Props must stay aggregate and non-identifying (paths, feature names, counts).
 * Never pass emails, names, message content, or other personal data.
 *
 * The store functions (`parseAnalyticsEventsPayload`, `recordAnalyticsEvents`,
 * `getAnalyticsSummary`, `resetAnalyticsStoreForTests`) are server-side but
 * deliberately free of server-only imports so this module stays safe to
 * import from client components. State is per-process — on multi-instance
 * deploys each instance aggregates its own slice, the same trade-off as
 * `createRateLimiter` in `src/lib/site-forms.ts`.
 */

import { clientEnv } from "@/lib/env"
import { hasConsent, onConsentChange, readConsent } from "@/lib/consent"

export const ANALYTICS_EVENT_TYPES = ["page_view", "feature_use", "api_call"] as const
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number]

export type AnalyticsEventName = string

export type AnalyticsEvent = {
  name: AnalyticsEventName
  props?: Record<string, unknown>
  /**
   * Event kind reported to `/api/analytics`. When omitted it is inferred from
   * `name`: `page_view`/`api_call` map to themselves, everything else counts
   * as `feature_use`.
   */
  type?: AnalyticsEventType
  /** Epoch milliseconds when the event was recorded. */
  timestamp: number
}

/** Upper bound on events held while the visitor hasn't made a choice. */
const MAX_QUEUED_EVENTS = 50
/** Event names longer than this are almost certainly a bug. */
const MAX_NAME_LENGTH = 128

const queue: AnalyticsEvent[] = []
let consentListenerStarted = false
let anonymousId: string | null = null

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

/**
 * Random per-tab identifier sent with each event so anonymous hits can be
 * deduplicated without cookies or storage. Resets on reload — deliberately
 * not persisted, to stay clear of the consent categories.
 */
function getAnonymousId(): string | null {
  if (!isBrowser()) return null
  if (anonymousId) return anonymousId
  try {
    anonymousId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  } catch {
    anonymousId = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
  return anonymousId
}

function eventTypeFor(event: AnalyticsEvent): AnalyticsEventType {
  if (event.type) return event.type
  if (event.name === "page_view") return "page_view"
  if (event.name === "api_call") return "api_call"
  return "feature_use"
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Serializes queued/granted events into the `/api/analytics` payload shape. */
function toEventPayload(event: AnalyticsEvent) {
  const props = event.props ?? {}
  return {
    type: eventTypeFor(event),
    name: event.name,
    path: optionalString(props.path),
    feature: optionalString(props.feature),
    endpoint: optionalString(props.endpoint),
    props,
    timestamp: event.timestamp,
    anonymousId: getAnonymousId() ?? undefined,
  }
}

/**
 * Ships consented events to the ingest endpoint. Failures are swallowed —
 * analytics must never break or delay the app (`keepalive` survives unload).
 */
function postEvents(events: AnalyticsEvent[]): void {
  if (!isBrowser() || typeof fetch !== "function") return

  let body: string
  try {
    body = JSON.stringify({ events: events.map(toEventPayload) })
  } catch {
    return
  }

  try {
    void fetch(new URL("/api/analytics", window.location.origin).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body,
      keepalive: true,
    }).catch(() => {
      // Offline, rate-limited, or consent cookie expired — drop silently.
    })
  } catch {
    // Analytics must never surface errors to the caller.
  }
}

function dispatch(events: AnalyticsEvent[]): void {
  // Debug echo stays visible outside production; the network copy always runs
  // (consent was already verified by `record()` before dispatch is reached).
  if (clientEnv.NODE_ENV !== "production") {
    for (const event of events) {
      console.debug("[analytics]", event.name, event.props ?? {})
    }
  }
  postEvents(events)
}

function flushQueue(): void {
  const pending = queue.splice(0, queue.length)
  if (pending.length > 0) dispatch(pending)
}

function dropQueue(): void {
  queue.length = 0
}

/**
 * Starts listening for consent changes so queued events flush the moment the
 * visitor allows analytics, and are discarded if they reject. Runs once.
 */
function ensureConsentListener(): void {
  if (consentListenerStarted || !isBrowser()) return
  consentListenerStarted = true

  onConsentChange((state) => {
    if (!state.decided) return
    if (state.analytics) {
      flushQueue()
    } else {
      dropQueue()
    }
  })
}

function record(event: AnalyticsEvent): void {
  if (!isBrowser()) return

  if (hasConsent("analytics")) {
    dispatch([event])
    return
  }

  const consent = readConsent()
  if (consent.decided) {
    // Visitor rejected analytics — drop, never queue past a decision.
    return
  }

  // Undecided: hold the event briefly so the first page view isn't lost when
  // the banner is answered, but bound the buffer.
  ensureConsentListener()
  if (queue.length < MAX_QUEUED_EVENTS) queue.push(event)
}

/**
 * Records an analytics event. No-ops (queues or drops) unless the visitor has
 * granted the `analytics` consent category — see the module docs.
 */
export function trackEvent(
  name: AnalyticsEventName,
  props?: Record<string, unknown>,
  type?: AnalyticsEventType,
): void {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return
  }

  record({ name, props, type, timestamp: Date.now() })
}

/**
 * Records a page view. Convenience wrapper so call sites don't have to
 * remember the event name; still fully consent-gated.
 */
export function trackPageView(path: string, extra?: Record<string, unknown>): void {
  trackEvent("page_view", { path, ...extra }, "page_view")
}

/**
 * Records a feature interaction (button, panel, workflow). The `feature` prop
 * is lifted to a top-level field so the summary endpoint can group by it.
 */
export function trackFeatureUse(feature: string, props?: Record<string, unknown>): void {
  if (typeof feature !== "string" || feature.length === 0) return
  trackEvent(feature, { ...props, feature }, "feature_use")
}

/**
 * Records an API call made by the client. `endpoint` is lifted to a top-level
 * field; server-side producers should call `recordAnalyticsEvents` directly.
 */
export function trackApiCall(endpoint: string, props?: Record<string, unknown>): void {
  if (typeof endpoint !== "string" || endpoint.length === 0) return
  trackEvent(endpoint, { ...props, endpoint }, "api_call")
}

/* ------------------------------------------------------------------------ */
/* Server-side event store (used by /api/analytics route handlers)           */
/* ------------------------------------------------------------------------ */

/** Upper bound on retained events; oldest are dropped first. */
const MAX_STORED_EVENTS = 20_000
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS_PER_REQUEST = 20
const MAX_STORED_NAME_LENGTH = 128
const MAX_STORED_STRING_LENGTH = 512
const MAX_STORED_PROPS_BYTES = 4_096
const MAX_ANONYMOUS_ID_LENGTH = 64
/** Client timestamps older than this are clamped to `now` (clock drift). */
const MAX_EVENT_AGE_MS = 7 * DAY_MS
const MAX_EVENT_FUTURE_SKEW_MS = 10 * 60 * 1000

/** Validated event as received from `/api/analytics` (pre-attribution). */
export interface AnalyticsEventInput {
  type: AnalyticsEventType
  name: string
  path: string | null
  feature: string | null
  endpoint: string | null
  props: Record<string, unknown>
  /** Client-reported epoch ms, already clamped into a sane window. */
  timestamp: number
  anonymousId: string | null
}

export interface StoredAnalyticsEvent extends AnalyticsEventInput {
  id: number
  /** Session principal (`user:<uid>` / `mock:<email>`) when signed in. */
  userId: string | null
  /** Server receive time, epoch ms. */
  receivedAt: number
}

export interface AnalyticsDailyPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string
  events: number
  pageViews: number
  featureUses: number
  apiCalls: number
}

export interface AnalyticsTopEntry {
  name: string
  type: AnalyticsEventType
  count: number
}

export interface AnalyticsPathEntry {
  path: string
  count: number
}

export interface AnalyticsSummary {
  days: number
  generatedAt: number
  totals: {
    events: number
    pageViews: number
    featureUses: number
    apiCalls: number
  }
  daily: AnalyticsDailyPoint[]
  topEvents: AnalyticsTopEntry[]
  topPaths: AnalyticsPathEntry[]
}

const store: StoredAnalyticsEvent[] = []
let nextEventId = 1

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalField(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, maxLength)
}

function parseEvent(raw: unknown, now: number): AnalyticsEventInput | null {
  if (!isPlainObject(raw)) return null

  const type = raw.type
  if (typeof type !== "string" || !(ANALYTICS_EVENT_TYPES as readonly string[]).includes(type)) {
    return null
  }

  const name = optionalField(raw.name, MAX_STORED_NAME_LENGTH)
  if (name === undefined) return null

  const path = optionalField(raw.path, MAX_STORED_STRING_LENGTH)
  const feature = optionalField(raw.feature, MAX_STORED_STRING_LENGTH)
  const endpoint = optionalField(raw.endpoint, MAX_STORED_STRING_LENGTH)
  if (path === undefined || feature === undefined || endpoint === undefined) return null

  let props: Record<string, unknown> = {}
  if (raw.props !== undefined && raw.props !== null) {
    if (!isPlainObject(raw.props)) return null
    try {
      if (JSON.stringify(raw.props).length > MAX_STORED_PROPS_BYTES) return null
    } catch {
      return null
    }
    props = raw.props
  }

  let timestamp = now
  if (raw.timestamp !== undefined && raw.timestamp !== null) {
    if (typeof raw.timestamp !== "number" || !Number.isFinite(raw.timestamp)) return null
    timestamp = Math.min(
      Math.max(raw.timestamp, now - MAX_EVENT_AGE_MS),
      now + MAX_EVENT_FUTURE_SKEW_MS,
    )
  }

  const anonymousId = optionalField(raw.anonymousId, MAX_ANONYMOUS_ID_LENGTH)
  if (anonymousId === undefined) return null

  return {
    type: type as AnalyticsEventType,
    name: name ?? type,
    path,
    feature,
    endpoint,
    props,
    timestamp,
    anonymousId,
  }
}

/**
 * Validates an `/api/analytics` request body (`{ events: [...] }`). Returns
 * null when the payload is malformed — callers answer 400. `now` is
 * injectable for tests.
 */
export function parseAnalyticsEventsPayload(
  body: unknown,
  now = Date.now(),
): AnalyticsEventInput[] | null {
  if (!isPlainObject(body)) return null
  const events = body.events
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS_PER_REQUEST) {
    return null
  }

  const parsed: AnalyticsEventInput[] = []
  for (const raw of events) {
    const event = parseEvent(raw, now)
    if (!event) return null
    parsed.push(event)
  }
  return parsed
}

/**
 * Appends validated events to the in-memory store, stamping each with the
 * caller's session principal (or null for anonymous hits). Returns the stored
 * records. Oldest events are evicted past `MAX_STORED_EVENTS`.
 */
export function recordAnalyticsEvents(
  events: readonly AnalyticsEventInput[],
  context: { userId?: string | null; now?: number } = {},
): StoredAnalyticsEvent[] {
  const now = context.now ?? Date.now()
  const userId = context.userId ?? null

  const stored = events.map((event) => ({
    ...event,
    id: nextEventId++,
    userId,
    receivedAt: now,
  }))

  store.push(...stored)
  if (store.length > MAX_STORED_EVENTS) {
    store.splice(0, store.length - MAX_STORED_EVENTS)
  }
  return stored
}

/** Test hook: empties the store and resets id allocation. */
export function resetAnalyticsStoreForTests(): void {
  store.length = 0
  nextEventId = 1
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Aggregates stored events for the summary endpoint / dashboard card.
 *
 * `userId` scopes results to one principal (`user:<uid>` / `mock:<email>`);
 * pass null for the global aggregate. `days` is clamped to 1–90 and buckets
 * are UTC calendar days ending today.
 */
export function getAnalyticsSummary({
  days = 30,
  userId = null,
  now = Date.now(),
}: {
  days?: number
  userId?: string | null
  now?: number
} = {}): AnalyticsSummary {
  const windowDays = Math.min(90, Math.max(1, Math.floor(days)))

  const todayUtc = new Date(now)
  const startOfToday = Date.UTC(
    todayUtc.getUTCFullYear(),
    todayUtc.getUTCMonth(),
    todayUtc.getUTCDate(),
  )
  const windowStart = startOfToday - (windowDays - 1) * DAY_MS

  const totals = { events: 0, pageViews: 0, featureUses: 0, apiCalls: 0 }
  const dailyMap = new Map<string, AnalyticsDailyPoint>()
  const eventCounts = new Map<string, AnalyticsTopEntry>()
  const pathCounts = new Map<string, number>()

  for (let i = 0; i < windowDays; i += 1) {
    const date = new Date(windowStart + i * DAY_MS).toISOString().slice(0, 10)
    dailyMap.set(date, { date, events: 0, pageViews: 0, featureUses: 0, apiCalls: 0 })
  }

  for (const event of store) {
    if (event.timestamp < windowStart) continue
    if (userId !== null && event.userId !== userId) continue

    totals.events += 1
    if (event.type === "page_view") totals.pageViews += 1
    else if (event.type === "feature_use") totals.featureUses += 1
    else totals.apiCalls += 1

    const day = dailyMap.get(utcDayKey(event.timestamp))
    if (day) {
      day.events += 1
      if (event.type === "page_view") day.pageViews += 1
      else if (event.type === "feature_use") day.featureUses += 1
      else day.apiCalls += 1
    }

    const key = `${event.type}${event.name}`
    const top = eventCounts.get(key)
    if (top) {
      top.count += 1
    } else {
      eventCounts.set(key, { name: event.name, type: event.type, count: 1 })
    }

    if (event.path) {
      pathCounts.set(event.path, (pathCounts.get(event.path) ?? 0) + 1)
    }
  }

  const byCountDesc = <T extends { count: number }>(a: T, b: T) =>
    b.count - a.count ||
    String((a as { name?: string }).name ?? "").localeCompare(
      String((b as { name?: string }).name ?? ""),
    )

  const topEvents = [...eventCounts.values()].sort(byCountDesc).slice(0, 10)
  const topPaths = [...pathCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort(byCountDesc)
    .slice(0, 10)

  return {
    days: windowDays,
    generatedAt: now,
    totals,
    daily: [...dailyMap.values()],
    topEvents,
    topPaths,
  }
}
