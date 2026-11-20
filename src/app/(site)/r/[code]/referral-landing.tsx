"use client"

import { useEffect, useRef, useState } from "react"

import { isAnyReferralCode, readOwnReferralCode, storeReferralCode } from "@/lib/referral"

/**
 * `/r/[code]` landing page body.
 *
 * Validates the path segment against the referral-code shapes (`SPN-XXXX-XXXX`
 * generated codes and `SPN-<slug>` vanity codes), persists a
 * valid code through the same localStorage path `ReferralTracker` uses (so the
 * auth pages pick it up on signup via `consumeStoredReferralCode`), and
 * renders the invite pitch with sign-up CTAs.
 *
 * Invalid codes get a friendly state that still offers normal signup — the
 * page never 404s or errors on a malformed link.
 *
 * A/B testing: on mount the page resolves a sticky variant from
 * `POST /api/landing-ab/assign` for the `"referral-landing"` experiment
 * (auto-created server-side on first assign — see that route's docs) and
 * applies the variant's `headline` / `ctaLabel` / `showSocialProof` config.
 * It then records a `view` event and `signup_click` / `cta_click` events on
 * CTA clicks via `POST /api/landing-ab/event`. Every call is fire-and-forget:
 * if the API is unreachable or returns no assignment the page renders the
 * control copy, so the experiment can never break the landing page.
 *
 * Referral attribution: the page also posts the code to
 * `POST /api/referral/attribution` (source `"click"`) so anonymous invite
 * hits are recorded server-side; the uniform-200 response policy there
 * means this is safe for valid, self, and unknown codes alike.
 */

const VISITOR_ID_KEY = "spindle.landing-ab.visitor"

interface LandingVariantConfig {
  headline?: string
  ctaLabel?: string
  showSocialProof?: boolean
  [key: string]: unknown
}

interface AssignmentPayload {
  experimentId: string
  variantId: string
  config: LandingVariantConfig
}

/** Anonymous, persistent-per-browser visitor id for sticky assignment. */
function getVisitorId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY)
    if (existing) return existing
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    window.localStorage.setItem(VISITOR_ID_KEY, created)
    return created
  } catch {
    return null
  }
}

function postJson(url: string, payload: Record<string, unknown>): void {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget: experiment/attribution must never break the page.
    })
  } catch {
    // fetch unavailable (very old browser / test env) — ignore.
  }
}

export function ReferralLanding({ code }: { code: string }) {
  const valid = isAnyReferralCode(code)
  // Own-code check needs localStorage, so it can only run after mount; the
  // first render (and SSR) always shows the standard pitch.
  const [selfReferral, setSelfReferral] = useState(false)
  // Null until an assignment resolves — the control copy renders in the
  // meantime and permanently if the A/B API is unavailable.
  const [variant, setVariant] = useState<LandingVariantConfig | null>(null)
  const assignmentRef = useRef<AssignmentPayload | null>(null)

  useEffect(() => {
    if (!valid) return
    const ownCode = readOwnReferralCode()
    storeReferralCode(code, ownCode)
    setSelfReferral(ownCode !== null && ownCode === code)

    // Anonymous click attribution — uniform 200 regardless of outcome.
    postJson("/api/referral/attribution", { code, source: "click" })

    const visitorId = getVisitorId()
    // The assign response is needed to apply the variant, so this call is
    // awaited-but-guarded rather than fire-and-forget.
    void (async () => {
      try {
        const response = await fetch("/api/landing-ab/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            experiment: "referral-landing",
            ...(visitorId ? { visitorId } : {}),
          }),
        })
        const data = (await response.json()) as {
          ok?: boolean
          assignment?: AssignmentPayload | null
        }
        if (!response.ok || !data.ok || !data.assignment) return
        assignmentRef.current = data.assignment
        setVariant(data.assignment.config ?? {})
        postJson("/api/landing-ab/event", {
          experimentId: data.assignment.experimentId,
          variantId: data.assignment.variantId,
          ...(visitorId ? { visitorId } : {}),
          type: "view",
        })
      } catch {
        // Control variant stays rendered.
      }
    })()
  }, [code, valid])

  const recordClick = (type: "signup_click" | "cta_click") => {
    const assignment = assignmentRef.current
    if (!assignment) return
    const visitorId = getVisitorId()
    postJson("/api/landing-ab/event", {
      experimentId: assignment.experimentId,
      variantId: assignment.variantId,
      ...(visitorId ? { visitorId } : {}),
      type,
    })
  }

  if (!valid) {
    return (
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Referral link</div>
            <h1 className="page-title">This invite link doesn't look right.</h1>
            <p className="page-lede">
              The code in this link isn't a valid Spindle referral code — it may have been truncated
              or mistyped. You can still create a free workspace; no referral is needed.
            </p>
            <div className="page-actions">
              <a href="/sign-up" className="btn btn--primary btn--lg">
                Create free workspace
              </a>
              <a href="/referral" className="btn btn--ghost btn--lg">
                Get your own referral link
              </a>
            </div>
          </div>
        </section>
      </main>
    )
  }

  const headline =
    typeof variant?.headline === "string" && variant.headline.trim()
      ? variant.headline
      : "You've been invited to Spindle."
  const ctaLabel =
    typeof variant?.ctaLabel === "string" && variant.ctaLabel.trim()
      ? variant.ctaLabel
      : "Create free workspace"
  const showSocialProof = variant?.showSocialProof !== false

  return (
    <main id="top" tabIndex={-1} className="page-main">
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">Referral invite</div>
          <h1 className="page-title">{headline}</h1>
          <p className="page-lede">
            Someone shared their link with you — referral code <code>{code}</code>. Create a free
            workspace and the invite is attached to your signup automatically.
          </p>
          {selfReferral ? (
            <p className="page-lede">
              This is your own referral link, so it won't count as a referral. You can still create
              a workspace — or share the link with someone new from the{" "}
              <a href="/referral">referral page</a>.
            </p>
          ) : null}
          <div className="page-actions">
            <a
              href="/sign-up"
              className="btn btn--primary btn--lg"
              onClick={() => recordClick("signup_click")}
            >
              {ctaLabel}
            </a>
            <a
              href="/referral"
              className="btn btn--ghost btn--lg"
              onClick={() => recordClick("cta_click")}
            >
              How referrals work
            </a>
          </div>
        </div>
      </section>
      {/*
        The social-proof section stays mounted in both states so a variant
        with `showSocialProof: false` cannot collapse it and shift the page
        when the async assignment resolves. When disabled, the stats grid is
        kept as an invisible space-holder (visibility:hidden preserves layout
        but renders nothing, borders included via transparent styling on the
        grid itself).
      */}
      <section className="section" aria-hidden={showSocialProof ? undefined : true}>
        <div className="container">
          <div
            className="stats-grid"
            style={
              showSocialProof
                ? undefined
                : {
                    visibility: "hidden",
                    borderColor: "transparent",
                    background: "transparent",
                  }
            }
          >
            <div className="stat">
              <div className="stat-value">5 GB</div>
              <p>Of storage for files, notebooks, and sources</p>
            </div>
            <div className="stat">
              <div className="stat-value">20</div>
              <p>Agent requests every day, free</p>
            </div>
            <div className="stat">
              <div className="stat-value">$0</div>
              <p>No card, no trial clock</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
