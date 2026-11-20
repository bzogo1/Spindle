# Feature-flag cleanup report

- Generated: 2026-11-20T04:28:36.650Z
- Scan root: `src`
- Registry files: 15
- Source files scanned: 822

## Summary

| Category                                        | Count |
| ----------------------------------------------- | ----- |
| Fully rolled out (remove check, keep on-branch) | 0     |
| Fully off (remove check, keep off-branch)       | 0     |
| Unused (delete registry entry)                  | 1     |
| Test-only references                            | 1     |
| Still rolling out (leave alone)                 | 1     |
| Unresolved state                                | 0     |
| Stale references (not in registry)              | 0     |

> Note: runtime `FEATURE_FLAG_*` environment overrides can flip any flag regardless of registry defaults. Verify overrides (see `src/lib/feature-flags/env.ts`) before deleting a flag.

## Unused flags

Registered but never referenced in scanned sources. Candidates for deletion from the registry.

### `realtime-collab`

- State: `partial`
- Defaults: fallback=false, development=true, test=true, production=25%
- Defined in: `src/lib/feature-flags/flags.ts`
- Usages: 0 (0 prod, 0 test)

## Test-only flags

Referenced only from test/story files. Confirm whether the flag is still needed before removing.

### `docs-search-v2`

- State: `off`
- Defaults: fallback=false
- Defined in: `src/lib/feature-flags/flags.ts`
- Usages: 2 (0 prod, 2 test)
  - `src/components/feature-flags/use-feature-flag.test.tsx:7` (reference, test)
  - `src/lib/feature-flags/evaluate.test.ts:29` (reference, test)

## Still rolling out

Partial rollout — do not touch.

### `new-dashboard`

- State: `partial`
- Defaults: fallback=false, development=true, test=true
- Defined in: `src/lib/feature-flags/flags.ts`
- Usages: 16 (2 prod, 14 test)
  - `src/components/feature-flags/use-feature-flag.test.tsx:7` (reference, test)
  - `src/components/feature-flags/use-feature-flag.test.tsx:15` (reference, test)
  - `src/components/feature-flags/use-feature-flag.test.tsx:22` (reference, test)
  - `src/components/feature-flags/use-feature-flag.test.tsx:31` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:39` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:40` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:109` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:120` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:123` (reference, test)
  - `src/lib/feature-flags/analytics/analytics.test.ts:125` (reference, test)
  - … 6 more
