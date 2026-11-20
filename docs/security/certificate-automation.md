# Certificate automation

How certificates for `spindle.app` and its subdomains are issued, renewed,
and monitored. This document is the operational companion to
[`tls.md`](tls.md), which defines _where_ TLS terminates and the edge policy;
this one covers the _lifecycle_.

## 1. What certificates exist (and which do not)

The honest inventory for this deployment:

| Certificate                                              | Where it lives                                   | Issued/renewed by                                 | Automation needed on our side?          |
| -------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- | --------------------------------------- |
| Universal SSL edge cert (`spindle.app`, `*.spindle.app`) | Cloudflare edge                                  | Cloudflare, automatically, ~90-day lifetime       | **No** — managed entirely by Cloudflare |
| Origin certificate                                       | —                                                | —                                                 | **N/A** — see below                     |
| Tunnel connector credentials                             | `cloudflared` token/credentials JSON on the host | `cloudflared tunnel create` (out-of-band, manual) | No — long-lived, not a cert             |

**Origin certificates do not exist in this architecture.** TLS terminates at
the Cloudflare edge; the tunnel leg is encrypted QUIC transport; and
`cloudflared` → app is plain HTTP inside the private Docker network
(`docs/security/tls.md` §1–§3, ADR 0001). There is no certbot, no ACME client,
and no cert to renew on the origin — and none should be added speculatively.
If the §3 fallback (a local TLS terminator for the last hop) is ever adopted,
that introduces a real origin certificate and this document's monitoring and
renewal sections apply to it directly.

Because the edge certificate is Cloudflare-managed, "renewal automation" on
our side reduces to **monitoring**: confirming the cert Cloudflare serves is
valid, trusted, and not about to expire, and noticing if Cloudflare's
automation ever silently fails.

## 2. Expiry monitoring

Two dependency-free checkers cover the public surface. Both use Node's `tls`
module only and run anywhere Node 18+ exists — CI runner, origin host, or a
laptop.

### `scripts/certificates/expiry-check.mjs` — scheduled expiry watcher

Reads the host list from `infra/certificates/expiry-check.json` and checks
each host's certificate validity window against warn/critical thresholds.

```bash
# Check every host in the config (the normal scheduled run):
node scripts/certificates/expiry-check.mjs

# Machine-readable output for alerting pipelines:
node scripts/certificates/expiry-check.mjs --json

# Ad-hoc single host:
node scripts/certificates/expiry-check.mjs --host app.spindle.app --port 443

# Offline self-test of the threshold engine (no network):
node scripts/certificates/expiry-check.mjs --demo
```

Per-host `warnDays`/`criticalDays`/`port`/`timeoutMs` in the config override
the `defaults` block; CLI `--warn-days`/`--critical-days`/`--timeout`
override everything. Current thresholds: **warn ≤ 21 days, critical ≤ 7
days** — comfortably inside Cloudflare's ~90-day renewal cycle, so a warn
means renewal already failed once.

The checker reports three findings per host: chain trust
(`socket.authorized` — an untrusted chain is critical even though the expiry
window may be fine), the validity window (expired / not-yet-valid / inside
critical / inside warn), and reachability (unreachable is critical — for a
tunnelled host that also means the tunnel or DNS is down, which is worth
paging on anyway).

Exit codes: `0` all ok · `1` at least one warning · `2` critical/expired/
unreachable · `64` usage or config error.

Suggested schedule: daily via cron on the origin or a CI scheduled job, with
`--json` output shipped to the existing alerting path. A weekly run is the
minimum; daily matches how fast Cloudflare edge incidents can appear.

### `scripts/tls/check-tls.mjs` — posture check (run on change)

`docs/security/tls.md` §4 documents this checker: negotiated protocol,
cipher strength, TLS 1.0 downgrade floor, and the same validity window. Run
it after any Cloudflare SSL/TLS setting change or edge certificate event —
it answers "is the edge configured correctly", while `expiry-check.mjs`
answers "is the cert still good" on a schedule. The two are complementary;
run both.

```bash
node scripts/tls/check-tls.mjs --host app.spindle.app --json
node scripts/tls/check-tls.mjs --demo   # offline engine self-test
```

## 3. Certificate-transparency monitoring

Public certificates are logged to Certificate Transparency logs at issuance.
Two cheap CT checks worth doing:

- **crt.sh lookup** — `https://crt.sh/?q=%25.spindle.app&output=json` lists
  every cert ever issued for the domain and its subdomains. Run it after any
  suspected issuance event, or subscribe to a CT monitor (e.g. crt.sh email
  notifications, or a service like Facebook CT Monitoring / Cert Spotter)
  for `%.spindle.app`.
- **What to look for:** only Cloudflare/Google Trust Services issuers
  (Universal SSL is issued under Google Trust Services / Let's Encrypt
  ancestors) and only certs covering `spindle.app` / `*.spindle.app`. Any
  other CA, an unexpected SAN, or a cert you did not expect is a signal of
  mis-issuance or domain-control compromise — treat as a security incident
  and check Cloudflare's **SSL/TLS → Edge Certificates** page plus the
  zone's audit log.

CT logs are also how you confirm a renewal actually happened: after a
scheduled renewal, a new cert appears in crt.sh within minutes.

## 4. Renewal runbook

### Edge certificate (the only live cert)

Nothing to run — Cloudflare renews Universal SSL automatically. The
procedure is _verification_, not renewal:

1. `node scripts/certificates/expiry-check.mjs --host app.spindle.app`
   confirms a fresh cert is being served (issuer should be a Google Trust
   Services / Let's Encrypt hierarchy, ~90-day validity).
2. `node scripts/tls/check-tls.mjs --host app.spindle.app` confirms the
   posture checks still pass.
3. If the served cert is unexpectedly old (>60 days remaining is normal
   mid-cycle; approaching expiry is not), check the Cloudflare dashboard:
   **SSL/TLS → Edge Certificates** shows the current cert and its expiry;
   **SSL/TLS → Edge Certificates → Universal SSL** shows renewal status.
   A paused zone or a failed DCV check stalls renewal — re-enable or fix
   the DNS record the DCV depends on.
4. Cross-check issuance in crt.sh (§3) if the dashboard and the served cert
   disagree.

### Origin certificate (only if §3 of tls.md is ever adopted)

Not applicable today. If a local TLS terminator is introduced, add its host
entry to `infra/certificates/expiry-check.json` (it will not be publicly
reachable — run the check from inside the Docker network or against the
terminator's management port), wire its renewal into whatever issues it
(Caddy/lego/step-ca), and record the decision in an ADR.

### Tunnel credentials (not certs, but adjacent)

`cloudflared` credentials JSON is a long-lived token, not a certificate; it
does not expire on a schedule. Rotate it only on suspected compromise or
team-member offboarding by re-running `cloudflared tunnel create`/token
rotation and reinstalling the credentials file per
`docs/runbooks/hosting.md` §2.

## Related

- `docs/security/tls.md` — where TLS terminates and the edge policy.
- `scripts/certificates/expiry-check.mjs` — scheduled expiry checker.
- `scripts/tls/check-tls.mjs` — TLS posture checker.
- `infra/certificates/expiry-check.json` — monitored host list and thresholds.
- `docs/runbooks/hosting.md` — tunnel setup and host verification.
- `infra/tls/cloudflare-ssl-tls-settings.md` — dashboard settings checklist.
