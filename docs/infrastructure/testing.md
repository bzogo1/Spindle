# Infrastructure testing

Infrastructure here is tested at three levels, ordered by cost. CI and local
development only ever exercise the first two; the third runs on real hardware.

## 1. Static validation — `scripts/infra-test/validate.mjs`

There is no live cloud in CI, so `validate.mjs` checks everything that can be
verified without a host:

- **Syntax.** Every `*.yml`/`*.yaml` file is parsed (js-yaml, already in
  `node_modules` — the script adds no dependencies), every `*.json` file is
  parsed, and every `*.sh` file passes `bash -n`.
- **Compose structure.** YAML files whose path contains the substring
  `compose` (a substring match, not a glob — `mycompose.yaml`,
  `compose.prod.yml`, and any directory named `*compose*` all match) must
  define a `services` mapping; each service needs an `image` or `build`, its
  `depends_on` targets must exist, and port entries must parse.
- **cloudflared ingress.** YAML files whose path contains the substring
  `cloudflared` (the same substring rule — it does not have to live in a
  `cloudflared/` directory) must have a
  non-empty `ingress` list, unique valid hostnames, and must end with a
  hostname-less `service: http_status:404` catch-all — anything else is a
  FAIL, because an unmatched hostname would otherwise fall through to a real
  upstream.
- **Cross-file consistency.**
  - Every `${VAR:?…}` required by a compose file must be documented in a
    `*.env.example` (defaulted `${VAR:-…}` variables are INFO).
  - Every `http(s)://host:port` tunnel upstream that names a compose service
    must use a port that service actually exposes. Upstreams that are not
    compose services (e.g. the host-run `lab-proxy`) are WARN — verify them
    by hand or via `verify-topology.sh`.
  - `infra/` paths referenced by shell scripts (e.g. the files
    `infra/host/bootstrap.sh` installs) must exist.

Run it from the repo root:

```sh
node scripts/infra-test/validate.mjs          # human-readable report
node scripts/infra-test/validate.mjs --json   # machine-readable report
node scripts/infra-test/validate.mjs --demo   # validate the fixture tree
```

Exit codes: `0` = no failures (warnings allowed), `1` = at least one FAIL,
`2` = the target tree could not be read or contains no files. There is no
argument validation — unknown flags are ignored, `--root` with no argument
falls back to `infra` resolved against the **current working directory**
(not necessarily the repo root), so pass an explicit path when in doubt.
`--demo` validates
`scripts/infra-test/fixtures/demo/`, an intentionally broken mini-tree that
demonstrates both PASS and FAIL output, and always exits `0`.

To point it at a different tree (for example a staging overlay), use
`--root <dir>`; all checks and cross-file rules apply unchanged.

## 2. Dry-run bootstraps

`infra/host/bootstrap.sh` is written to be safe to re-run, but it still
requires a fresh Ubuntu 24.04 host and root — there is no true dry-run mode.
What can be exercised without hardware:

- `bash -n infra/host/bootstrap.sh` (covered by `validate.mjs`) catches
  syntax regressions.
- Read the script against `docs/runbooks/hosting.md` before the first real
  run; `validate.mjs` additionally confirms every `infra/…` path it
  references exists.
- The firewall step is opt-in (`SPINDLE_APPLY_FIREWALL=1`) precisely so a
  dry inspection cannot lock out SSH. Never enable it before admin access
  (Tailscale or Cloudflare Access) is confirmed — see ADR 0001 §4.

## 3. Live topology checks — `scripts/hosting/verify-topology.sh`

This is the only infra "test" that touches Docker, and it must run **on the
origin host** (or any machine with Docker and the `spindle`/`spindle-lab`
networks). It proves the ADR 0001 §7 claims:

1. A session-like container starts on `spindle-lab` with no published port.
2. A probe Caddy proxy on `spindle` (also attached to `spindle-lab`) upgrades
   a WebSocket end-to-end — the same path `cloudflared` → `lab-proxy` takes.
3. Optionally, a real `wss://` tunnel leg when `SPINDLE_LAB_URL` and
   `SPINDLE_SESSION_TOKEN` are set (skipped otherwise).
4. Warm start stays under 20 s and the orchestrator container can resolve the
   session container over the private network.

It creates throwaway containers labelled `spindle.session=probe` and removes
them on exit; it is safe to re-run.

Related live check: `scripts/gateway/verify-gateway.sh` validates the
gateway/routing layer when a gateway deployment exists.

## Suggested CI wiring

Add a single step to the existing lint/test job — no new workflow file is
required:

```yaml
- name: Validate infrastructure config
  run: node scripts/infra-test/validate.mjs
```

It needs only Node and the repo's `node_modules` (for js-yaml). Because it is
purely static, it is safe on every PR. `verify-topology.sh` and
`bootstrap.sh` deliberately stay out of CI: they need Docker, root, and/or a
real host, and belong to the deploy runbook
(`docs/runbooks/hosting.md`) executed by an operator.
