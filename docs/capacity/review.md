# Capacity review

When to re-run `scripts/capacity/calc.mjs`, and the checklist to fill in.
The model and its assumptions are in [`model.md`](./model.md).

## Triggers — re-run when ANY of these happen

**Traffic / product**

- [ ] A marketing launch, pricing change, or feature expected to move traffic
- [ ] Measured traffic grows >25% quarter-over-quarter, or `monthsToCap` in
      the last report drops below 6
- [ ] A new high-traffic surface ships (public dashboards, unauthenticated
      pages, embed/API endpoints)

**Load-test evidence**

- [ ] Any load test where `errorRate > 1%` or `p95` regresses >20% vs the
      stored baseline report
- [ ] The `mixed-traffic` scenario ceiling drops after a deploy (run the
      scenario from `scripts/perf/scenarios/` against staging)
- [ ] Quarterly: refresh the ceiling with a fresh `load.mjs --out` report —
      ceilings drift as routes and payloads change

**Infrastructure / config**

- [ ] `DATABASE_POOL_MAX`, `DATABASE_POOL_*`, or replica count changes in
      Infisical/host env
- [ ] Postgres major version bump or `max_connections` change
- [ ] App image changes process topology (cluster mode, more workers)
- [ ] Host resize (vertical) or a second host / read replica is added
- [ ] Incident postmortem mentions connection exhaustion, OOM, or CPU
      saturation on the origin

**Scheduled**

- [ ] Every 6 months regardless — paste the latest numbers into the template
      below and commit the report JSON next to this file if the delta matters

## Review checklist

Copy this block into the PR/issue or a `docs/capacity/reviews/YYYY-MM-DD.md`:

```markdown
## Capacity review — YYYY-MM-DD

Trigger: <which trigger above>

### Measurements

- load.mjs report: <path or link to --out JSON>
- achieved ceiling RPS: ____ (p95 ____ ms, err ____%)
- current production RPS (estimate or analytics): ____
- target RPS (next 3–12 mo): ____
- growth assumption: ____% per ____ months

### Calculator output

node scripts/capacity/calc.mjs --load-report <report> --target-rps <n> \
--growth <g> --app-replicas <n> --read-replicas <n>

- max sustainable RPS: ____
- months to ceiling: ____
- DB connections: ____ / max_connections ____ (____%)

### Decision

- [ ] No action — headroom OK
- [ ] Vertical resize planned: <target size, date>
- [ ] App replicas: <count> — justification: <single-process saturation evidence>
- [ ] Read replicas: <count> — replica-safe reads migrated: <call sites>
- [ ] Pool retune: DATABASE_POOL_MAX <old> → <new>
- [ ] max_connections change: <old> → <new>, requires PG restart window

### Follow-ups

- <owner / ticket>
```

## Interpreting the calculator output

- **`[blocker]` on connections** — do not ship traffic growth until resolved;
  connection exhaustion takes Postgres down for app _and_ worker.
- **`[action] vertical`** — expected on a single host; file the resize as
  infra work (host.env + compose are pinned, images unaffected).
- **`[info] read-replicas`** — only act if primary DB CPU/IO (not app CPU)
  is the measured bottleneck; replicas add connections per app process.
- **`monthsToCap` is optimistic** — it uses the _un-discounted_ ceiling;
  treat it as an upper bound on time remaining.
