# Security documentation

- [Secret management](secret-management.md) — inventory, lifecycle, access
  control, incident response, and the new-secret checklist.
- [Secrets rotation automation](secrets-rotation-automation.md) — the
  `scripts/secrets/rotation/` orchestrator, plan format, and state file.
- [Secret scanning in CI](secret-scanning-ci.md) — the gitleaks + repository
  hygiene + runtime contract layers and remediation.
- [TLS architecture](tls.md) — where TLS terminates (Cloudflare edge →
  encrypted cloudflared tunnel → plain HTTP on the private network), edge
  policy, and `scripts/tls/check-tls.mjs` verification.
- [Security headers audit](security-headers-audit.md) — header inventory from
  `src/lib/security-headers.ts`, `scripts/security/headers-audit.mjs`
  policy/audit results, and CI wiring.
- [Dependency vulnerability scanning](dependency-scanning.md) — `npm audit`
  CI gate, Dependabot config, and
  `scripts/security/deps-audit/report.mjs` reporting.

Related material outside this directory:

- [ADR 0002 — secrets management and rotation](../decisions/0002-secrets-management.md)
- [Secrets rotation runbook](../runbooks/secrets-rotation.md)
