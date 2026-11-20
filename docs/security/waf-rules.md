# Web application firewall rules

Edge WAF rules for the `spindle.app` zone. The deployable artifacts live in
`infra/waf/`:

| File                                    | Cloudflare phase               | Contents                                                                                                                  |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `infra/waf/http-ruleset.custom.json`    | `http_request_firewall_custom` | Host allowlist, scanner-path and traversal blocks, User-Agent blocks, threat-score and method challenges, geo placeholder |
| `infra/waf/http-ruleset.ratelimit.json` | `http_ratelimit`               | Per-IP rate limits on `/api/auth/*` and public form endpoints                                                             |
| `infra/waf/nginx-fallback.conf.example` | — (not deployed)               | nginx snippets for fallback scenarios only                                                                                |

`scripts/waf/validate-rules.mjs` sanity-checks these files before upload:

```bash
node scripts/waf/validate-rules.mjs
```

## Where the WAF sits

Cloudflare Tunnel is the only ingress. Nothing in `infra/origin/compose.yaml`
publishes a public port; `cloudflared` is outbound-only and its ingress config
(`infra/origin/cloudflared/config.yml`) already answers `http_status:404` for
any hostname outside `app.spindle.app` and `lab.spindle.app`. The WAF is the
layer **in front of** that: it decides which requests Cloudflare forwards to
the tunnel at all.

Because the origin is unreachable without the tunnel, the residual risk the
WAF covers is edge-level abuse — scanner floods, credential-stuffing
volumetrics, and junk traffic that would otherwise burn origin capacity and
queue slots for real sessions.

## Managed rulesets

Custom rules alone do not inspect payloads. Enable the managed rulesets in the
zone dashboard (**Security → WAF → Managed rules**) or via the API before or
alongside the custom ruleset:

| Ruleset                         | Recommendation                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Managed Ruleset      | **On, sensitivity Medium** (the default). Covers the common web exploit classes; start at Medium and tighten only on evidence. |
| OWASP Core Ruleset              | **On, paranoia level 1** for the zone. PL1 is the least false-positive-prone; raise only after a clean log window.             |
| Exposed Credentials Check       | **On.** Flags login attempts with known-leaked username/password pairs. Pairs naturally with the auth rate limit below.        |
| Cloudflare Free Managed Ruleset | Included on every plan; verify it is also deployed on Free zones if a staging zone exists.                                     |

If Bot Management (Enterprise) is ever purchased, prefer `cf.bot_management.score`
and `cf.client.bot` over the heuristics in the custom rules — the managed
score is strictly better signal.

## Custom rules

Rules execute in order; `block` rules precede `managed_challenge` rules so
scanner traffic never spends challenge budget. The file ships with the
conservative `block` rules enabled and the geo placeholder disabled.

Each rule carries a `ref` user-defined identifier (e.g.
`spindle-block-scanner-paths`) — Cloudflare assigns the real rule `id` on
upload, so refs are what you match against when reviewing this file, the
Security → Events log, or a later ruleset update.

| #   | Ref                                    | Action            | Expression (summary)                                                                                                                                 | Rationale                                                                                                                       |
| --- | -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `spindle-block-unknown-host`           | block             | `http.host` not in the two served hostnames (`app.spindle.app`, `lab.spindle.app`)                                                                   | The tunnel 404s unknown names already; this catches probes that reach the zone through DNS or a misrouted record.               |
| 2   | `spindle-block-scanner-paths`          | block             | `http.request.uri.path matches` regex for `/.env`, `/.git`, `/wp-*`, `/xmlrpc.php`, `/phpmyadmin`, `/cgi-bin`, `/vendor/`, `/node_modules/`, `*.php` | None of these can exist on a Next.js app. Free win against the bulk of internet background scanning.                            |
| 3   | `spindle-block-path-traversal`         | block             | path contains `..`, or query contains `..%2f`, `%2e%2e`, `%252e`                                                                                     | Traversal probes, including double-encoded variants. Legitimate app paths never contain `..`.                                   |
| 4   | `spindle-block-scanner-ua`             | block             | UA contains `sqlmap`, `nikto`, `nmap`, `masscan`, `zgrab`                                                                                            | Self-identifying scanner traffic.                                                                                               |
| 5   | `spindle-challenge-high-threat-score`  | managed_challenge | `cf.threat_score lt 10`                                                                                                                              | Cloudflare's threat score under 10 is its "high threat" band. A managed challenge lets real users through once and stalls bots. |
| 6   | `spindle-challenge-suspicious-methods` | managed_challenge | method outside GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, **or** POST with empty User-Agent                                                             | Non-standard methods and UA-less POSTs are bot signatures. WebSocket upgrades use GET and are unaffected.                       |
| 7   | `spindle-challenge-geo-placeholder`    | challenge         | `ip.geoip.country in {"KP" "IR" "SY" "CU"}` — **disabled**                                                                                           | Placeholder for the sanctioned-country policy. See "Geo rules" below.                                                           |

### Rate-limiting rules

These live in the `http_ratelimit` phase (same upload flow, different phase).
They complement — do not replace — the application-level rate limiting
documented in [edge-rate-limiting.md](edge-rate-limiting.md); edge limits
absorb volumetric abuse before it reaches the Next.js origin.

| #   | Ref                         | Action            | Expression / scope                                                           | Threshold                                    | Rationale                                                                                                             |
| --- | --------------------------- | ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `spindle-ratelimit-auth`    | block             | path contains `/api/auth/`                                                   | 20 req / 60 s per IP+colo, 10 min ban        | Covers signin, signup, passwordless, reset, and 2FA — the credential-stuffing surface. Generous for a human retrying. |
| 2   | `spindle-ratelimit-forms`   | managed_challenge | path contains `/api/contact`, `/api/newsletter`, `/api/feedback`, `/api/nps` | 10 req / 60 s per IP+colo, 10 min mitigation | Public forms are spam magnets; challenge-on-trip keeps first-time legitimate submitters unblocked.                    |
| 3   | `spindle-ratelimit-landing` | block             | path eq `/`                                                                  | 300 req / 60 s per IP+colo — **disabled**    | Catch-all volumetric ceiling; tune against real traffic analytics before enabling.                                    |

`requests_to_origin: true` means the counter includes requests that would be
served from cache — the right choice here because the expensive paths are all
uncached API calls anyway.

**Plan prerequisite:** `period: 60` combined with `mitigation_timeout` of 600s
requires a paid plan (Business or above on the classic ruleset API; confirm
the zone's plan before upload). On plans without long-period support,
Cloudflare rejects or silently caps the period — fall back to `period: 10` and
scale `requests_per_period` down accordingly (e.g. 20 req/10 s) before
deploying.

## Geo rules

Rule `spindle-challenge-geo-placeholder` ships disabled with the sanctioned-country set
`{"KP" "IR" "SY" "CU"}`. Before enabling:

1. Confirm the sanctioned-country list against the current OFAC/EU/UN
   schedules — do not copy this file's list blindly; it is a starting point.
2. Check analytics (**Analytics → Traffic → by country**) for legitimate
   traffic from candidate countries; academic and diaspora users exist.
3. Prefer `challenge` over `block` initially; graduate to `block` only if
   challenged traffic from those countries is ~zero after two weeks.
4. If Cloudflare Access or an allowlist later covers admin surfaces, geo
   blocking there is redundant — keep geo rules on the public zone only.

## False-positive management

- **Challenge, don't block, anything ambiguous.** `managed_challenge` is
  solvable by browsers and invisible to most scripted clients; it is the
  default escalation step.
- **Per-IP + per-colo characteristics.** Rate limits key on `ip.src` +
  `cf.colo.id`, so a user roaming between colos is not double-counted and a
  NAT'd office shares one budget — size budgets for that.
- **Exemptions belong in skip rules, not edits.** If a real integration trips
  a rule (e.g. a monitoring probe hitting `/api/auth/session`), add a
  `skip` rule above it scoped to that IP/ASN/path rather than deleting the
  protection. Document each exemption here when added.
- **Watch Security → Events.** Every rule action lands there with the
  expression that fired. A spike in `challenge` events for a rule is the
  signal to tune, not the signal to panic.
- **Token routes are sensitive.** `/reset-password/*`, `/verify-email/*`,
  `/magic-link/*`, `/invite/*` carry bearer tokens in the URL
  (`src/lib/security-headers.ts` marks them `Referrer-Policy: no-referrer`).
  No WAF rule inspects query strings for these paths; keep it that way —
  challenge rules already exempt nothing on method, so a challenged token
  link can be re-fetched after solving. Do not add `block` rules matching on
  query content.

## Testing approach (log / dry-run)

Cloudflare has no ruleset dry-run API, so the log phase is the test:

1. **Validate locally:** `node scripts/waf/validate-rules.mjs` — catches JSON,
   schema, and expression-syntax errors before upload.
2. **Log mode:** change the target rule's `action` to `"log"` (supported for
   custom rules) or set `"enabled": false` for `http_ratelimit` rules, upload,
   and generate representative traffic (see below). Security → Events shows
   what _would_ have fired without blocking anyone.
3. **Replay real traffic:** export recent sampled requests from
   **Security → Analytics** or the GraphQL `firewallEventsAdaptive` dataset,
   then check each rule's expression against them mentally or with a small
   script — the validator's `KNOWN_FIELD_RE` hints at the field names.
4. **Synthetic probes:** after log mode looks clean, send deliberate probes
   from a test IP:

   ```bash
   for p in /.env /.git/config /wp-login.php /x/../etc/passwd; do
     curl -s -o /dev/null -w "%{http_code} $p\n" "https://app.spindle.app$p"
   done
   curl -s -o /dev/null -w "%{http_code}\n" -A "sqlmap/1.7" https://app.spindle.app/
   ```

   Expect 403 (block), 403 with a challenge page (managed_challenge), or 429/
   mitigation depending on the action. Confirm in Security → Events that the
   expected rule's `ref`/`id` fired.

5. **Regression check:** load `/`, `/docs`, a lab page, and complete a real
   signin while the rules are live — these are the highest-traffic paths and
   the first place a false positive hurts.

## Rollout plan

| Phase | Duration  | Action                                                                                                                                                                                                                    |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | —         | Enable managed rulesets at Medium/PL1 (they ship with sane defaults and their own rollout).                                                                                                                               |
| 1     | 1 week    | Deploy `http-ruleset.custom.json` with **all actions set to `log`** (or rules disabled). Deploy the ratelimit file with `enabled: false` on every rule. Watch Security → Events.                                          |
| 2     | 1–2 weeks | Promote rules one at a time, scanner `block` rules first (they cannot false-positive on this app), then `managed_challenge` rules. Enable the auth ratelimit at block; enable the forms ratelimit at `managed_challenge`. |
| 3     | ongoing   | Enable the geo placeholder after the country-list review above. Evaluate `ratelimit-landing` against real traffic. Tighten OWASP to PL2 only on evidence.                                                                 |
| 4     | rollback  | Any rule causing user-facing breakage: set `enabled: false` (or action `log`) and re-upload — changes take effect at the edge within seconds. Record the incident in `docs/incidents/`.                                   |

Deployment itself: the ruleset JSON is the body of a `PUT`/`POST` to the
zone's rulesets API (`/zones/{zone_id}/rulesets/phases/{phase}/entrypoint`),
or paste-equivalent entries via **Security → WAF → Custom rules** /
**Security → WAF → Rate limiting rules** in the dashboard. Keep the JSON as
the source of truth; dashboard edits should be mirrored back into the file.

## Origin-side fallback

The current origin needs no WAF of its own: it publishes no ports and is
reachable only through the tunnel connectors, so bypassing Cloudflare edge
rules means already compromising the tunnel credentials. Two fallback
scenarios are covered anyway:

- **`infra/waf/nginx-fallback.conf.example`** — if a reverse proxy is ever
  placed in front of the app (e.g. for a temporary direct-origin migration
  path), it carries the same scanner-path blocks and per-endpoint rate
  limits. It is documentation, not a deployed config; nothing loads it.
- **Next.js layer** — the app already ships defense-in-depth that does not
  depend on the WAF: security headers and the CSP subset in
  `src/lib/security-headers.ts`, per-route handlers under
  `src/app/api/`, and application-level rate limiting referenced from
  `edge-rate-limiting.md`. WAF rules are additive; removing them degrades
  edge filtering, not correctness.

If the tunnel is ever replaced by a directly exposed origin, the fallback
file becomes load-bearing: restrict ingress to Cloudflare IP ranges (fetched
fresh from cloudflare.com/ips), restore `CF-Connecting-IP` via
`set_real_ip_from`, and re-verify that the Host allowlist rule still applies
before deleting the tunnel path.
