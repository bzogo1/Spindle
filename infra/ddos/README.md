# DDoS runbook configs

Runbook-style assets for `docs/security/ddos-protection.md`. Nothing here is
applied automatically — each file documents or scripts a manual step on the
production host (`/srv/spindle`, Hetzner AX42) or in the Cloudflare dashboard.

| File                    | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `README.md` (this file) | Cloudflare dashboard steps + how the pieces fit                                  |
| `ufw-rules.sh`          | Optional explicit ufw rules when SSH must be public (default posture needs none) |
| `fail2ban/jail.local`   | fail2ban jail banning repeated SSH failures                                      |
| `fail2ban/sshd.local`   | fail2ban filter tuning for sshd                                                  |

## 1. Cloudflare dashboard — standing configuration

Do this once per zone (`spindle.app`). All steps are in the Cloudflare
dashboard; no `cloudflared` change is needed because the tunnel already
terminates at the edge.

1. **Confirm the tunnel is the only ingress.** DNS for `app.spindle.app` and
   `lab.spindle.app` must be CNAMEs to `<tunnel-id>.cfargotunnel.com` (created
   by `cloudflared tunnel route dns`, see `docs/runbooks/hosting.md` §2).
   There must be **no A/AAAA records** pointing at the Hetzner IP for any
   hostname that serves the app — a stray record re-exposes the origin.
2. **SSL/TLS → Overview**: mode **Full (strict)**. The edge already terminates
   client TLS; this governs edge→origin, and the tunnel makes it moot for
   direct traffic but matters if a hostname is ever moved off the tunnel.
3. **Security → Settings**:
   - "I'm Under Attack mode": **off** normally; toggle on during a confirmed
     L7 attack (see §3).
   - Security Level: medium or higher.
   - Challenge Passage: 30 min is a reasonable default during incidents.
4. **Security → Bots**:
   - Free plan: enable **Bot Fight Mode**.
   - Pro plan: enable **Super Bot Fight Mode** with "Definitely automated"
     → Managed Challenge.
5. **Security → WAF → Managed rules**: deploy the Cloudflare Managed Ruleset
   (and the Cloudflare OWASP Core Ruleset if on a plan that allows it). See
   `docs/security/waf-rules.md` for the full WAF layer.
6. **Turnstile**: create a widget for the site key used by the auth/feedback
   forms (site keys live in Infisical, not here).

## 2. Cloudflare dashboard — rate limiting (tie-in)

Standing rules belong in `docs/security/edge-rate-limiting.md`. For DDoS
specifically, keep one **emergency rule** ready:

- Expression: `http.host eq "app.spindle.app"` (or all hostnames)
- Criteria: requests per minute per IP > threshold (start at 300; lower to
  100–200 during an incident)
- Action: **Managed Challenge** (not Block — shared IPs/CGNAT false-positive)
- Duration: until manually disabled

Free tier allows 1 rate-limiting rule — if the standing edge rules from
`edge-rate-limiting.md` already consume it, keep the emergency rule as the
single rule and rely on WAF custom rules + IUAM for the rest.

## 3. During a confirmed L7 attack

Order matters — cheapest/fastest first:

1. Toggle **I'm Under Attack mode** on (Security → Settings). This challenges
   every visitor; legitimate users see a one-time JS check.
2. Enable/tighten the emergency rate-limit rule (§2). Drop threshold
   progressively: 300 → 100 → 30 req/min/IP.
3. Add a WAF custom rule blocking the attacking ASNs/countries if the
   traffic is geo-concentrated and the product has no users there.
4. Watch detection signals (see `docs/security/ddos-protection.md` §Layer 3):
   `node scripts/ddos/traffic-spike.mjs --file app.log`, Sentry volume,
   `node scripts/metrics/log-metrics.mjs --file app.log --format prometheus`.
5. **Do not** restart containers or change firewall rules reactively — the
   attack is at the edge; the origin is not the bottleneck unless direct
   ingress is verified open (check `docker ps` port bindings).
6. When the attack stops: disable IUAM, restore rate-limit thresholds, and
   note the incident in `docs/incidents/` (template: `rate-limit-abuse.md`).

## 4. Origin firewall

Default posture (from `docs/runbooks/hosting.md` §1 and
`infra/host/bootstrap.sh`): **default deny incoming, default allow outgoing,
no inbound rules**. SSH admin goes through Tailscale or Cloudflare Access —
there is no public 22.

Verify on the host:

```bash
sudo ufw status verbose        # expect: default deny (incoming), allow (outgoing)
sudo docker ps --format '{{.Names}} {{.Ports}}'   # only 127.0.0.1:8080->8080/tcp
sudo ss -tlnp                  # nothing public except cloudflared's outbound conns
```

### If SSH must be publicly reachable (exception path)

Apply `ufw-rules.sh` on the host. It is a dry-run-by-default script; pass
`--apply` to install the rules. It:

- keeps default deny incoming / allow outgoing;
- allows SSH **only** from a management CIDR you pass via
  `MGMT_CIDR=…` (never `anywhere`);
- explicitly denies the rest of the world on common web ports as a safety net
  in case a container later publishes `0.0.0.0` (Docker bypasses ufw for
  published ports — belt-and-suspenders only).

Then install fail2ban (§5). Re-lock SSH to the admin path as soon as the
emergency is over.

## 5. SSH brute-force protection (fail2ban)

If the exception path above is active, install:

```bash
sudo apt-get install -y fail2ban
sudo install -m 0644 infra/ddos/fail2ban/sshd.local /etc/fail2ban/filter.d/sshd.local
sudo install -m 0644 infra/ddos/fail2ban/jail.local /etc/fail2ban/jail.d/spindle.local
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

The jail bans an IP for 1 hour after 5 failures in 10 minutes
(`maxretry`, `findtime`, `bantime` in `jail.local`). Adjust `bantime`
incrementally for repeat offenders.

If SSH is only reachable via Tailscale/Cloudflare Access, fail2ban is
optional — there is no public sshd to brute-force — but installing it is
harmless and covers misconfiguration.

## 6. What NOT to do

- Do not publish app/Postgres/Valkey ports to `0.0.0.0` "for debugging" —
  Docker bypasses ufw and the tunnel is the only intended ingress.
- Do not add `ufw allow 80/443` — TLS terminates at Cloudflare; the origin
  speaks QUIC outbound only.
- Do not disable the second `cloudflared` connector during an attack — it is
  the redundancy path.
- Do not rate-limit at the origin app for volumetric floods — Node will
  saturate before the limiter helps; edge rules are the lever.
