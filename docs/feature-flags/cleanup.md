# Feature-flag cleanup automation

`scripts/feature-flags/cleanup.mjs` finds flags that are safe to remove:
fully rolled out, fully off, unused, or referenced by code that no longer
exists in the registry. It is **report-only by default** — it never edits
application files.

## Quick start

```bash
# Scan src/ against the registry in src/lib/feature-flags/
node scripts/feature-flags/cleanup.mjs

# Try it on the bundled fixture (no real flags required)
node scripts/feature-flags/cleanup.mjs --demo

# Custom outputs
node scripts/feature-flags/cleanup.mjs --json /tmp/report.json --markdown /tmp/report.md

# Generate a diff plan for safe call-site rewrites (still edits nothing)
node scripts/feature-flags/cleanup.mjs --apply --dry-run
```

Reports are written to `docs/feature-flags/cleanup-report.{md,json}`
(`docs/feature-flags/demo/cleanup-report-demo.{md,json}` in `--demo` mode).

## What it detects

### Registry discovery

The script scans `<scan-dir>/lib/feature-flags/` (default `src/lib/feature-flags/`)
for flag definitions, skipping `analytics/`, `*.test.*`, `*.spec.*`, and
`__tests__/` files. It recognises the shapes the flag module is expected to
use:

- **Object-literal registries** — `"flag-name": { name, description, defaults: { … } }`
  (the current `featureFlags` map in `src/lib/feature-flags/flags.ts`). Each
  entry is brace-matched so nested fields can't bleed into siblings.
- **Field-style entries** — `{ key|flag|flagKey|featureKey|flagName: "name", … }`.
- **Map-style entries** — `["name"]: { … }`.
- **Loose attribute fallback** — when no `defaults` map is present, rollout
  state is inferred from `percent`/`percentage`/`rollout`, `enabled`,
  `disabled`, `status`, and `default` attributes near the key.

For the real registry format, per-environment `defaults` targets
(`fallback`, `development`, `test`, `production`, … with `true | false |
{ percentage: N }`) are parsed and classified:

| State     | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| `on`      | `fallback: true` and no environment disables it         |
| `off`     | `fallback: false` and every explicit environment is off |
| `partial` | Anything else — env-dependent, leave alone              |

> **Env overrides:** `FEATURE_FLAG_*` environment variables (see
> `src/lib/feature-flags/env.ts`) can flip any flag at runtime regardless of
> registry defaults. The report carries a reminder; verify deployed overrides
> before deleting a flag.

### Usage scanning

Every `.ts/.tsx/.js/.jsx/.mjs` file under the scan root is searched for:

- **Call sites** — `useFeatureFlag("name")`, `getFeatureFlag("name")`,
  `evaluateFlagByName("name")`, `getFeatureFlags`, `getFlagDefinition`, plus
  the generic names (`evaluateFlag`, `flagEnabled`, …) for forward
  compatibility.
- **Registry member access** — `featureFlags["name"]`,
  `featureFlags.name`, `flagRegistry[…]`.
- **Literal references** — any quoted occurrence of a registered key,
  catching indirect references through constants and config objects.

Registry definition files themselves are excluded from usage counting.
References inside `src/lib/feature-flags/` to _unregistered_ names are not
reported as stale (the module's own tests intentionally evaluate unknown
names).

## Report categories

| Category           | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `fully-rolled-out` | On for every environment → remove the check, keep the enabled branch   |
| `fully-off`        | Off for every environment → remove the check, keep the disabled branch |
| `unused`           | Registered but never referenced → delete the registry entry            |
| `test-only`        | Referenced only from `*.test.*`/`*.spec.*`/`*.stories.*` files         |
| `partial`          | Still rolling out — do not touch                                       |
| `unresolved`       | Registry entry found but state could not be determined                 |
| stale references   | Code uses flag keys missing from the registry                          |

The Markdown report lists each flag with its state, per-environment
defaults, definition site, and up to 10 usage locations. The JSON report
adds full usage lists (capped at 50 per flag), the `flagModuleImports`
map, and a machine-readable `summary`.

## `--apply --dry-run`

Apply mode is deliberately gated:

- `--apply` **requires** `--dry-run`; `--apply` alone exits with an error.
- It **never modifies files**. It emits `cleanup-plan.diff` (in the report
  output directory) containing a unified diff plus a manual-review list.

The diff plan only rewrites _single-line, whitelisted call sites_ for
`fully-rolled-out`/`fully-off` flags, e.g.:

```diff
-  const enabled = useFeatureFlag("new-dashboard")
+  const enabled = true /* flag "new-dashboard" fully rolled out — cleanup */
```

Everything else — JSX branches (`flag ? <A/> : <B/>`), member access,
multi-line calls, registry-entry deletion — is listed under "Manual review"
because mechanical rewriting is unsafe without type information.

## Options

| Flag                 | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `--demo`             | Scan `scripts/feature-flags/demo-fixture/` instead of `src/` |
| `--scan-dir <dir>`   | Source root to scan (default `src`)                          |
| `--registry-dir <d>` | Registry directory (default `<scan-dir>/lib/feature-flags`)  |
| `--registry <file>`  | Single registry file; skips directory discovery              |
| `--json <file>`      | JSON report path                                             |
| `--markdown <file>`  | Markdown report path                                         |
| `--out-dir <dir>`    | Default output directory                                     |
| `--apply --dry-run`  | Write `cleanup-plan.diff` alongside the report               |
| `-h`, `--help`       | Usage text                                                   |

## Extending

- **New evaluation API names** — add them to `CALL_RE` (usage detection)
  and `SAFE_CALL_RE` (apply-mode whitelist) in `cleanup.mjs`.
- **New registry shapes** — extend `extractRegistryEntries()` /
  `parseDefaultsTargets()`. Keep the `defaults`-map path preferred; the
  attribute fallback exists for simpler registries.
- **New rollout attributes** — add patterns to `attributeMatches()`.

## Demo fixture

`scripts/feature-flags/demo-fixture/` contains a miniature `src/` tree that
exercises every category: a fully-rolled-out flag, a fully-off flag, a
partial rollout, an unused flag, a test-only flag, and a stale reference.
Run `node scripts/feature-flags/cleanup.mjs --demo` to see the full pipeline
without touching real code.
