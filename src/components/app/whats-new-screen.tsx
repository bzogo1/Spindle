"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCheck, ExternalLink, Sparkles } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  changelogReleases,
  formatReleaseDate,
  getReleasePath,
  type ChangelogRelease,
} from "@/lib/changelog"

/**
 * "What's new" screen for `/app/whats-new`: the in-app changelog with
 * per-user seen state.
 *
 * The release list is the static `changelogReleases` data; unseen flags come
 * from `GET /api/changelog/notify` (the caller's entries newer than their
 * last-seen date). "Mark all seen" and per-entry "Mark seen" POST to
 * `/api/changelog/seen`, which advances the caller's last-seen date — state
 * is per-user and lives in the dev-seam store until a real table exists.
 * "View full changelog" links to the public `/changelog` pages.
 */

const NOTIFY_API = "/api/changelog/notify"
const SEEN_API = "/api/changelog/seen"

interface UnseenEntry {
  id: string
  title: string
  date: string
  version: string
  summary: string
  url: string
}

interface NotifyResponse {
  ok: boolean
  unseen?: UnseenEntry[]
  unseenCount?: number
  lastSeen?: string | null
  message?: string
}

interface SeenResponse {
  ok: boolean
  lastSeen?: string | null
  message?: string
}

function releaseEntry(release: ChangelogRelease) {
  return {
    id: release.slug,
    title: release.title,
    date: release.date,
    version: release.version,
    summary: release.summary,
    url: getReleasePath(release),
  }
}

export function WhatsNewScreen() {
  const [unseenIds, setUnseenIds] = useState<Set<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(NOTIFY_API, { cache: "no-store" })
      const data = (await response.json()) as NotifyResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load what's new.")
        setUnseenIds(new Set())
        return
      }
      setUnseenIds(new Set((data.unseen ?? []).map((entry) => entry.id)))
    } catch {
      setError("Could not load what's new. Check your connection and try again.")
      setUnseenIds(new Set())
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markSeen = useCallback(async (entryId: string | null) => {
    if (entryId === null) setMarkingAll(true)
    else setMarkingId(entryId)
    try {
      const response = await fetch(SEEN_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entryId === null ? { all: true } : { entryId }),
      })
      const data = (await response.json()) as SeenResponse
      if (response.ok && data.ok) {
        // Marking an entry seen also marks everything older. Releases are
        // newest-first, so entries at index >= cutoff are that entry and
        // everything older — drop those from the unseen set; newer entries
        // (smaller index) stay unseen. "all" clears the set entirely.
        if (entryId === null) {
          setUnseenIds(new Set())
        } else {
          const ordered = changelogReleases.map((r) => r.slug)
          const cutoff = ordered.indexOf(entryId)
          setUnseenIds((current) => {
            if (!current) return current
            const next = new Set(current)
            for (const id of next) {
              const idx = ordered.indexOf(id)
              if (idx >= cutoff) next.delete(id)
            }
            return next
          })
        }
      }
    } catch {
      // Best-effort; the next load reconciles with the server.
    } finally {
      setMarkingAll(false)
      setMarkingId(null)
    }
  }, [])

  const unseenCount = unseenIds?.size ?? 0
  const loading = unseenIds === null && error === null

  const releases = useMemo(() => changelogReleases.map(releaseEntry), [])

  return (
    <section className="app-panel" aria-labelledby="whats-new-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="whats-new-heading">What's new</h2>
          <p>
            The latest Spindle releases.{" "}
            {unseenCount > 0 ? `${unseenCount} unseen.` : "You're all caught up."}
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void markSeen(null)}
            disabled={unseenCount === 0 || markingAll}
          >
            <CheckCheck aria-hidden="true" />
            Mark all seen
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href="/changelog">
              <ExternalLink aria-hidden="true" />
              Full changelog
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="What's new unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading what's new" variant="table" />
      ) : releases.length === 0 ? (
        <EmptyState
          icon={<Sparkles aria-hidden="true" />}
          title="Nothing here yet"
          body="New releases will show up here as they ship."
        />
      ) : (
        <ul className="app-messages-list">
          {releases.map((entry) => {
            const unseen = unseenIds?.has(entry.id) ?? false
            return (
              <li key={entry.id} className="app-messages-item" data-unread={unseen || undefined}>
                <div className="flex flex-col gap-1 p-3.5">
                  <span className="app-messages-summary">
                    <span className="app-messages-subject">
                      {unseen ? (
                        <span className="app-messages-unread-dot" aria-label="New" />
                      ) : null}
                      <Badge variant="secondary" size="sm">
                        v{entry.version}
                      </Badge>
                      {entry.title}
                      {unseen ? (
                        <Badge variant="outline" size="sm">
                          New
                        </Badge>
                      ) : null}
                    </span>
                    <span className="app-messages-meta">
                      <time dateTime={entry.date}>{formatReleaseDate(entry.date)}</time>
                    </span>
                    <span className="text-muted-foreground text-sm whitespace-pre-wrap">
                      {entry.summary}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <Link
                        href={entry.url}
                        className="text-sm font-medium underline underline-offset-4"
                      >
                        Read the release notes
                      </Link>
                      {unseen ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void markSeen(entry.id)}
                          disabled={markingId === entry.id}
                        >
                          Mark seen
                        </Button>
                      ) : null}
                    </span>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
