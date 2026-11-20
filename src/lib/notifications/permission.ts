"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Browser/system notification permission flow.
 *
 * Wraps the Notification API with a normalized state
 * (`default | granted | denied | unsupported`) so UI can render the right
 * prompt: an enable CTA while `default`, guidance while `denied` (the browser
 * has blocked the permission and `requestPermission` is a no-op), and
 * nothing once `granted`. Unsupported covers SSR, jsdom, and browsers
 * without the API.
 *
 * `useNotificationPermission` re-reads the permission whenever the window
 * regains focus or the tab becomes visible again — the user may have changed
 * the setting in the browser UI while the tab was hidden, and there is no
 * push event for that.
 */

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported"

export interface SystemNotificationInput {
  title: string
  body?: string
  /** Internal path to open when the OS notification is clicked. */
  href?: string
  /** Collapse duplicate OS banners that share a tag. */
  tag?: string
}

type NotificationConstructor = typeof Notification

function notificationApi(): NotificationConstructor | null {
  if (typeof window === "undefined") return null
  const ctor =
    window.Notification ??
    (window as unknown as { webkitNotification?: NotificationConstructor }).webkitNotification
  return ctor ?? null
}

function normalizePermission(value: unknown): NotificationPermissionState {
  return value === "granted" || value === "denied" ? value : "default"
}

/** Current permission state; "unsupported" when the API is missing. */
export function getNotificationPermissionState(): NotificationPermissionState {
  const ctor = notificationApi()
  if (!ctor) return "unsupported"
  return normalizePermission(ctor.permission)
}

/**
 * Show an OS notification when permission is granted. Returns false (a
 * no-op) for every other state — callers never need to pre-check. Clicking
 * the banner focuses the window and navigates to `href` when provided.
 */
export function showSystemNotification(input: SystemNotificationInput): boolean {
  if (getNotificationPermissionState() !== "granted") return false
  const ctor = notificationApi()
  if (!ctor) return false
  try {
    const notification = new ctor(input.title, {
      body: input.body,
      tag: input.tag,
    })
    notification.onclick = () => {
      window.focus()
      // A full navigation is intentional: the OS banner click can arrive while
      // the SPA is backgrounded, and `location.assign` works regardless of
      // which document the user returns to.
      if (input.href) window.location.assign(input.href)
    }
    return true
  } catch {
    // Some browsers throw when notifications are blocked at the OS level even
    // though permission reads "granted" — delivery must never break the app.
    return false
  }
}

/**
 * Request the notification permission. Resolves with the resulting state.
 * Browsers ignore the request (and may resolve immediately) while the state
 * is `denied` — callers should surface guidance instead of retrying.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const ctor = notificationApi()
  if (!ctor || typeof ctor.requestPermission !== "function") {
    return getNotificationPermissionState()
  }
  try {
    const result = await ctor.requestPermission()
    return normalizePermission(result)
  } catch {
    return getNotificationPermissionState()
  }
}

export interface NotificationPermission {
  state: NotificationPermissionState
  /** True when the Notification API exists at all. */
  supported: boolean
  /** Re-read the permission (e.g. after the user changed browser settings). */
  refresh: () => void
  /** Prompt for permission; resolves with the new state. */
  request: () => Promise<NotificationPermissionState>
}

/**
 * Live permission state for components. Re-checks on window focus and
 * `visibilitychange` so a permission flipped in browser settings is picked
 * up without a reload.
 */
export function useNotificationPermission(): NotificationPermission {
  // Start at "unsupported" so SSR and the first client render agree; the
  // mount effect below replaces it with the real state before paint matters.
  const [state, setState] = useState<NotificationPermissionState>("unsupported")

  useEffect(() => {
    setState(getNotificationPermissionState())

    function recheck() {
      setState(getNotificationPermissionState())
    }

    window.addEventListener("focus", recheck)
    document.addEventListener("visibilitychange", recheck)
    return () => {
      window.removeEventListener("focus", recheck)
      document.removeEventListener("visibilitychange", recheck)
    }
  }, [])

  const refresh = useCallback(() => {
    setState(getNotificationPermissionState())
  }, [])

  const request = useCallback(async () => {
    const next = await requestNotificationPermission()
    setState(next)
    return next
  }, [])

  return { state, supported: state !== "unsupported", refresh, request }
}
