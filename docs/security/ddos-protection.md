# DDoS protection

How Spindle defends the single-host production origin (Hetzner AX42 behind
Cloudflare Tunnel, ADR `docs/decisions/0001-container-host-topology.md`) against
volumetric, protocol, and application-layer denial of service. This document
describes the layered model, the signals that detect an attack, and an honest
assessment of what a single host cannot absorb.

Companion documents:

- [WAF rules](waf-rules.md) — Cloudflare managed rules and custom rules at the
  edge.
- [Edge rate limiting](edge-rate-limiting.md) — Cloudflare rate-limiting rules
  per hostname/path; this document covers the _response_ to an attack, not the
  standing configuration.
- Runbook-style configs: `infra/ddos/README.md` (dashboard steps, ufw, fail2ban).
- Abuse playbook: [rate-limit / abuse incident](../incidents/rate-limit-abuse.md).
- Alert-storm playbook:
  [Sentry alert storm](../incidents/sentry-alert-storm.md).

## Threat model

| Layer                 | Attacker capability                                                        | Primary defense                                                          |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| L3/4 volumetric       | Flood of packets/flows aimed at the origin IP                              | Cloudflare anycast absorbs it; the origin never sees the packets         |
| L7 HTTP flood         | Request floods through Cloudflare to `app.spindle.app` / `lab.spindle.app` | Cloudflare managed DDoS + rate limiting + WAF; app limiters as backstop  |
| Slowloris / slow HTTP | Holds connections open to exhaust origin sockets                           | Cloudflare edge terminates TLS and buffers; tunnel multiplexes over QUIC |
| Auth/form abuse       | Credential stuffing, form spam, email bombing                              | Edge rate limits + Turnstile + in-process limiters (see abuse playbook)  |
| Direct origin attack  | Bypasses Cloudflare, hits the Hetzner IP directly                          | Origin has no public inbound ports; tunnel is outbound-only              |

The single most important fact: **the origin has no public listening sockets
for HTTP.** All ingress is outbound QUIC/HTTP2 from `cloudflared` to
Cloudflare's edge. A volumetric attack against the Cloudflare IP never reaches
the AX42; a volumetric attack against the Hetzner IP has nothing to hit.

## Layer 1 — Cloudflare edge

Cloudflare is the entire perimeter. The tunnel means the origin is invisible
to scanners: `app.spindle.app` and `lab.spindle.app` resolve to Cloudflare
anycast IPs, not the Hetzner box.

### What the edge absorbs automatically

- **L3/4 DDoS** — unmetered on all plans. SYN floods, UDP amplification,
  IP fragmentation attacks are dropped at the closest Cloudflare PoP. The
  origin's 1 Gbit/s Hetzner uplink is never in the path.
- **Managed rulesets** — Cloudflare's managed DDoS rulesets run on every
  request on all plans (HTTP DDoS Attack Protection is on by default;
  "I'm Under Attack" adds a JS challenge on top).
- **TLS termination** — Cloudflare terminates TLS at the edge. Slowloris-style
  connection exhaustion lands on Cloudflare's buffers, not on Node. The
  `cloudflared` hop to origin is QUIC over a small number of persistent
  connections.

### Manual controls (dashboard)

Runbook steps live in `infra/ddos/README.md`. Summary:

1. **I'm Under Attack mode** (Security → Settings → "I'm Under Attack mode"):
   enables a managed challenge (JS + interactive) for every visitor. Use only
   during a confirmed L7 attack — it adds latency for real users. Toggle off
   when the attack subsides; there is no auto-off.
2. **Rate limiting rules** — see [edge rate limiting](edge-rate-limiting.md).
   During an attack, add temporary tighter rules (e.g. 100 req/min per IP on
   `app.spindle.app/*`) before attacking IPs rotate. Free tier allows 1 rule;
   Pro 2; Business 5; Enterprise custom. Prefer a broad "any hostname" emergency
   rule first, tighten per-path after.
3. **WAF custom rules** — block known-bad ASNs, countries (if the product has
   no legitimate traffic there), or user-agents during an incident. See
   [WAF rules](waf-rules.md).
4. **Bot Fight Mode** (free) / **Super Bot Fight Mode** (Pro+) — challenge
   known bots. Verify compatibility with the app's own session flows.
5. **Turnstile** on auth and public forms — already the intent per ADR 0001;
   it converts form abuse into a challenge instead of origin load.
6. **IP Access Rules** — for a small set of confirmed attacking IPs/CIDRs.
   Scales poorly against botnets; use WAF expressions for larger sets.

### Plan differences (document both)

- **Free plan**: unmetered L3/4, automatic L7 DDoS mitigation, 1 rate-limiting
  rule, 5 custom WAF rules, Bot Fight Mode, IUAM. No SLA on mitigation time.
- **Pro plan** ($20/mo): same absorption, 2 rate-limiting rules, 20 custom
  rules, Super Bot Fight Mode, better ruleset granularity.
- **Business/Enterprise**: advanced rate limiting (per-session, JA3/JA4,
  response-based actions), more custom rules, SLAs, dedicated support.

The architecture (tunnel + no origin ports) is what makes the free tier
sufficient: the expensive part of DDoS defense — keeping the origin hidden —
is structural, not a paid feature.

## Layer 2 — Origin hardening

The AX42 should have **zero public inbound ports**. Verified against
`infra/origin/compose.yaml`:

- `app` publishes only `127.0.0.1:8080:8080` (loopback; for local health
  checks). The tunnel reaches it over the internal `spindle` Docker network.
- `postgres`, `valkey`, `docker-socket-proxy`, `worker` publish **no** ports.
- `cloudflared-1`/`cloudflared-2` publish nothing; they make outbound
  connections only.
- `infra/origin/cloudflared/config.yml` has exactly two hostnames
  (`app.spindle.app` → `app:8080`, `lab.spindle.app` → `lab-proxy:7000`) and a
  catch-all `http_status:404` — there is no wildcard ingress, so even if
  someone guesses a hostname it cannot reach the origin.

Firewall policy (see `infra/ddos/README.md` for the full runbook):

- `infra/host/bootstrap.sh` installs ufw with `default deny incoming` /
  `default allow outgoing` when `SPINDLE_APPLY_FIREWALL=1` — opt-in because it
  must not cut the admin path (Cloudflare Access or Tailscale per ADR 0001).
- No inbound rules are added at all: SSH admin goes through Tailscale or
  Cloudflare Access, not public port 22. `infra/ddos/ufw-rules.sh` provides
  example explicit rules for a variant that _does_ expose SSH (restricted to a
  management CIDR), plus `--check` verification.
- `infra/ddos/fail2ban/` provides a jail for SSH brute force in that variant.
- **Docker/ufw caveat**: Docker manipulates iptables directly and can bypass
  ufw for _published_ ports. This is safe here because the only published port
  is bound to `127.0.0.1`. If anyone ever publishes `0.0.0.0:PORT`, ufw will
  not protect it — re-verify `docker ps` port bindings after every deploy.
  `scripts/hosting/verify-topology.sh` covers the live checks.

## Layer 3 — Application signals

The app is the last line of defense and the first source of detection data.

### In-process rate limiters

`createRateLimiter` in `src/lib/site-forms.ts` provides fixed-window,
in-memory limiters keyed by `clientIp()` (first `x-forwarded-for` hop).
Current per-route limits (from `docs/incidents/rate-limit-abuse.md`):

- signin 10/min, signup 5/h, contact 5/h, newsletter 10/h
- passwordless request 5/10min, password reset request+confirm 5–10/10min
- verify-email 10/10min, resend 5/10min (plus `resend-cooldown.ts` per-user)

These are **per-instance** state — they blunt casual abuse and give Sentry/log
a 429 signal, but a distributed botnet spreads across instances and source
IPs. They are a backstop, not the primary control. They also trust
`x-forwarded-for`, which is only safe because Cloudflare is the sole ingress
(originRequest strips/overwrites client headers at the edge — verify in
`infra/origin/cloudflared/config.yml` there is no direct path).

### Detection signals

An attack is visible in three places:

1. **Sentry** — error/transaction volume spikes. See
   `src/sentry.server.config.ts` and the
   [Sentry alert storm](../incidents/sentry-alert-storm.md) playbook for
   distinguishing alert storms from real traffic anomalies.
2. **Application logs** — every request emits one JSON line with
   `event: "api.request"`, `method`, `path`, `status`, `durationMs`
   (`src/lib/request-logging.ts`, format documented in
   `docs/observability/log-aggregation.md`). Feed these to:
   - `node scripts/metrics/log-metrics.mjs --file app.log --format prometheus`
     — request rate, error rate by route/status, p50/p90/p95/p99 latency,
     top error messages (`--demo` for sample data).
   - `node scripts/ddos/traffic-spike.mjs --file app.log` — per-minute request
     buckets with spike detection against the window baseline (`--demo`
     included).
3. **SLO report** — `node scripts/slo/report.mjs --input samples.jsonl`
   computes SLI attainment against `docs/slo/service-level-objectives.md`
   targets; a sustained availability/latency budget burn during a traffic
   spike is the "users are actually hurt" signal.

### What a spike looks like

| Signal                        | Normal                             | Under L7 attack                                |
| ----------------------------- | ---------------------------------- | ---------------------------------------------- |
| `api.request` rate per minute | follows diurnal traffic            | step-change >> baseline, sustained             |
| 4xx/429 share                 | low single digits %                | dominates; often one path (`/`, `/api/auth/*`) |
| p95 `durationMs`              | route-dependent (tens–hundreds ms) | climbs as Node saturates                       |
| Status 5xx                    | rare                               | rises once CPU/event loop saturates            |
| Path diversity                | many real routes                   | concentrated on 1–2 paths, or crawler paths    |
| Non-request log volume        | steady                             | floods of rate-limit/429 entries               |

### Response order during a confirmed attack

1. **Edge first** — IUAM on, tighten/add rate-limit rule, WAF custom rule.
   Minutes, no deploy. (Dashboard steps: `infra/ddos/README.md`.)
2. **Confirm the origin is not the bottleneck** — if p95 latency is high but
   edge request counts are normal, the flood may be bypassing Cloudflare
   (check `docker ps` port bindings and ufw — see Layer 2 caveats).
3. **App** — only if edge controls can't keep up: the in-process limiters
   can't be retuned without a deploy, so prefer blocking at the edge. Watch
   Sentry quota (`docs/incidents/sentry-alert-storm.md`) — an attack that
   floods errors can burn the Sentry quota and blind you.
4. **Provider hard stops** — Resend/LLM quotas for auth-flood variants
   (see abuse playbook); B2 caps are unaffected by HTTP floods.

## Residual risk — honest assessment

A single AX42 behind a tunnel is a good DDoS posture for cost, but these risks
remain:

- **L7 attacks that look like legitimate traffic** (low-and-slow, real
  browsers) pass through Cloudflare and consume origin CPU. Cloudflare's
  managed mitigation + rate limits raise the cost for the attacker but cannot
  eliminate it on the free/pro tiers. A determined L7 attack sized above
  ~1 Gbit/s of _valid-looking_ HTTPS requests can saturate Node before edge
  rules react. Mitigation: rate-limit aggressively, enable IUAM, and accept
  degraded service — there is no second origin to fail over to.
- **Single point of failure** — the AX42 is also the only host for Postgres,
  Valkey, and the orchestrator. A successful attack that crashes `cloudflared`
  or Docker takes everything down; two connectors mitigate connector failure,
  not host failure. There is no origin-level redundancy (ADR 0001 is explicit
  about this trade-off).
- **Tunnel dependency** — all ingress requires Cloudflare's edge and the
  outbound QUIC path. A Cloudflare outage or a cloudflared bug means total
  outage regardless of attack traffic. `restart: unless-stopped` + two
  connectors cover process crashes, not platform failure.
- **Detection lag** — in-memory limiters and log-based metrics are reactive.
  Sentry alerting has its own latency; nothing pages on "requests/min > N"
  automatically unless a log pipeline is wired to an alerter
  (`scripts/alerts/escalate.mjs` consumes alert payloads — wire a
  log-metrics/Prometheus rule to it).
- **Free-tier limits** — one rate-limit rule and five custom WAF rules are
  thin for layered defense. Pro roughly doubles both. The tunnel architecture
  means you mostly need _one_ good emergency rule plus IUAM, but plan for
  Pro if the product grows.
- **Admin path exposure** — SSH via Tailscale/Cloudflare Access is itself a
  target; keep it key-only, and see `infra/ddos/fail2ban/` if a public SSH
  port is ever required.

**Bottom line**: volumetric and protocol attacks are effectively a
non-issue — Cloudflare absorbs them and the origin is unreachable. The real
exposure is application-layer floods that pass edge heuristics; the defense
there is rate limiting + IUAM + the in-process limiters + fast human response,
with the single host as the hard ceiling.
