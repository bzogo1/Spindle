# Cloudflare SSL/TLS settings reference

Dashboard path for the `spindle.app` zone. Policy rationale and verification
live in `docs/security/tls.md`; this file is the operator checklist.

## Edge Certificates (SSL/TLS → Edge Certificates)

| Setting                                | Value                         | Notes                                                                                                                                                                            |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always Use HTTPS                       | On                            | 301s `http://` to `https://` at the edge                                                                                                                                         |
| Minimum TLS Version                    | TLS 1.2                       | TLS 1.0/1.1 rejected; 1.3 still negotiated when offered                                                                                                                          |
| TLS 1.3                                | On                            | Preferred; AEAD-only cipher set                                                                                                                                                  |
| Automatic HTTPS Rewrites               | On                            | Rewrites insecure resource URLs in HTML                                                                                                                                          |
| Opportunistic Encryption               | On (default)                  | Harmless with tunnel ingress                                                                                                                                                     |
| HTTP Strict Transport Security (HSTS)  | Off at edge                   | App already emits `max-age=63072000; includeSubDomains` in production via `src/lib/security-headers.ts`; edge HSTS only after `preload` audit — app deliberately omits `preload` |
| TLS Client Auth                        | Off                           | No mTLS requirement; tunnel auth is the origin control                                                                                                                           |
| Automatic Certificate Management (ACM) | On for hostnames that need it | Universal SSL covers `spindle.app` + `*.spindle.app`                                                                                                                             |

## SSL/TLS → Overview

| Setting         | Value         | Notes                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encryption mode | Full (strict) | Applies to DNS-proxied origins only; tunnel ingress (`app.spindle.app`, `lab.spindle.app`, `staging.spindle.app`, `staging-lab.spindle.app`) is governed by `infra/origin/cloudflared/config.yml` `service:` entries, currently `http://`. Keep Full (strict) so any future non-tunnel hostname fails closed instead of silently downgrading. |

## Not applicable / do not configure

- **Origin CA / Origin certificates** — no public origin; cloudflared is the only ingress.
- **Authenticated Origin Pulls** — same reason; there is no public origin to authenticate.
- **Custom cipher suites** — Enterprise-only feature; Cloudflare's default edge suite list is already strong (TLS 1.3 AEAD, ECDHE-GCM/CHACHA20 on 1.2). Verify with `scripts/tls/check-tls.mjs --host <hostname>` rather than expecting a dashboard control.
- **Keyless SSL / Geo Key Manager** — Enterprise features, not needed.

## Optional: TLS on the cloudflared → app hop

Current design is plain HTTP inside the `spindle` Docker network — the tunnel
already encrypts edge→origin and the host has no public ports. If a review
requires TLS on this last hop, switch the ingress `service:` to `https://` and
add an `originRequest` block. Example (commented, not active):

```yaml
ingress:
  - hostname: app.spindle.app
    service: https://app:8443 # requires the app (or a sidecar) to serve TLS
    originRequest:
      connectTimeout: 10s
      tcpKeepAlive: 30s
      # With a private/self-signed origin cert, pin the CA instead of
      # disabling verification:
      # caPool: /etc/cloudflared/origin-ca.pem
      # noTLSVerify: true               # last resort only; prefer caPool
```

Do not adopt this without a documented requirement — it adds a certificate
lifecycle on the host for no confidentiality gain over the encrypted tunnel
(see `docs/security/tls.md` §3).
