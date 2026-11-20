import { getServerEnv } from "./env.server"

/**
 * Security headers for every response (issue 051).
 *
 * Policy decisions, kept deliberately conservative so nothing that works
 * today silently breaks:
 *
 * - Content-Security-Policy stays a *safe subset* in enforce mode
 *   (frame-ancestors/base-uri/object-src cannot break scripts, styles, fonts,
 *   or WASM). The fuller policy ships as
 *   `Content-Security-Policy-Report-Only` so violations surface in devtools
 *   before enforcement. The full policy is enforced only when
 *   NODE_ENV=production AND CSP_ENFORCE=1 — the opt-in switch exists because
 *   the full policy would break Turbopack's RSC eval under `next dev`, so it
 *   must never be enforced outside production. Flip it on only after a
 *   clean report-only window on /, /docs, /changelog, /lab, and the auth
 *   flows.
 * - `script-src 'unsafe-inline'` is unavoidable today: the pre-paint theme
 *   scripts inlined by the (site)/(auth)/(app)/(changelog) layouts and the
 *   inline <style> critical CSS blocks have no nonce/hash plumbing yet, and
 *   Next.js itself injects inline bootstrap scripts. `unsafe-eval` is never
 *   allowed (Next only needs it for dev, which is not covered here).
 * - `img-src`/`media-src`/`frame-src` allow `https:` because the app file
 *   preview drawer legitimately iframes/embeds user-supplied https URLs
 *   (PDFs, images, video). Tightening to an approved asset host is future
 *   work once preview URLs are proxied same-origin.
 * - `connect-src` allows Sentry ingest (`*.ingest.sentry.io`,
 *   `*.ingest.us.sentry.io`, wss for the transport) — the only approved
 *   third-party origin. Issue 028 (analytics) must add its origin here
 *   before it ships or the report-only policy will flag it.
 * - frame-ancestors stays `'self'` (not `'none'`): the same-origin file
 *   preview iframe and any future same-origin document embeds would break
 *   under `'none'`. Foreign-origin clickjacking is already blocked; DENY is
 *   deferred until same-origin framing is audited.
 * - HSTS ships only when NODE_ENV=production (i.e. `next start`), matching
 *   the issue's "production only" requirement. `preload` is intentionally
 *   omitted: it is a one-way commitment requiring every subdomain to serve
 *   HTTPS permanently.
 * - No Cross-Origin-Opener-Policy: auth flows have not been audited for
 *   popup/OAuth reliance (issue 051 explicitly defers this).
 * - Token routes get `Referrer-Policy: no-referrer` so reset/verify/magic
 *   link tokens in the URL can never leak via Referer to third parties
 *   (fonts, Sentry, outbound links).
 */

type Header = { key: string; value: string }
type HeaderRule = { source: string; headers: Header[] }

const BASE_HEADERS: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // strict-origin-when-cross-origin sends only the origin cross-site; token
  // routes override this with no-referrer below (later rules win per key).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // SAMEORIGIN pairs with CSP frame-ancestors 'self'; see the note above for
  // why 'none'/DENY is deferred.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
]

const ENFORCED_CSP = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"

// Report-only rollout of the fuller policy. Read violations via the browser
// devtools "Issues"/console CSP reports (or a report-uri/report-to endpoint
// if one is added later); flip to enforce once clean in production.
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  // 'unsafe-inline': pre-paint theme <script> + Next inline bootstrap.
  // 'unsafe-eval' deliberately absent.
  "script-src 'self' 'unsafe-inline'",
  // 'unsafe-inline': inlined critical <style> blocks + Next runtime styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // https: covers user-content previews (file drawer) and markdown images.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  // Sentry browser SDK ingest only; same-origin covers /api/*.
  "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io wss://*.ingest.sentry.io wss://*.ingest.us.sentry.io",
  // 'self' for /sw.js + /pwa/sw-core.js; blob: is headroom for Sentry replay
  // compression workers — drop it if replay proves not to need it.
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // https: allows the PDF-preview iframe of external download URLs.
  "frame-src 'self' https:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

// Routes whose URLs carry bearer tokens. `/:path*` also matches the bare
// path (e.g. /verify-email with ?token=…). /invite/:path* is included for
// the invite flow before it lands.
const TOKEN_ROUTE_SOURCES = [
  "/reset-password/:path*",
  "/verify-email/:path*",
  "/magic-link/:path*",
  "/invite/:path*",
]

export function securityHeaders(options?: {
  production?: boolean
  cspEnforce?: boolean
}): HeaderRule[] {
  // NODE_ENV and CSP_ENFORCE via the validated env module (direct env reads
  // are lint-restricted). `next dev` → development (no HSTS, never full CSP);
  // `next build`/`next start` → production. Tests pass both options
  // explicitly. getServerEnv() throws outside a server runtime, so it is
  // only consulted for options the caller did not provide.
  const production = options?.production ?? getServerEnv().NODE_ENV === "production"
  // The full policy is enforced only in production with the explicit opt-in;
  // outside production (or without CSP_ENFORCE=1) the safe subset stays
  // enforced and the full policy remains report-only.
  const cspEnforce = production && (options?.cspEnforce ?? getServerEnv().CSP_ENFORCE === "1")

  const globalHeaders: Header[] = [...BASE_HEADERS]
  if (cspEnforce) {
    // Full policy enforced; no report-only duplicate — the enforced header
    // already produces violation reports in supporting browsers.
    globalHeaders.push({
      key: "Content-Security-Policy",
      value: REPORT_ONLY_CSP,
    })
  } else {
    globalHeaders.push(
      { key: "Content-Security-Policy", value: ENFORCED_CSP },
      {
        key: "Content-Security-Policy-Report-Only",
        value: REPORT_ONLY_CSP,
      },
    )
  }
  if (production) {
    globalHeaders.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    })
  }

  return [
    { source: "/:path*", headers: globalHeaders },
    ...TOKEN_ROUTE_SOURCES.map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    })),
  ]
}

export type { Header, HeaderRule }
