"use client"

import { useState } from "react"
import { BellRing, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useNotificationPermission } from "@/lib/notifications/permission"

/**
 * Inline prompt for the browser notification permission. Renders nothing
 * once permission is granted or the Notification API is unavailable; while
 * `default` it explains the benefit and offers the request; while `denied`
 * it explains that the browser blocked the permission and how to undo it.
 * The hook re-checks on focus/visibilitychange, so a "Re-check" button or a
 * returning tab picks up changes made in browser settings.
 */
export function NotificationPermissionBanner() {
  const { state, request, refresh } = useNotificationPermission()
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)

  if (state === "unsupported" || state === "granted") return null

  async function handleEnable() {
    setBusy(true)
    try {
      const next = await request()
      setRequested(next !== "default")
    } finally {
      setBusy(false)
    }
  }

  if (state === "denied") {
    return (
      <div className="app-page-card flex items-start gap-3" role="note">
        <ShieldAlert aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 flex-none" />
        <div className="grid gap-1">
          <strong className="text-sm">Browser notifications are blocked</strong>
          <p className="text-muted-foreground text-sm">
            This site is not allowed to show notifications. Click the lock or tune icon in your
            browser&apos;s address bar, set Notifications to Allow, then re-check.
          </p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              Re-check permission
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page-card flex items-start gap-3" role="note">
      <BellRing aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 flex-none" />
      <div className="grid gap-1">
        <strong className="text-sm">Get notified outside this tab</strong>
        <p className="text-muted-foreground text-sm">
          Allow browser notifications and Spindle can alert you about agent runs, mentions, and
          automations even when this tab is in the background. In-app notifications keep working
          either way.
        </p>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={handleEnable} disabled={busy}>
            {busy ? "Requesting…" : "Enable notifications"}
          </Button>
          {requested ? (
            <span className="text-muted-foreground text-xs">
              Permission updated — this banner will disappear if allowed.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
