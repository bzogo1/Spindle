"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Megaphone, Users } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Partner portal" screen for `/app/admin/partner-portal`: the
 * partner overview (affiliate accounts joined with their portal profile
 * extensions and stats), plus forms to publish portal announcements and
 * resource links. Backed by `GET/POST /api/admin/partner-portal`; stores
 * are the in-memory dev seams — there are no real payouts.
 */

const API = "/api/admin/partner-portal"

type AffiliateStatus = "pending" | "active" | "suspended" | "rejected"
type TaxInfoStatus = "not_submitted" | "submitted" | "verified"

interface PartnerStats {
  clicks: number
  conversions: number
  revenueCents: number
  commissionCents: number
}

interface PartnerRow {
  id: string
  userId: string
  email: string
  status: AffiliateStatus
  code: string
  commissionRatePct: number
  createdAt: string
  stats: PartnerStats
  profile: {
    affiliateId: string
    payoutMethodLabel?: string
    taxInfoStatus: TaxInfoStatus
    createdAt: string
    updatedAt: string
  } | null
}

interface AnnouncementRow {
  id: string
  title: string
  body: string
  audience: "all" | "active"
  publishedAt: string
  createdAt: string
}

interface LinkRow {
  id: string
  title: string
  url: string
  description?: string
  createdAt: string
}

interface AdminPortalResponse {
  ok: boolean
  partners?: PartnerRow[]
  announcements?: AnnouncementRow[]
  links?: LinkRow[]
  announcement?: AnnouncementRow
  link?: LinkRow
  message?: string
}

function statusBadgeVariant(status: AffiliateStatus) {
  switch (status) {
    case "active":
      return "secondary" as const
    case "pending":
      return "default" as const
    case "suspended":
      return "outline" as const
    case "rejected":
      return "destructive" as const
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

export function AdminPartnerPortalScreen() {
  const [partners, setPartners] = useState<PartnerRow[] | null>(null)
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [annTitle, setAnnTitle] = useState("")
  const [annBody, setAnnBody] = useState("")
  const [annAudience, setAnnAudience] = useState<"all" | "active">("all")
  const [annSending, setAnnSending] = useState(false)
  const [annError, setAnnError] = useState<string | null>(null)

  const [linkTitle, setLinkTitle] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [linkDescription, setLinkDescription] = useState("")
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const current = ++seq.current
    setPartners(null)
    setListError(null)
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as AdminPortalResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load the partner portal.")
        return
      }
      setPartners(data.partners ?? [])
      setAnnouncements(data.announcements ?? [])
      setLinks(data.links ?? [])
    } catch {
      if (current === seq.current) setListError("Could not load the partner portal.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const sendAnnouncement = async () => {
    setAnnSending(true)
    setAnnError(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "announcement",
          title: annTitle,
          body: annBody,
          audience: annAudience,
        }),
      })
      const data = (await response.json()) as AdminPortalResponse
      if (!response.ok || !data.ok || !data.announcement) {
        setAnnError(data.message ?? "Could not send the announcement.")
        return
      }
      setAnnTitle("")
      setAnnBody("")
      setReloadKey((key) => key + 1)
    } catch {
      setAnnError("Could not send the announcement.")
    } finally {
      setAnnSending(false)
    }
  }

  const addLink = async () => {
    setLinkSaving(true)
    setLinkError(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "resource",
          title: linkTitle,
          url: linkUrl,
          ...(linkDescription.trim() ? { description: linkDescription.trim() } : {}),
        }),
      })
      const data = (await response.json()) as AdminPortalResponse
      if (!response.ok || !data.ok || !data.link) {
        setLinkError(data.message ?? "Could not add the resource link.")
        return
      }
      setLinkTitle("")
      setLinkUrl("")
      setLinkDescription("")
      setReloadKey((key) => key + 1)
    } catch {
      setLinkError("Could not add the resource link.")
    } finally {
      setLinkSaving(false)
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {partners === null
            ? "Loading…"
            : `${partners.filter((p) => p.status === "active").length} active partners`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Refresh
        </Button>
      </div>

      {listError ? (
        <ErrorState
          title="Partner portal unavailable"
          message={listError}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {partners === null && !listError ? (
        <LoadingPanel label="Loading partner portal" className="min-h-48">
          <div className="bg-muted h-64 animate-pulse rounded-xl" />
        </LoadingPanel>
      ) : null}

      {partners !== null ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" aria-hidden="true" />
              Partners
            </CardTitle>
            <CardDescription>
              Affiliate accounts joined with their portal profile extensions. Profiles store payout
              method labels and tax status only — never bank or tax identifiers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {partners.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" aria-hidden="true" />}
                title="No partners yet"
                body="Approved affiliates will appear here once they apply and are activated."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payout label</TableHead>
                    <TableHead>Tax info</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Conversions</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partners.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.email}</div>
                        <div className="text-muted-foreground text-xs">
                          {row.commissionRatePct}% rate · joined {formatDate(row.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                          {row.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(row.status)} className="capitalize">
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.profile?.payoutMethodLabel ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="capitalize">
                        {row.profile ? row.profile.taxInfoStatus.replace(/_/g, " ") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.stats.clicks.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.stats.conversions.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCents(row.stats.commissionCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="size-5" aria-hidden="true" />
              Send announcement
            </CardTitle>
            <CardDescription>
              Publish a message to the partner portal. "All partners" reaches every affiliate status
              that can see the portal; "Active partners" is approved partners only.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {annError ? <InlineError message={annError} /> : null}
            <div className="grid gap-2">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={annTitle}
                onChange={(event) => setAnnTitle(event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body"
                value={annBody}
                onChange={(event) => setAnnBody(event.target.value)}
                maxLength={5000}
                rows={4}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ann-audience">Audience</Label>
              <Select
                id="ann-audience"
                aria-label="Audience"
                options={[
                  { value: "all", label: "All partners" },
                  { value: "active", label: "Active partners" },
                ]}
                value={annAudience}
                onChange={(value) => setAnnAudience((value as "all" | "active") ?? "all")}
              />
            </div>
            <div>
              <Button
                type="button"
                onClick={() => void sendAnnouncement()}
                disabled={annSending || !annTitle.trim() || !annBody.trim()}
              >
                {annSending ? "Sending…" : "Send announcement"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add resource link</CardTitle>
            <CardDescription>
              Internal path or https:// URL shown in the partner portal resources list.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {linkError ? <InlineError message={linkError} /> : null}
            <div className="grid gap-2">
              <Label htmlFor="link-title">Title</Label>
              <Input
                id="link-title"
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="/docs/partner-guide or https://…"
                maxLength={500}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="link-description">Description (optional)</Label>
              <Input
                id="link-description"
                value={linkDescription}
                onChange={(event) => setLinkDescription(event.target.value)}
                maxLength={500}
              />
            </div>
            <div>
              <Button
                type="button"
                onClick={() => void addLink()}
                disabled={linkSaving || !linkTitle.trim() || !linkUrl.trim()}
              >
                {linkSaving ? "Adding…" : "Add link"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Announcements</CardTitle>
          <CardDescription>All portal announcements, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {announcements.length === 0 ? (
            <p className="text-muted-foreground text-sm">No announcements yet.</p>
          ) : (
            <ul className="grid gap-3">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="grid gap-1 border-b pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{announcement.title}</span>
                    <Badge variant="outline">{announcement.audience}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(announcement.publishedAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">{announcement.body}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resource links</CardTitle>
          <CardDescription>All portal resource links, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-muted-foreground text-sm">No resource links yet.</p>
          ) : (
            <ul className="grid gap-3">
              {links.map((link) => (
                <li key={link.id} className="grid gap-1">
                  <a
                    href={link.url}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {link.title}
                  </a>
                  <p className="text-muted-foreground text-xs">
                    {link.url}
                    {link.description ? ` · ${link.description}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
