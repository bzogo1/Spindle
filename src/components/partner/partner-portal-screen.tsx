"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Link2, Megaphone, Wallet } from "lucide-react"

import { CopyButton } from "@/components/app/copy-button"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Partner portal screen for `/app/partner`: the approved-affiliate
 * dashboard backed by `GET/PATCH /api/partner/portal`. Shows account
 * status, share link, click/conversion stats, a profile form (payout
 * method *label* and tax info status only — the API rejects any
 * sensitive fields), partner announcements, and resource links.
 */

const PORTAL_API = "/api/partner/portal"

export type PartnerTaxInfoStatus = "not_submitted" | "submitted" | "verified"

export interface PartnerProfileView {
  affiliateId: string
  payoutMethodLabel?: string
  taxInfoStatus: PartnerTaxInfoStatus
  createdAt: string
  updatedAt: string
}

export interface PartnerAnnouncementView {
  id: string
  title: string
  body: string
  audience: "all" | "active"
  publishedAt: string
  createdAt: string
}

export interface PartnerResourceLinkView {
  id: string
  title: string
  url: string
  description?: string
  createdAt: string
}

export interface PartnerStatsView {
  clicks: number
  conversions: number
  revenueCents: number
  commissionCents: number
}

interface PartnerPortalResponse {
  ok: boolean
  portal?: {
    affiliate: {
      id: string
      email: string
      status: string
      code: string
      commissionRatePct: number
      createdAt: string
    }
    stats: PartnerStatsView
    sharePath: string
    profile: PartnerProfileView | null
    announcements: PartnerAnnouncementView[]
    links: PartnerResourceLinkView[]
  } | null
  profile?: PartnerProfileView
  message?: string
}

const TAX_STATUS_OPTIONS = [
  { value: "not_submitted", label: "Not submitted" },
  { value: "submitted", label: "Submitted" },
  { value: "verified", label: "Verified" },
]

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function shareUrl(sharePath: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${sharePath}?to=${encodeURIComponent("/")}`
}

export function PartnerPortalScreen() {
  const [portal, setPortal] = useState<NonNullable<PartnerPortalResponse["portal"]> | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [payoutLabel, setPayoutLabel] = useState("")
  const [taxStatus, setTaxStatus] = useState<PartnerTaxInfoStatus>("not_submitted")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const current = ++seq.current
    setLoadError(null)
    setUnavailable(false)
    try {
      const response = await fetch(PORTAL_API, { cache: "no-store" })
      const data = (await response.json()) as PartnerPortalResponse
      if (current !== seq.current) return
      if (response.status === 403 || response.status === 404) {
        setUnavailable(true)
        setLoaded(true)
        return
      }
      if (!response.ok || !data.ok || !data.portal) {
        setLoadError(data.message ?? "Could not load the partner portal.")
        return
      }
      setPortal(data.portal)
      setPayoutLabel(data.portal.profile?.payoutMethodLabel ?? "")
      setTaxStatus(data.portal.profile?.taxInfoStatus ?? "not_submitted")
      setLoaded(true)
    } catch {
      if (current === seq.current) {
        setLoadError("Could not load the partner portal.")
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const saveProfile = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const response = await fetch(PORTAL_API, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payoutMethodLabel: payoutLabel.trim() ? payoutLabel.trim() : null,
          taxInfoStatus: taxStatus,
        }),
      })
      const data = (await response.json()) as PartnerPortalResponse
      if (!response.ok || !data.ok || !data.profile) {
        setSaveError(data.message ?? "Could not save your profile.")
        return
      }
      setPortal((current) => (current ? { ...current, profile: data.profile! } : current))
      setSaved(true)
    } catch {
      setSaveError("Could not save your profile.")
    } finally {
      setSaving(false)
    }
  }

  if (!loaded && loadError) {
    return (
      <ErrorState
        title="Partner portal unavailable"
        message={loadError}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  if (!loaded) {
    return (
      <LoadingPanel label="Loading partner portal" className="min-h-48">
        <div className="grid gap-3">
          <div className="bg-muted h-24 animate-pulse rounded-xl" />
          <div className="bg-muted h-40 animate-pulse rounded-xl" />
        </div>
      </LoadingPanel>
    )
  }

  if (unavailable || !portal) {
    return (
      <EmptyState
        icon={<Wallet className="size-5" aria-hidden="true" />}
        title="Partner portal unavailable"
        body="The partner portal is available to approved affiliate partners. If your application is still under review, check the affiliate program page."
      />
    )
  }

  const { affiliate, stats, sharePath, announcements, links } = portal
  const link = shareUrl(sharePath)

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Your partner account</CardTitle>
              <CardDescription>
                {affiliate.email} · partner since{" "}
                {new Date(affiliate.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
            <Badge variant="secondary" className="capitalize">
              {affiliate.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Tracking code</span>
            <div className="flex items-center gap-2">
              <code className="bg-muted rounded-md px-2 py-1 font-mono text-sm">
                {affiliate.code}
              </code>
              <CopyButton text={affiliate.code} label="Copy code" />
            </div>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Share link</span>
            <div className="flex items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-sm">
                {link}
              </code>
              <CopyButton text={link} label="Copy link" />
            </div>
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <Link2 className="size-3" aria-hidden="true" />
              Opens your link and records a click before redirecting visitors.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
          <CardDescription>
            Commission rate: {affiliate.commissionRatePct}% of tracked revenue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clicks</TableHead>
                <TableHead>Conversions</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{stats.clicks.toLocaleString()}</TableCell>
                <TableCell>{stats.conversions.toLocaleString()}</TableCell>
                <TableCell>{formatCents(stats.revenueCents)}</TableCell>
                <TableCell>{formatCents(stats.commissionCents)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payout &amp; tax profile</CardTitle>
          <CardDescription>
            Store a payout method label and your tax documentation status. For your security, never
            enter bank account numbers, card numbers, or tax IDs here — the portal does not accept
            them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          {saveError ? <InlineError message={saveError} /> : null}
          {saved ? (
            <p className="text-sm text-green-600 dark:text-green-400">Profile saved.</p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="payout-method-label">Payout method label</Label>
            <Input
              id="payout-method-label"
              value={payoutLabel}
              onChange={(event) => setPayoutLabel(event.target.value)}
              placeholder="e.g. PayPal, Wise, Bank transfer"
              maxLength={80}
            />
            <p className="text-muted-foreground text-xs">
              A label only — account and routing numbers are never stored.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tax-info-status">Tax info status</Label>
            <Select
              id="tax-info-status"
              aria-label="Tax info status"
              options={TAX_STATUS_OPTIONS}
              value={taxStatus}
              onChange={(value) => setTaxStatus((value as PartnerTaxInfoStatus) ?? "not_submitted")}
            />
          </div>
          <div>
            <Button type="button" onClick={() => void saveProfile()} disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="size-5" aria-hidden="true" />
            Announcements
          </CardTitle>
          <CardDescription>Messages from the partner team.</CardDescription>
        </CardHeader>
        <CardContent>
          {announcements.length === 0 ? (
            <p className="text-muted-foreground text-sm">No announcements yet.</p>
          ) : (
            <ul className="grid gap-4">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{announcement.title}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(announcement.publishedAt).toLocaleDateString()}
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
          <CardTitle>Resources</CardTitle>
          <CardDescription>Guides and assets for partners.</CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-muted-foreground text-sm">No resources yet.</p>
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
                  {link.description ? (
                    <p className="text-muted-foreground text-sm">{link.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
