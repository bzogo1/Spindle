# Playbook — rate-limit / abuse

Automated abuse against auth forms and public endpoints: credential stuffing
on `/api/auth/signin`, signup spam, password-reset/email bombing via
`/api/auth/passwordless/request` or `/api/auth/verify-email/resend`, contact/
newsletter form flooding (`/api/contact`, `/api/newsletter`), or quota burn on LLM/Resend/B2.

## Severity

**SEV2** when abuse is blocking legitimate users (shared-IP false positives,
credential-stuffing lockouts, email quota burn affecting auth flows) or
burning paid quota (Resend plan limit, LLM $100/mo hard limit,
`docs/runbooks/hosting.md` §4). **SEV3** for background scraping/noise that
the existing limiters already blunt. **SEV1** only if abuse achieves account
takeover at scale or exhausts a hard provider cap that breaks the product.

## Detection signals

- 429 responses spiking in logs/Sentry on the limited routes. The app's
  limiters are **in-process fixed-window** (`createRateLimiter` in
  `src/lib/site-forms.ts`) keyed by `clientIp()` = first `x-forwarded-for`
  hop — per-instance state, so they blunt casual abuse, not a distributed
  botnet (documented limitation in that file).
- Route limits (`src/app/api/`): signin 10/min, signup 5/h, contact 5/h,
  newsletter 10/h, passwordless request 5/10min, password reset request
  5/10min + confirm 10/10min, verify-email 10/10min, resend 5/10min.
- Resend-cooldown 429s on `/api/auth/verify-email/resend`
  (`src/lib/auth/resend-cooldown.ts`) — expected per-user behavior.
- Provider dashboards: Resend sending-limit usage, LLM project budget
  ($100/mo hard limit), B2 caps & alerts (3 TB hard cap, 2.5 TB alert —
  `docs/runbooks/hosting.md` §4).
- Cloudflare edge signals: WAF events, rate-limit rules, Turnstile
  challenges (edge controls per ADR 0001 — "Cloudflare edge (WAF, Turnstile,
  rate limits)").
- Auth audit log: `src/app/api/auth/audit/route.ts` /
  `src/lib/auth/audit.ts` for suspicious signin patterns.

## Immediate steps

1. **Confirm it's abuse, not a bug.** Check whether 429s correlate with a
   deploy (a broken limiter/IP extraction change) or with a traffic spike.
   `clientIp()` trusts the first `x-forwarded-for` entry — verify Cloudflare
   is the only ingress (tunnel-only per ADR 0001) so clients can't spoof it;
   if the origin is reachable another way, that's the real hole.

2. **Stop the bleeding at the edge (fastest lever).** Cloudflare dashboard:
   enable/tighten rate-limiting rules on `/api/auth/*` and `/api/contact`,
   `/api/newsletter`; check WAF managed rules and Turnstile on the auth forms.
   This is config, not code — do it before any deploy.

3. **App-level mitigations.**
   - If one IP/subnet is the source: the in-memory limiter can't block
     subnets — block at Cloudflare (IP Access Rules / WAF custom rule) or
     fail2ban-style on the host.
   - If credential stuffing: confirm no account compromise via
     `src/lib/auth/audit.ts` events; force-reset only confirmed-hit accounts.
   - If email bombing: tighten per-route limits means a code change +
     deploy — prefer edge rules first; Resend quota is the hard stop
     (`docs/runbooks/hosting.md` §4).
   - If LLM/agent endpoints are being burned: check which route spends
     (agent runs, automations) and apply edge rate limits; the $100/mo
     provider hard limit is the final backstop.

4. **Verify legitimate users unaffected.** Shared-IP users (offices,
   CGNAT) can false-positive on IP-keyed limiters — if reports come in,
   raise the edge rule threshold rather than disabling it; the app's own
   per-route limits remain as the second layer. Test sign-in and one form
   submission from a normal connection.

5. **Escalate if accounts are compromised.** Confirmed credential-stuffing
   success → `secrets-leak.md` adjacent: revoke sessions (`spindle_rt`
   rotation on next refresh), force password resets for hit accounts, and
   treat any reused-password exposure per the security docs.

## Comms template

```text
[SEV3] Abuse traffic on <endpoint(s)> — <rate>/min, mostly <IP range/class>.
App limiters engaged (429s). Edge WAF/rate-limit <tightened | already
covering>. User impact: <none | some lockouts>. Monitoring Resend/LLM quota.
IC: <name>.
```

Bump to SEV2 and say so explicitly if legitimate users are being blocked or a
paid quota is being consumed.

## Postmortem checklist

- [ ] Attack profile: source IPs/ASNs, target endpoints, duration, success
      rate (any 200s that shouldn't be).
- [ ] Which layer stopped it first (edge vs app limiter) and time-to-mitigate.
- [ ] Quota cost incurred (Resend sends, LLM tokens, B2 ops).
- [ ] Any account compromises; resets/sessions revoked.
- [ ] Action items: move hot limiters to a shared store (the documented
      upgrade path in `src/lib/site-forms.ts` — Redis/Valkey is already on the
      `spindle` network per `infra/origin/compose.yaml`), add Turnstile to
      remaining unprotected forms, tune edge rules, add 429-rate alerting.
