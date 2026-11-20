"use client"

/**
 * Live activity events for the current session.
 *
 * Subscribes to all three delivery paths used by `pushActivityEvent`:
 * same-tab CustomEvents, cross-tab BroadcastChannel messages, and the
 * `/api/activity/stream` SSE feed (other tabs/devices and future backend
 * producers). When EventSource is missing or the endpoint rejects the
 * session, the local paths keep working — realtime is best-effort, matching
 * the notifications provider's graceful fallback.
 *
 * `projectId` scopes the feed: pass it on project screens so only that
 * project's events are collected; omit it (dashboard) to collect every
 * event, including workspace-level ones with no `projectId`.
 */

import { useEffect, useState } from "react"

import type { ActivityEvent } from "../api/types"
import {
  ACTIVITY_BROADCAST_CHANNEL,
  ACTIVITY_LIVE_EVENT,
  ACTIVITY_STREAM_PATH,
  isActivityEvent,
  isActivityStreamEvent,
} from "./events"

/** Hard cap so a noisy producer cannot grow the live list without bound. */
const MAX_LIVE_EVENTS = 100

export function useActivityEvents(projectId?: string): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([])

  useEffect(() => {
    // Drop events collected for a previous projectId when the scope changes
    // without a remount (client-side navigation between projects).
    setEvents([])

    const matches = (event: ActivityEvent) =>
      projectId === undefined || event.projectId === projectId

    const ingest = (candidate: unknown) => {
      if (!isActivityEvent(candidate) || !matches(candidate)) return
      setEvents((current) =>
        [candidate, ...current.filter((existing) => existing.id !== candidate.id)].slice(
          0,
          MAX_LIVE_EVENTS,
        ),
      )
    }

    function onWindowEvent(event: Event) {
      ingest((event as CustomEvent<unknown>).detail)
    }

    function onChannelMessage(event: MessageEvent<unknown>) {
      ingest(event.data)
    }

    function onStreamMessage(event: MessageEvent) {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!isActivityStreamEvent(parsed)) return
      ingest(parsed.activity)
    }

    window.addEventListener(ACTIVITY_LIVE_EVENT, onWindowEvent)

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(ACTIVITY_BROADCAST_CHANNEL)
      channel.addEventListener("message", onChannelMessage)
    } catch {
      channel = null
    }

    let source: EventSource | null = null
    if (typeof EventSource !== "undefined") {
      source = new EventSource(ACTIVITY_STREAM_PATH)
      source.addEventListener("message", onStreamMessage)
    }

    return () => {
      window.removeEventListener(ACTIVITY_LIVE_EVENT, onWindowEvent)
      channel?.removeEventListener("message", onChannelMessage)
      channel?.close()
      source?.removeEventListener("message", onStreamMessage)
      source?.close()
    }
  }, [projectId])

  return events
}
