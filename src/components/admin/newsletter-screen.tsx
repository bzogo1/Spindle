"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, MailPlus, Search } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
 * Admin "Newsletter" screen for `/app/admin/newsletter`: subscriber stats
 * cards, a filterable/paginated subscriber table backed by
 * `GET /api/admin/newsletter`, and a campaigns section backed by
 * `GET|POST /api/admin/newsletter/campaigns`.
 *
 * Campaign creation only stores a draft — delivery is a later task, so the
 * form says so. Both endpoints are admin-only; the store behind them is the
 * in-memory dev seam in `src/lib/newsletter-store.ts`.
 */

const NEWSLETTER_API = "/api/admin/newsletter"
const CAMPAIGNS_API = "/api/admin/newsletter/campaigns"
const PAGE_SIZE = 50
const CAMPAIGN_PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
const SUBJECT_MAX = 200
const BODY_MAX = 50_000

export type NewsletterSubscriberStatus = "pending" | "active" | "unsubscribed"

export interface NewsletterSubscriberRow {
  id: string
  email: string
  source: string
  consentedAt: string
  status: NewsletterSubscriberStatus
  unsubscribedAt?: string
}

export interface NewsletterCampaignRow {
  id: string
  subject: string
  bodyPreview?: string
  status: "draft" | "scheduled" | "sent"
  createdAt: string
  recipientCount?: number
}

interface SubscribersResponse {
  ok: boolean
  stats?: {
    subscribers: Record<NewsletterSubscriberStatus, number> & { total: number }
    campaigns: Record<"draft" | "scheduled" | "sent", number> & { total: number }
  }
  subscribers?: NewsletterSubscriberRow[]
  total?: number
  message?: string
}

interface CampaignsResponse {
  ok: boolean
  campaigns?: NewsletterCampaignRow[]
  total?: number
  message?: string
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "unsubscribed", label: "Unsubscribed" },
]

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function statusBadgeVariant(status: string) {
  if (status === "active" || status === "sent") return "secondary" as const
  if (status === "unsubscribed") return "destructive" as const
  return "outline" as const
}

export function NewsletterScreen() {
  const [statusFilter, setStatusFilter] = useState("")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  // Pagination is keyed to the filter signature: when filters change the key
  // no longer matches and the effective offset falls back to 0.
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [stats, setStats] = useState<SubscribersResponse["stats"] | null>(null)
  const [subscribers, setSubscribers] = useState<NewsletterSubscriberRow[] | null>(null)
  const [subscribersTotal, setSubscribersTotal] = useState(0)
  const [subscribersError, setSubscribersError] = useState<string | null>(null)
  const subscribersSeq = useRef(0)

  const [campaigns, setCampaigns] = useState<NewsletterCampaignRow[] | null>(null)
  const [campaignsTotal, setCampaignsTotal] = useState(0)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const [campaignReloadKey, setCampaignReloadKey] = useState(0)

  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const filtersKey = JSON.stringify({ status: statusFilter, q: debouncedQuery })
  const offset = page.key === filtersKey ? page.offset : 0

  const subscribersQuery = useCallback(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (statusFilter) params.set("status", statusFilter)
    if (debouncedQuery) params.set("q", debouncedQuery)
    return params.toString()
  }, [statusFilter, debouncedQuery, offset])

  // Subscribers + stats share one endpoint; refetches on filter/page/retry.
  useEffect(() => {
    const seq = ++subscribersSeq.current
    setSubscribers(null)
    setSubscribersError(null)
    void (async () => {
      try {
        const response = await fetch(`${NEWSLETTER_API}?${subscribersQuery()}`, {
          cache: "no-store",
        })
        const data = (await response.json()) as SubscribersResponse
        if (seq !== subscribersSeq.current) return
        if (!response.ok || !data.ok) {
          setSubscribersError(data.message ?? "Could not load subscribers.")
          setSubscribers([])
          return
        }
        setStats(data.stats ?? null)
        setSubscribers(data.subscribers ?? [])
        setSubscribersTotal(data.total ?? 0)
      } catch {
        if (seq !== subscribersSeq.current) return
        setSubscribersError("Could not load subscribers. Check your connection and try again.")
        setSubscribers([])
      }
    })()
  }, [subscribersQuery, reloadKey])

  const loadCampaigns = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(CAMPAIGN_PAGE_SIZE), offset: "0" })
      const response = await fetch(`${CAMPAIGNS_API}?${params.toString()}`, { cache: "no-store" })
      const data = (await response.json()) as CampaignsResponse
      if (!response.ok || !data.ok) {
        setCampaignsError(data.message ?? "Could not load campaigns.")
        setCampaigns([])
        return
      }
      setCampaigns(data.campaigns ?? [])
      setCampaignsTotal(data.total ?? 0)
      setCampaignsError(null)
    } catch {
      setCampaignsError("Could not load campaigns. Check your connection and try again.")
      setCampaigns([])
    }
  }, [])

  useEffect(() => {
    setCampaigns(null)
    void loadCampaigns()
  }, [loadCampaigns, campaignReloadKey])

  const createCampaign = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const response = await fetch(CAMPAIGNS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() || undefined }),
      })
      const data = (await response.json()) as { ok: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the campaign.")
        return
      }
      setSubject("")
      setBody("")
      setCreateNotice("Draft campaign saved. Sending is not enabled yet.")
      setCampaignReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the campaign. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [subject, body])

  const subscribersLoading = subscribers === null && subscribersError === null
  const subscribersEmpty = subscribers !== null && subscribers.length === 0
  const hasActiveFilters = Boolean(statusFilter || debouncedQuery)
  const rangeStart = subscribersTotal === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (subscribers?.length ?? 0), subscribersTotal)

  return (
    <div className="flex flex-col gap-6">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Subscribers</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.subscribers.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.subscribers.active}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.subscribers.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Unsubscribed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.subscribers.unsubscribed}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <section className="app-panel" aria-labelledby="admin-newsletter-subscribers-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-newsletter-subscribers-heading">Subscribers</h2>
            <p>Everyone who signed up via the site forms, newest first.</p>
          </div>
          <div className="app-panel-head-actions">
            <form
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                setDebouncedQuery(query.trim())
              }}
            >
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search email or source"
                  aria-label="Search subscribers"
                  className="w-64 pl-8"
                />
              </div>
            </form>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="newsletter-filter-status" className="text-muted-foreground text-xs">
              Status
            </label>
            <Select
              id="newsletter-filter-status"
              aria-label="Subscriber status"
              options={STATUS_OPTIONS}
              value={statusFilter || null}
              onChange={(value) => setStatusFilter(typeof value === "string" ? value : "")}
            />
          </div>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("")
                setQuery("")
                setDebouncedQuery("")
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {subscribersError ? (
          <InlineError
            title="Subscribers unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{subscribersError}</span>
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

        {subscribersLoading ? (
          <LoadingPanel label="Loading subscribers" variant="table" />
        ) : subscribersEmpty ? (
          <EmptyState
            icon={<Mail aria-hidden="true" />}
            title={hasActiveFilters ? "No matching subscribers" : "No subscribers yet"}
            body={
              hasActiveFilters
                ? "Nothing matches the current filters. Try a different search or status."
                : "Signups from the site forms will appear here."
            }
          />
        ) : subscribersError ? null : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Consented</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(subscribers ?? []).map((subscriber) => (
                  <TableRow key={subscriber.id}>
                    <TableCell className="font-medium">{subscriber.email}</TableCell>
                    <TableCell>{subscriber.source || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(subscriber.status)}>
                        {subscriber.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(subscriber.consentedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                Showing {rangeStart}–{rangeEnd} of {subscribersTotal}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() =>
                    setPage({ key: filtersKey, offset: Math.max(0, offset - PAGE_SIZE) })
                  }
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= subscribersTotal}
                  onClick={() => setPage({ key: filtersKey, offset: offset + PAGE_SIZE })}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="app-panel" aria-labelledby="admin-newsletter-campaigns-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-newsletter-campaigns-heading">Campaigns</h2>
            <p>
              Draft campaigns recorded for the newsletter. Sending is not enabled yet — drafts are
              stored only.
            </p>
          </div>
        </div>

        <form
          className="mb-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!subject.trim() || creating) return
            void createCampaign()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="campaign-subject" className="text-muted-foreground text-xs">
              Subject
            </label>
            <Input
              id="campaign-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Campaign subject"
              maxLength={SUBJECT_MAX}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="campaign-body" className="text-muted-foreground text-xs">
              Body
            </label>
            <Textarea
              id="campaign-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Campaign body (plain text)"
              rows={4}
              maxLength={BODY_MAX}
              showCount
            />
          </div>
          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}
          {createNotice ? <p className="text-muted-foreground text-sm">{createNotice}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={creating || !subject.trim()}>
              <MailPlus aria-hidden="true" className="size-4" />
              {creating ? "Saving…" : "Save draft"}
            </Button>
          </div>
        </form>

        {campaignsError ? (
          <InlineError
            title="Campaigns unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{campaignsError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCampaignReloadKey((key) => key + 1)}
                >
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {campaigns === null && !campaignsError ? (
          <LoadingPanel label="Loading campaigns" variant="table" />
        ) : campaigns !== null && campaigns.length === 0 ? (
          <EmptyState
            icon={<MailPlus aria-hidden="true" />}
            title="No campaigns yet"
            body="Draft campaigns you save will appear here."
          />
        ) : campaignsError ? null : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(campaigns ?? []).map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.subject}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(campaign.status)}>{campaign.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(campaign.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">{campaign.recipientCount ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {campaignsTotal > (campaigns?.length ?? 0) ? (
              <p className="text-muted-foreground mt-4 text-sm">
                Showing the {campaigns?.length ?? 0} most recent of {campaignsTotal} campaigns.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
