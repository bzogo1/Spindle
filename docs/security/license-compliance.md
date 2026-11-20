# License compliance

`scripts/licenses/check.mjs` audits every dependency in `package-lock.json`
against a small SPDX policy. It is dependency-free (plain Node, no npm
packages) so it can run in CI without installing anything.

## Policy

`scripts/licenses/licenses.policy.json` has three lists:

| List      | Meaning                                                                                                                      | Exit impact                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `allowed` | SPDX ids cleared for use (MIT, Apache-2.0, BSD-*, ISC, MPL-2.0, BlueOak-1.0.0, 0BSD, Unlicense, CC0-1.0, PSF-2.0, CC-BY-4.0) | pass                           |
| `denied`  | SPDX ids that must never ship (GPL-_, AGPL-_, SSPL-_, BUSL-_, Commons-Clause, CC-BY-NC-_, CC-BY-ND-_)                        | **fails the check** (exit 1)   |
| `review`  | SPDX ids needing human sign-off (LGPL-_, EPL-_, CDDL-_, WTFPL, Python-_, FSL-_, CC-BY-SA-_, Artistic-*)                      | exit 2 unless `--allow-review` |

Entries ending in `*` match by prefix (e.g. `GPL-*` covers `GPL-2.0-only`,
`GPL-3.0-or-later`). Anything not listed anywhere is treated as
**unknown → review**.

### SPDX expressions

Lockfiles sometimes carry expressions like `Apache-2.0 AND
LGPL-3.0-or-later` or `(MIT OR CC0-1.0)`. The checker extracts every SPDX id
in the expression and applies a conservative rule: **the package takes the
worst status of any id mentioned** (denied > review > allowed). This can
over-flag `OR` expressions that contain an escape hatch; if that becomes
noisy, add the specific expression's ids to `allowed` deliberately or refine
the evaluator.

### Missing and non-SPDX licenses

- A package with **no `license` field** is reported as `missing-license`
  (review). Fix upstream metadata or add a justified entry to the policy.
- Free-text licenses (e.g. `SEE LICENSE IN README`) produce
  `unparseable-license`/`unknown id` review items. Replace them with real
  SPDX ids where possible; otherwise document the exception in the policy or
  in this file.

## Usage

```bash
# Audit the real lockfile (human-readable)
node scripts/licenses/check.mjs

# Machine-readable report
node scripts/licenses/check.mjs --json

# Audit `npm ls --json` output or a different lockfile.
# NOTE: `npm ls --json` does not emit license fields, so every package is
# reported as missing-license; prefer package-lock.json for real audits.
npm ls --json > /tmp/ls.json
node scripts/licenses/check.mjs --input /tmp/ls.json

# Demo against built-in sample data (exercises all statuses)
node scripts/licenses/check.mjs --demo

# Treat review items as non-blocking (used in CI today)
node scripts/licenses/check.mjs --allow-review
```

### Exit codes

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| 0    | No denied licenses; no review items (or `--allow-review`) |
| 1    | At least one **denied** license found                     |
| 2    | No denied, but review/missing/unknown items found         |
| 3    | Usage or I/O error                                        |

## Current state of this repo

As of the last audit: ~1,766 packages — overwhelmingly MIT/ISC/Apache/BSD.
The review list contains the `sharp`/`@img/*` libvips binaries
(LGPL-3.0-or-later, dynamically linked — acceptable, documented here),
`argparse@2` (Python-2.0, dev-only), `elkjs` (EPL-2.0), `opener` (WTFPL OR
MIT), `sentry` dev tooling (FSL-1.1-Apache-2.0, converts to Apache-2.0 after
2 years), and two packages with no license field (`exit`, `format`). None are
denied, so CI runs with `--allow-review`; revisit the review list when
dependencies change.

## CI integration

`.github/workflows/license-check.yml` runs the check on every pull request
and weekly (`schedule`), plus on pushes to `main`. It uses
`--allow-review` so newly introduced **denied** licenses fail the build while
the known review set stays visible in the job log; drop `--allow-review` once
the review list is cleaned up.

To tighten policy: move an id from `review` to `denied` (or `allowed`) in
`licenses.policy.json` and re-run the script locally before pushing.
