# Edge rate-limiting examples

Rate limiting for Spindle runs in two layers:

1. **Edge (this directory)** — Cloudflare Rate Limiting rules on the tunnelled
   hostnames (`app.spindle.app`, `lab.spindle.app`) plus an optional nginx
   `limit_req` fallback for the origin container. See
   `docs/security/edge-rate-limiting.md` for the tiering rationale.
2. **App** — `src/lib/rate-limit/` sliding-window limiter for per-route
   limits the edge cannot express (per-user, per-API-key, healthcheck bypass).

These files are **examples**, not applied configuration. Cloudflare rules live
in the dashboard or Terraform state owned by infra; the nginx snippet is a
reference for a future origin-side proxy if one is introduced.
