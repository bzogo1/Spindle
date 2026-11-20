"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Megaphone, X } from "lucide-react"

/**
 * Feature-announcement banners for the `(app)` shell.
 *
 * Mounting: rendered by `src/app/(app)/layout.tsx` as the first child of
 * `AppShell`'s `<main>` content area, so it shows on every app page. Unlike
 * `ImpersonationBanner` (a fixed, viewport-pinned alert), announcements are
 * deliberately LESS intrusive: they render inline at the top of the page
 * content as slim cards — up to two at a time, newest first — and scroll
 * away with the page instead of pinning to the viewport.
 *
 * Self-sufficient: on mount it fetches `GET /api/announcements` (the server
 * already filters by audience, window, and per-user dismissals) and renders
 * nothing while loading, on error, or when there is nothing active. The
 * dismiss (X) button POSTs `/api/announcements/dismiss` and hides the card
 * optimistically; if the request fails the card stays hidden for this page
 * view (a later fetch may show it again since the dismissal was not
 * recorded). Audience targeting is
 * enforced server-side; this component never sees announcements meant for
 * other audiences.
 */

const ANNOUNCEMENTS_URL = "/api/announcements"
const DISMISS_URL = "/api/announcements/dismiss"
/** At most this many announcement cards render at once. */
const MAX_VISIBLE = 2

export interface AnnouncementItem {
  id: string
  title: string
  body: string
  ctaLabel?: string
  ctaHref?: string
  audience: "all" | "admins"
  startsAt: string
  endsAt?: string
  publishedAt: string
  createdAt: string
}

interface AnnouncementsResponse {
  ok: boolean
  announcements?: AnnouncementItem[]
}

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(ANNOUNCEMENTS_URL, {
          cache: "no-store",
          credentials: "same-origin",
        })
        const data = (await response.json()) as AnnouncementsResponse
        if (cancelled) return
        if (response.ok && data.ok) {
          setAnnouncements((data.announcements ?? []).slice(0, MAX_VISIBLE))
        }
      } catch {
        // Best-effort banner: a failed fetch simply shows nothing.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = useCallback(async (id: string) => {
    // Optimistic hide; if the POST fails the dismissal was not recorded, so
    // the announcement may resurface on the next page load — acceptable for
    // a best-effort banner.
    setAnnouncements((current) => current.filter((item) => item.id !== id))
    try {
      const response = await fetch(DISMISS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id }),
      })
      if (!response.ok) throw new Error("dismiss failed")
    } catch {
      // The dismissal was not recorded server-side; the card stays hidden
      // for this page view.
    }
  }, [])

  if (announcements.length === 0) return null

  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="announcement-banner">
      {announcements.map((announcement) => (
        <div
          key={announcement.id}
          role="status"
          className="border-border bg-card flex items-start gap-3 rounded-xl border px-4 py-3"
        >
          <Megaphone aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 flex-none" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-semibold">{announcement.title}</p>
            <p className="text-muted-foreground mt-0.5 text-sm">{announcement.body}</p>
            {announcement.ctaLabel && announcement.ctaHref ? (
              announcement.ctaHref.startsWith("/") ? (
                <Link
                  href={announcement.ctaHref}
                  className="text-primary mt-1.5 inline-block text-sm font-medium underline-offset-2 hover:underline"
                >
                  {announcement.ctaLabel}
                </Link>
              ) : (
                <a
                  href={announcement.ctaHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-1.5 inline-block text-sm font-medium underline-offset-2 hover:underline"
                >
                  {announcement.ctaLabel}
                </a>
              )
            ) : null}
          </div>
          <button
            type="button"
            aria-label={`Dismiss announcement: ${announcement.title}`}
            onClick={() => void dismiss(announcement.id)}
            className="app-icon-button flex-none"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
