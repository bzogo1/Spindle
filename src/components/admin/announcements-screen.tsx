"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Megaphone, Plus } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Announcements" screen for `/app/admin/announcements`: a list of
 * every stored announcement (live, scheduled, expired) backed by
 * `GET /api/admin/announcements`, plus a create form posting to the same
 * endpoint. Both are admin-only; the store behind them is the in-memory dev
 * seam in `src/lib/announcements.ts`.
 *
 * There is no draft state — submitting the form publishes immediately;
 * `startsAt` in the future schedules visibility.
 */

const ANNOUNCEMENTS_API = "/api/admin/announcements"
const TITLE_MAX = 200
const BODY_MAX = 5000
const CTA_LABEL_MAX = 80
const CTA_HREF_MAX = 500

export interface AnnouncementRow {
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
  announcements?: AnnouncementRow[]
  announcement?: AnnouncementRow
  message?: string
}

const AUDIENCE_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "admins", label: "Admins only" },
]

type WindowStatus = "live" | "scheduled" | "expired"

function windowStatus(announcement: AnnouncementRow, now: number): WindowStatus {
  const starts = Date.parse(announcement.startsAt)
  const ends = announcement.endsAt ? Date.parse(announcement.endsAt) : null
  if (starts > now) return "scheduled"
  if (ends !== null && ends <= now) return "expired"
  return "live"
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function statusBadgeVariant(status: WindowStatus) {
  if (status === "live") return "secondary" as const
  if (status === "expired") return "outline" as const
  return "default" as const
}

/** `datetime-local` input value → ISO string, or null when empty/invalid. */
function toIso(local: string): string | null {
  if (!local) return null
  const time = new Date(local).getTime()
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

export function AnnouncementsScreen() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [ctaLabel, setCtaLabel] = useState("")
  const [ctaHref, setCtaHref] = useState("")
  const [audience, setAudience] = useState<"all" | "admins">("all")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const current = ++seq.current
    setAnnouncements(null)
    setListError(null)
    try {
      const response = await fetch(ANNOUNCEMENTS_API, { cache: "no-store" })
      const data = (await response.json()) as AnnouncementsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load announcements.")
        setAnnouncements([])
        return
      }
      setAnnouncements(data.announcements ?? [])
    } catch {
      if (current !== seq.current) return
      setListError("Could not load announcements. Check your connection and try again.")
      setAnnouncements([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const create = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const startsIso = toIso(startsAt)
      const endsIso = toIso(endsAt)
      const response = await fetch(ANNOUNCEMENTS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim() } : {}),
          ...(ctaHref.trim() ? { ctaHref: ctaHref.trim() } : {}),
          audience,
          startsAt: startsIso,
          ...(endsIso ? { endsAt: endsIso } : {}),
        }),
      })
      const data = (await response.json()) as AnnouncementsResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not publish the announcement.")
        return
      }
      setTitle("")
      setBody("")
      setCtaLabel("")
      setCtaHref("")
      setAudience("all")
      setStartsAt("")
      setEndsAt("")
      setCreateNotice("Announcement published.")
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not publish the announcement. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [title, body, ctaLabel, ctaHref, audience, startsAt, endsAt])

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    startsAt.length > 0 &&
    toIso(startsAt) !== null &&
    (endsAt.length === 0 || toIso(endsAt) !== null) &&
    !creating

  const now = Date.now()
  const loading = announcements === null && listError === null
  const empty = announcements !== null && announcements.length === 0

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="admin-announcements-list-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-announcements-list-heading">Published announcements</h2>
            <p>
              Every announcement ever created, newest first — live, scheduled, and expired.
              Dismissals are per-user and stored in memory (dev seam).
            </p>
          </div>
        </div>

        {listError ? (
          <InlineError
            title="Announcements unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{listError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {loading ? (
          <LoadingPanel label="Loading announcements" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<Megaphone aria-hidden="true" />}
            title="No announcements yet"
            body="Publish your first announcement with the form below."
          />
        ) : listError ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(announcements ?? []).map((announcement) => {
                const status = windowStatus(announcement, now)
                return (
                  <TableRow key={announcement.id}>
                    <TableCell className="font-medium">{announcement.title}</TableCell>
                    <TableCell>
                      <Badge variant={announcement.audience === "admins" ? "outline" : "secondary"}>
                        {announcement.audience === "admins" ? "Admins" : "Everyone"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatDateTime(announcement.startsAt)}
                      {announcement.endsAt ? ` → ${formatDateTime(announcement.endsAt)}` : " →"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(announcement.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="app-panel" aria-labelledby="admin-announcements-create-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-announcements-create-heading">New announcement</h2>
            <p>
              Publishing is immediate — set a future <em>Starts at</em> to schedule it. Users can
              dismiss it; dismissals are remembered per user.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            void create()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="announcement-title" className="text-muted-foreground text-xs">
              Title
            </label>
            <Input
              id="announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Announcement title"
              maxLength={TITLE_MAX}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="announcement-body" className="text-muted-foreground text-xs">
              Body
            </label>
            <Textarea
              id="announcement-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Announcement body (plain text)"
              rows={3}
              maxLength={BODY_MAX}
              showCount
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="announcement-cta-label" className="text-muted-foreground text-xs">
                CTA label (optional)
              </label>
              <Input
                id="announcement-cta-label"
                value={ctaLabel}
                onChange={(event) => setCtaLabel(event.target.value)}
                placeholder="Learn more"
                maxLength={CTA_LABEL_MAX}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="announcement-cta-href" className="text-muted-foreground text-xs">
                CTA link (optional)
              </label>
              <Input
                id="announcement-cta-href"
                value={ctaHref}
                onChange={(event) => setCtaHref(event.target.value)}
                placeholder="/docs or https://…"
                maxLength={CTA_HREF_MAX}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="announcement-audience" className="text-muted-foreground text-xs">
                Audience
              </label>
              <Select
                id="announcement-audience"
                aria-label="Audience"
                options={AUDIENCE_OPTIONS}
                value={audience}
                onChange={(value) => setAudience(value === "admins" ? "admins" : "all")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="announcement-starts-at" className="text-muted-foreground text-xs">
                Starts at
              </label>
              <Input
                id="announcement-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="announcement-ends-at" className="text-muted-foreground text-xs">
                Ends at (optional)
              </label>
              <Input
                id="announcement-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </div>
          </div>

          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}
          {createNotice ? <p className="text-muted-foreground text-sm">{createNotice}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              <Plus aria-hidden="true" className="size-4" />
              {creating ? "Publishing…" : "Publish announcement"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
