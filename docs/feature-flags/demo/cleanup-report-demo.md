# Feature-flag cleanup report (demo)

- Generated: 2026-11-20T04:28:36.793Z
- Scan root: `scripts/feature-flags/demo-fixture/src`
- Registry files: 1
- Source files scanned: 3

## Summary

| Category                                        | Count |
| ----------------------------------------------- | ----- |
| Fully rolled out (remove check, keep on-branch) | 1     |
| Fully off (remove check, keep off-branch)       | 1     |
| Unused (delete registry entry)                  | 1     |
| Test-only references                            | 1     |
| Still rolling out (leave alone)                 | 1     |
| Unresolved state                                | 0     |
| Stale references (not in registry)              | 1     |

> Note: runtime `FEATURE_FLAG_*` environment overrides can flip any flag regardless of registry defaults. Verify overrides (see `src/lib/feature-flags/env.ts`) before deleting a flag.

## Fully rolled-out flags

Registry reports these as enabled for 100% of subjects. Removing the check and keeping the enabled branch is behaviour-preserving. Use `--apply --dry-run` to generate a diff plan.

### `new-dashboard`

- State: `on`, percent: 100
- Defined in: `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.ts`
- Usages: 1 (1 prod, 0 test)
  - `scripts/feature-flags/demo-fixture/src/app/dashboard/page.tsx:4` (call)

## Fully-off flags

Registry reports these as disabled for everyone. Removing the check and keeping the disabled branch is behaviour-preserving.

### `beta-export`

- State: `off`, status: off
- Defined in: `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.ts`
- Usages: 1 (1 prod, 0 test)
  - `scripts/feature-flags/demo-fixture/src/components/export-panel.tsx:4` (call)

## Unused flags

Registered but never referenced in scanned sources. Candidates for deletion from the registry.

### `legacy-widget`

- State: `on`, percent: 100
- Defined in: `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.ts`
- Usages: 0 (0 prod, 0 test)

## Test-only flags

Referenced only from test/story files. Confirm whether the flag is still needed before removing.

### `kill-switch-logs`

- State: `off`
- Defined in: `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.ts`
- Usages: 1 (0 prod, 1 test)
  - `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.test.ts:6` (call, test)

## Still rolling out

Partial rollout — do not touch.

### `dark-mode`

- State: `partial`, percent: 40
- Defined in: `scripts/feature-flags/demo-fixture/src/lib/feature-flags/registry.ts`
- Usages: 1 (1 prod, 0 test)
  - `scripts/feature-flags/demo-fixture/src/app/dashboard/page.tsx:5` (call)

## Stale references

Code references flag keys that are not present in the registry:

### `not-a-real-flag`

    - `scripts/feature-flags/demo-fixture/src/app/dashboard/page.tsx:6` (call)
