"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Handshake, Link2 } from "lucide-react"

import { CopyButton } from "@/components/app/copy-button"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * User-facing affiliate screen for `/app/affiliate`: applies to the program
 * when the caller has no account, otherwise shows the dashboard — status
 * badge, tracking code, share link (which routes through the public click
 * tracker at `/api/affiliate/click/[code]`), and click/conversion stats.
 * Backed by `GET /api/affiliate` and `POST /api/affiliate/apply`; the store
 * is the in-memory dev seam in `src/lib/affiliate.ts` and there are no real
 * payouts.
 */

const AFFILIATE_API = "/api/affiliate"
const APPLY_API = "/api/affiliate/apply"

export type AffiliateStatus = "pending" | "active" | "suspended" | "rejected"

export interface AffiliateAccountView {
  id: string
  userId: string
  email: string
  status: AffiliateStatus
  code: string
  commissionRatePct: number
  createdAt: string
}

export interface AffiliateStatsView {
  clicks: number
  conversions: number
  revenueCents: number
  commissionCents: number
}

interface AffiliateResponse {
  ok: boolean
  affiliate?: AffiliateAccountView | null
  stats?: AffiliateStatsView | null
  sharePath?: string | null
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

function shareUrl(sharePath: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${sharePath}?to=${encodeURIComponent("/")}`
}

export function AffiliateScreen() {
  const [affiliate, setAffiliate] = useState<AffiliateAccountView | null>(null)
  const [stats, setStats] = useState<AffiliateStatsView | null>(null)
  const [sharePath, setSharePath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const current = ++seq.current
    setLoadError(null)
    try {
      const response = await fetch(AFFILIATE_API, { cache: "no-store" })
      const data = (await response.json()) as AffiliateResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setLoadError(data.message ?? "Could not load your affiliate status.")
        return
      }
      setAffiliate(data.affiliate ?? null)
      setStats(data.stats ?? null)
      setSharePath(data.sharePath ?? null)
      setLoaded(true)
    } catch {
      if (current === seq.current) {
        setLoadError("Could not load your affiliate status.")
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const apply = async () => {
    setApplying(true)
    setApplyError(null)
    try {
      const response = await fetch(APPLY_API, { method: "POST" })
      const data = (await response.json()) as AffiliateResponse
      if (!response.ok || !data.ok || !data.affiliate) {
        setApplyError(data.message ?? "Could not submit your application.")
        return
      }
      setAffiliate(data.affiliate)
      setStats({ clicks: 0, conversions: 0, revenueCents: 0, commissionCents: 0 })
      setSharePath(`/api/affiliate/click/${data.affiliate.code}`)
      setLoaded(true)
    } catch {
      setApplyError("Could not submit your application.")
    } finally {
      setApplying(false)
    }
  }

  if (!loaded && loadError) {
    return (
      <ErrorState
        title="Affiliate program unavailable"
        message={loadError}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  if (!loaded) {
    return (
      <LoadingPanel label="Loading affiliate program" className="min-h-48">
        <div className="grid gap-3">
          <div className="bg-muted h-24 animate-pulse rounded-xl" />
          <div className="bg-muted h-40 animate-pulse rounded-xl" />
        </div>
      </LoadingPanel>
    )
  }

  if (!affiliate) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Handshake className="size-5" aria-hidden="true" />
            Apply to the affiliate program
          </CardTitle>
          <CardDescription>
            Share your unique tracking link and earn commission on conversions. Applications are
            reviewed by the team before your link starts tracking.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {applyError ? <InlineError message={applyError} /> : null}
          <div>
            <Button type="button" onClick={() => void apply()} disabled={applying}>
              {applying ? "Submitting…" : "Apply now"}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const link = sharePath ? shareUrl(sharePath) : null

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Your affiliate account</CardTitle>
              <CardDescription>
                {affiliate.email} · applied {new Date(affiliate.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
            <Badge variant={statusBadgeVariant(affiliate.status)} className="capitalize">
              {affiliate.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {affiliate.status === "pending" ? (
            <p className="text-muted-foreground text-sm">
              Your application is under review. Your tracking link will start recording clicks and
              conversions once approved.
            </p>
          ) : null}
          {affiliate.status === "suspended" ? (
            <p className="text-muted-foreground text-sm">
              This account is suspended — your tracking link is not recording activity. Contact
              support if you believe this is a mistake.
            </p>
          ) : null}
          {affiliate.status === "rejected" ? (
            <p className="text-muted-foreground text-sm">
              Your application was not approved. Contact support for details.
            </p>
          ) : null}

          <div className="grid gap-2">
            <span className="text-sm font-medium">Tracking code</span>
            <div className="flex items-center gap-2">
              <code className="bg-muted rounded-md px-2 py-1 font-mono text-sm">
                {affiliate.code}
              </code>
              <CopyButton text={affiliate.code} label="Copy code" />
            </div>
          </div>

          {link ? (
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
          ) : null}
        </CardContent>
      </Card>

      {stats ? (
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
      ) : null}
    </div>
  )
}
