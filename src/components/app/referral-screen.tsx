"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Gift, Link2 } from "lucide-react"

import { CopyButton } from "@/components/app/copy-button"
import { ReferralRewardsSection } from "@/components/app/referral-rewards-section"
import { ReferralShareButtons } from "@/components/app/referral-share-buttons"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { buildReferralShareUrl } from "@/lib/referral"
import { siteUrl } from "@/lib/site-url"

/**
 * User-facing referral screen for `/app/referral`: the caller's own
 * `SPN-…` code (generated on demand via `POST /api/referral/program`),
 * the share URL built with `buildReferralShareUrl`, an optional vanity
 * upgrade, and per-user attribution stats.
 *
 * Backed by `GET|POST /api/referral/program`; clicks/signups are recorded
 * by `POST /api/referral/attribution` from the `/r/[code]` landing page.
 * The store is the in-memory dev seam in `src/lib/referral-program.ts` —
 * rewards are reporting labels only, no payouts.
 */

const API = "/api/referral/program"

interface ProgramSettingsView {
  enabled: boolean
  rewardLabel: string
  rewardAmountCents: number | null
}

interface ReferralCodeView {
  code: string
  vanity: boolean
  createdAt: string
}

interface ReferralStatsView {
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

interface ProgramResponse {
  ok: boolean
  settings?: ProgramSettingsView
  code?: ReferralCodeView | null
  stats?: ReferralStatsView | null
  message?: string
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

export function ReferralScreen() {
  const [settings, setSettings] = useState<ProgramSettingsView | null>(null)
  const [code, setCode] = useState<ReferralCodeView | null>(null)
  const [stats, setStats] = useState<ReferralStatsView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const seq = useRef(0)

  const [creating, setCreating] = useState(false)
  const [vanity, setVanity] = useState("")
  const [vanityBusy, setVanityBusy] = useState(false)
  const [vanityError, setVanityError] = useState<string | null>(null)
  const [vanityNotice, setVanityNotice] = useState<string | null>(null)

  const applyPayload = useCallback((data: ProgramResponse) => {
    setSettings(data.settings ?? null)
    setCode(data.code ?? null)
    setStats(data.stats ?? null)
  }, [])

  const load = useCallback(async () => {
    const current = ++seq.current
    setLoadError(null)
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as ProgramResponse
      if (current !== seq.current) return
      if (response.status === 401) {
        setUnauthenticated(true)
        setLoaded(true)
        return
      }
      if (!response.ok || !data.ok) {
        setLoadError(data.message ?? "Could not load the referral program.")
        return
      }
      applyPayload(data)
      setLoaded(true)

      // Authenticated but no code yet — mint one so the share UI is ready.
      if (data.stats !== null && data.stats !== undefined && data.code === null) {
        setCreating(true)
        try {
          const created = await fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
          const createdData = (await created.json()) as ProgramResponse
          if (current === seq.current && created.ok && createdData.ok) {
            applyPayload(createdData)
          }
        } finally {
          if (current === seq.current) setCreating(false)
        }
      }
    } catch {
      if (current === seq.current) {
        setLoadError("Could not load the referral program.")
      }
    }
  }, [applyPayload])

  useEffect(() => {
    void load()
  }, [load])

  const saveVanity = async () => {
    const value = vanity.trim()
    if (!value) return
    setVanityBusy(true)
    setVanityError(null)
    setVanityNotice(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vanity: value }),
      })
      const data = (await response.json()) as ProgramResponse
      if (!response.ok || !data.ok) {
        setVanityError(data.message ?? "Could not update your code.")
        return
      }
      applyPayload(data)
      setVanity("")
      setVanityNotice("Referral code updated.")
    } catch {
      setVanityError("Could not update your code.")
    } finally {
      setVanityBusy(false)
    }
  }

  const shareUrl = code ? buildReferralShareUrl(siteUrl, code.code) : null

  return (
    <div className="grid gap-6">
      {loadError && <ErrorState message={loadError} />}
      {!loaded && !loadError && <LoadingPanel label="Loading your referral program" />}

      {loaded && unauthenticated && (
        <Card>
          <CardHeader>
            <CardTitle>Referral program</CardTitle>
            <CardDescription>Sign in to get your referral code and track invites.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {loaded && !unauthenticated && settings && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift aria-hidden="true" className="size-5" />
                {settings.enabled ? "Invite friends, earn rewards" : "Referral program"}
              </CardTitle>
              <CardDescription>
                {settings.enabled
                  ? settings.rewardLabel
                  : "The referral program is currently paused. Your code and stats are preserved."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {creating ? (
                <LoadingPanel label="Creating your referral code" lines={2} />
              ) : code && shareUrl ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="referral-code">Your referral code</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        id="referral-code"
                        className="bg-muted rounded-md border px-3 py-1.5 font-mono text-sm"
                      >
                        {code.code}
                      </code>
                      {code.vanity && <Badge variant="secondary">vanity</Badge>}
                      <CopyButton text={code.code} label="Copy code" />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="referral-link">Share link</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="referral-link"
                        readOnly
                        value={shareUrl}
                        onFocus={(event) => event.currentTarget.select()}
                        className="font-mono text-xs"
                      />
                      <CopyButton text={shareUrl} label="Copy link" />
                    </div>
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Link2 aria-hidden="true" className="size-3" />
                      Shares open a personalized invite page; the code attaches to signups
                      automatically.
                    </p>
                    <ReferralShareButtons code={code.code} shareUrl={shareUrl} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="referral-vanity">Vanity code (optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="referral-vanity"
                        value={vanity}
                        onChange={(event) => setVanity(event.target.value)}
                        placeholder="SPN-YOUR-NAME"
                        maxLength={64}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void saveVanity()}
                        disabled={vanityBusy || !vanity.trim()}
                      >
                        {vanityBusy ? "Saving…" : "Set code"}
                      </Button>
                    </div>
                    {vanityError && <InlineError message={vanityError} />}
                    {vanityNotice && (
                      <p className="text-muted-foreground text-sm">{vanityNotice}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Your referral code could not be created right now. Refresh to try again.
                </p>
              )}
            </CardContent>
          </Card>

          {stats && (
            <Card>
              <CardHeader>
                <CardTitle>Your stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label="Clicks" value={stats.clicks} />
                  <StatCard label="Pending" value={stats.pending} />
                  <StatCard label="Qualified" value={stats.qualified} />
                  <StatCard label="Rewarded" value={stats.rewarded} />
                </div>
                <p className="text-muted-foreground mt-3 text-xs">
                  Clicks count every recorded invite hit; pending signups qualify inside the program
                  window. Rewards are reported here — no payout is issued.
                </p>
              </CardContent>
            </Card>
          )}

          <ReferralRewardsSection />
        </>
      )}
    </div>
  )
}
