# Environment parity

`scripts/config/env-parity.mjs` verifies that the environment-variable
contract stays consistent across every place it is declared. It is a plain
Node script (no dependencies, no TypeScript toolchain) so it can run in CI,
pre-commit hooks, or local shells.

## What it checks

The checker reads four kinds of sources and cross-references them:

| Source                                       | What it provides                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.env.example`                               | The documented contract — key names only, values are never read                                                |
| `src/lib/env-schema.ts`                      | `clientSchema` (browser-safe zod schema)                                                                       |
| `src/lib/env.server.ts`                      | `serverSchema`, `buildSchema`, expectation messages, and `configuredEnvKeys` (the "must stay documented" list) |
| `src/lib/env.ts`                             | `clientExpectations` and `rawClientEnv` (the hand-rolled client parser)                                        |
| `.env*` files in the repo root               | Per-environment overrides — **key presence only, never values**                                                |
| `src/**` (`*.ts`/`*.tsx`, comments stripped) | Stray `process.env.X` reads outside the env modules                                                            |

It then verifies:

1. **Contract parity** — every `configuredEnvKeys` entry and every schema key
   (except platform/tooling variables `NODE_ENV`, `NEXT_RUNTIME`, `CI`,
   `ANALYZE`) is documented in `.env.example`, every schema key is listed in
   `configuredEnvKeys`, and every `.env.example` key is referenced by the
   contract. Orphaned entries in either direction are errors.
2. **Env-file key parity** — `.env`, `.env.local`, `.env.development`,
   `.env.test`, `.env.production` (and `*.local` variants) may only contain
   keys known to `.env.example`. Env files are sparse overrides, so missing
   contract keys are fine; unknown keys are warnings.
3. **`NEXT_PUBLIC_*` prefixing** — client-exposed keys must carry the
   `NEXT_PUBLIC_` prefix (except `NODE_ENV`, which Next.js inlines itself),
   and every `NEXT_PUBLIC_*` key in `.env.example` must be declared in the
   client schema, or it will never reach the browser bundle.
4. **Stray references** — `process.env.X` reads in `src/` outside
   `src/lib/env*.ts` that are not part of the validated contract are
   reported as warnings.

## Usage

```sh
# Human-readable markdown report on stdout
node scripts/config/env-parity.mjs

# JSON report
node scripts/config/env-parity.mjs --json

# CI gating: warnings also fail the build
node scripts/config/env-parity.mjs --ci

# Write environment-parity.md + environment-parity.json to a directory
node scripts/config/env-parity.mjs --report-dir reports/

# Preview the report format against a built-in fixture (always exits 0)
node scripts/config/env-parity.mjs --demo

# Skip writing report files
node scripts/config/env-parity.mjs --report-dir reports/ --dry-run
```

## Exit codes

| Code | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| `0`  | No errors. Warnings are allowed unless `--ci` is passed.                                           |
| `1`  | One or more error findings (or, with `--ci`, any warning). Also used for missing contract sources. |
| `2`  | Unexpected failure or bad CLI usage.                                                               |

## Findings and severity

- **error** — contract violations: undocumented schema keys, missing
  `configuredEnvKeys` entries, orphaned `.env.example` keys, and
  `NEXT_PUBLIC_*` keys that cannot reach the browser. These fail the run in
  every mode.
- **warning** — `.env*` files setting undocumented keys, `NEXT_PUBLIC_*`
  keys declared only in the server schema, and stray `process.env` reads in
  `src/`. These fail only under `--ci`.

The JSON report (`environment-parity.json`) contains the same data as the
markdown report: generation timestamp, contract coverage counts, per-file
key listings (names only), and the sorted findings list.

## Maintaining the contract

When adding a new environment variable:

1. Add it to the appropriate schema in `src/lib/env-schema.ts` /
   `src/lib/env.server.ts` (or the client parser in `src/lib/env.ts`).
2. Add it to `configuredEnvKeys` in `src/lib/env.server.ts`.
3. Document it in `.env.example` with a comment explaining when it is
   required.

Platform-injected variables (`NODE_ENV`, `NEXT_RUNTIME`, `CI`, `ANALYZE`)
are exempt from documentation — they are set by Next.js, the deploy
platform, or local tooling and must not be configured by hand.

Related: `npm run env:check` (`scripts/validate-env.ts`) validates actual
values against the zod schemas at build/boot; this checker validates the
_shape_ of the contract across files. See also
`docs/runbooks/secrets-rotation.md` for the production secrets contract.
