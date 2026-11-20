/**
 * Client-side analytics for third-party-style apps.
 *
 * `initAppAnalytics(appId)` returns a small client that records named events
 * (with optional properties) into `localStorage` and exposes aggregate stats.
 * Events are capped so storage stays bounded.
 */

export interface AppAnalyticsEvent {
  name: string
  timestamp: number
  properties?: Record<string, unknown>
}

export interface AppEventStats {
  appId: string
  totalEvents: number
  eventsByName: Record<string, number>
  firstEventAt: number | null
  lastEventAt: number | null
}

export interface AppAnalyticsClient {
  appId: string
  track: (name: string, properties?: Record<string, unknown>) => AppAnalyticsEvent
  getStats: () => AppEventStats
  listEvents: () => AppAnalyticsEvent[]
}

const STORAGE_PREFIX = "spindle.apps.analytics."
const MAX_EVENTS = 1000

export function analyticsStorageKey(appId: string): string {
  return `${STORAGE_PREFIX}${appId}`
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage
  return null
}

function readEvents(appId: string, storage?: Storage): AppAnalyticsEvent[] {
  const store = getStorage(storage)
  if (!store) return []
  try {
    const raw = store.getItem(analyticsStorageKey(appId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is AppAnalyticsEvent =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as AppAnalyticsEvent).name === "string" &&
        typeof (e as AppAnalyticsEvent).timestamp === "number",
    )
  } catch {
    return []
  }
}

function writeEvents(appId: string, events: AppAnalyticsEvent[], storage?: Storage): void {
  const store = getStorage(storage)
  if (!store) return
  try {
    store.setItem(analyticsStorageKey(appId), JSON.stringify(events))
  } catch {
    // Storage full or unavailable — analytics is best-effort.
  }
}

/** Aggregate a raw event list into stats. */
export function aggregateStats(appId: string, events: readonly AppAnalyticsEvent[]): AppEventStats {
  const eventsByName: Record<string, number> = {}
  let firstEventAt: number | null = null
  let lastEventAt: number | null = null

  for (const event of events) {
    eventsByName[event.name] = (eventsByName[event.name] ?? 0) + 1
    if (firstEventAt === null || event.timestamp < firstEventAt) {
      firstEventAt = event.timestamp
    }
    if (lastEventAt === null || event.timestamp > lastEventAt) {
      lastEventAt = event.timestamp
    }
  }

  return {
    appId,
    totalEvents: events.length,
    eventsByName,
    firstEventAt,
    lastEventAt,
  }
}

/** Read persisted stats for an app without recording anything. */
export function getAppStats(appId: string, storage?: Storage): AppEventStats {
  return aggregateStats(appId, readEvents(appId, storage))
}

/** Remove all persisted analytics for an app. */
export function clearAppAnalytics(appId: string, storage?: Storage): void {
  const store = getStorage(storage)
  if (!store) return
  try {
    store.removeItem(analyticsStorageKey(appId))
  } catch {
    // ignore
  }
}

/**
 * Create an analytics client bound to `appId`. Events are appended to
 * localStorage; when the cap is reached the oldest events are dropped.
 */
export function initAppAnalytics(appId: string, storage?: Storage): AppAnalyticsClient {
  return {
    appId,
    track(name: string, properties?: Record<string, unknown>): AppAnalyticsEvent {
      const event: AppAnalyticsEvent = {
        name,
        timestamp: Date.now(),
        ...(properties ? { properties } : {}),
      }
      const events = readEvents(appId, storage)
      events.push(event)
      writeEvents(appId, events.slice(-MAX_EVENTS), storage)
      return event
    },
    getStats(): AppEventStats {
      return getAppStats(appId, storage)
    },
    listEvents(): AppAnalyticsEvent[] {
      return readEvents(appId, storage)
    },
  }
}
