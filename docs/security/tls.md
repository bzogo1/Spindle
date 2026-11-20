# TLS architecture and management

How Transport Layer Security is terminated, configured, and verified for
`spindle.app` and its subdomains. Certificate _issuance automation_ is tracked
separately — see the pointer at the end of this document.

## 1. Where TLS terminates

There are exactly two TLS boundaries; everything between them is already
encrypted or private:

```
browser ──TLS 1.3/1.2──▶ Cloudflare edge ──encrypted tunnel──▶ cloudflared ──plain HTTP──▶ app / lab-proxy
   (managed cert)         (Universal SSL / ACM)   (QUIC, outbound-only)     (Docker network `spindle`)
```

| Hop                                         | TLS?   | Who terminates it                              |
| ------------------------------------------- | ------ | ---------------------------------------------- |
| Browser → Cloudflare edge                   | Yes    | Cloudflare edge (managed certificate)          |
| Cloudflare edge → cloudflared connector     | Yes    | Encrypted tunnel transport (QUIC)              |
| cloudflared → `app:8080` / `lab-proxy:7000` | **No** | Plain HTTP inside the `spindle` Docker network |

Details that matter:

- The tunnel is **outbound-only**. The origin host publishes no public
  22/80/443 (`docs/runbooks/hosting.md` §1, `infra/host/bootstrap.sh` firewall).
  There is no path for an attacker to reach the plain-HTTP service except
  through the authenticated tunnel.
- The app publishes only `127.0.0.1:8080:8080` (`infra/origin/compose.yaml`);
  the tunnel reaches it over the internal compose network, not the host
  loopback.
- `lab.spindle.app` WebSocket traffic is the same path: TLS terminates at the
  edge, then travels inside the encrypted tunnel to `lab-proxy:7000`.
- The Cloudflare "SSL/TLS encryption mode" setting (Off/Flexible/Full/Full
  strict) applies to **proxied DNS origins**, not to tunnel ingress. For
  Cloudflare Tunnel hostnames the origin side is governed by the
  `service:`/`originRequest:` block in `infra/origin/cloudflared/config.yml`,
  which currently uses `http://`. There is nothing to set in the dashboard for
  the origin hop.

## 2. Edge TLS policy (Cloudflare dashboard)

Set these under **SSL/TLS** for the `spindle.app` zone. The authoritative
checklist lives in `infra/tls/cloudflare-ssl-tls-settings.md`; this table is
the policy summary.

| Setting (SSL/TLS section)                    | Recommended value                                                                                                                                                                                                                                 | Why                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Edge Certificates → Minimum TLS Version      | **TLS 1.2** (offer 1.3)                                                                                                                                                                                                                           | TLS 1.0/1.1 are deprecated (RFC 8996); 1.2 is the floor, 1.3 is negotiated automatically when offered |
| Edge Certificates → TLS 1.3                  | **On**                                                                                                                                                                                                                                            | Zero-cost downgrade protection; all modern clients support it                                         |
| Edge Certificates → Automatic HTTPS Rewrites | **On**                                                                                                                                                                                                                                            | Rewrites `http://` resource URLs to `https://` in HTML                                                |
| Edge Certificates → Always Use HTTPS         | **On**                                                                                                                                                                                                                                            | 301s plain-HTTP requests to HTTPS at the edge                                                         |
| Edge Certificates → HSTS                     | Optional; app already emits `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production (`src/lib/security-headers.ts`). Enabling edge HSTS adds `preload` eligibility only after audit — the app deliberately omits `preload` |                                                                                                       |
| SSL/TLS → Overview (encryption mode)         | **Full (strict)** only matters for DNS-proxied origins; tunnel ingress ignores it. Leave at Full (strict) anyway so any future non-tunnel hostname fails closed                                                                                   |                                                                                                       |
| Security → Bots / challenge                  | Out of scope here — see `docs/security/waf-rules.md` (owned separately)                                                                                                                                                                           |                                                                                                       |

Cipher suites at the edge are chosen by Cloudflare and are not user-configurable
on non-Enterprise plans. Cloudflare's edge already prefers AEAD suites
(`TLS_AES_*` on 1.3, `ECDHE-*-GCM`/`CHACHA20` on 1.2) and does not offer
export/RC4/3DES/null suites. Do not expect a cipher-suite dropdown; verify
behavior with the checker instead (§4).

Authenticated Origin Pulls and Origin CA certificates are **not applicable**:
they authenticate Cloudflare to a public origin, and this origin is a private
tunnel with no inbound surface.

## 3. Origin-side TLS: plain HTTP is the design

`cloudflared` forwards `http://app:8080` and `http://lab-proxy:7000` over the
internal Docker network. This is deliberate:

- The segment between cloudflared and the app never leaves the host's bridge
  network; there is no wire to eavesdrop on.
- Terminating TLS at the origin would require a certificate on the host, a
  renewal story, and an `originRequest.caPool`/no-verify decision — all cost,
  no confidentiality gain over the already-encrypted tunnel.
- ADR 0001 (option A) records the same reasoning for app → container hops:
  sub-millisecond, no TLS, no tunnel.

If a compliance review ever requires TLS on the last hop, the options in
preference order are:

1. Point `service:` at a local TLS terminator that already exists for another
   reason (e.g. a Caddy sidecar — see `infra/verify/Caddyfile` for a working
   example) and set `originRequest.noTLSVerify: true` with a pinned
   `originRequest.caPool` if the cert is private.
2. Have `cloudflared` connect to `https://app:8080` if the app itself ever
   grows TLS; it does not today and should not for this reason alone.

Document the decision either way; do not add origin TLS speculatively.

## 4. Verification

`scripts/tls/check-tls.mjs` is a dependency-free checker (Node `tls` only).

```bash
# Live posture check of a public hostname (CI or any host with egress):
node scripts/tls/check-tls.mjs --host app.spindle.app
node scripts/tls/check-tls.mjs --host staging.spindle.app --port 443 --json

# Policy knobs: --min-version TLSv1.3 --warn-days 30 --fail-days 7 --timeout 10000

# Offline self-test of the assertion engine — no network needed:
node scripts/tls/check-tls.mjs --demo
node scripts/tls/check-tls.mjs --self-test
```

The live check verifies: handshake + certificate trust/hostname match,
certificate validity window (warn <30d, fail <7d by default), negotiated
protocol >= policy minimum, cipher strength (rejects export/RC4/DES/MD5/null,
warns on non-forward-secret suites), and whether the server still accepts
TLS 1.0 as a downgrade floor. Run it against `app.spindle.app` and
`staging.spindle.app` after any edge certificate or SSL/TLS setting change,
and on a schedule (e.g. weekly via the existing monitoring cadence) so an
expiring Universal SSL cert or an accidental Minimum-TLS downgrade is caught
before users are.

Note that `--host` checks the **edge** certificate — that is the only public
TLS surface. There is intentionally no origin-certificate check while the
tunnel carries plain HTTP.

## 5. Certificate lifecycle

Edge certificates on `spindle.app` are managed by Cloudflare: Universal SSL
covers `*.spindle.app` and `spindle.app` and renews automatically (~90-day
certificates). No certbot/ACME client runs on the origin, and none should —
the origin never terminates public TLS (§3).

Renewal _automation and monitoring_ for any origin-side certificates (should
the §3 fallback ever be adopted) plus scheduled expiry alerting is the scope
of **task 63 — certificate automation**. This document defines the policy the
checker enforces; that task wires the automation.

## Related

- `infra/tls/cloudflare-ssl-tls-settings.md` — dashboard settings table.
- `infra/origin/cloudflared/config.yml` — tunnel ingress (the origin TLS hop).
- `docs/runbooks/hosting.md` — host provisioning and verification.
- `docs/decisions/0001-container-host-topology.md` — topology rationale.
- `src/lib/security-headers.ts` — HSTS and CSP emitted by the app.
