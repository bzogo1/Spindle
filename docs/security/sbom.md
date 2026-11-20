# Software Bill of Materials (SBOM)

An SBOM is a machine-readable inventory of every software component that
ships in this project — here, every package pinned in `package-lock.json`.
It answers "what exactly is in our build?" for vulnerability response,
license compliance, and supply-chain audits.

## Format: CycloneDX

We emit **CycloneDX 1.5 JSON** (`bomFormat: "CycloneDX"`). Rationale:

- **JSON is the most interoperable** — supported by Dependency-Track,
  Grype, Syft, `@cyclonedx/cdxgen`, GitHub's dependency graph, and most
  commercial scanners. SPDX is equally valid but JSON tooling is broader.
- **`purl` (Package URL)** gives each component a stable, ecosystem-agnostic
  identifier (`pkg:npm/react@19.1.0`) that vulnerability databases match
  against directly.
- We already lock everything in `package-lock.json`, so the generator walks
  the lock tree — the SBOM reflects _exactly_ what `npm ci` installs, not
  the declared ranges in `package.json`.

## Generating an SBOM

`scripts/sbom/generate.mjs` is dependency-free Node ESM — no npm packages,
no network, safe to run anywhere Node ≥ 18 is available.

```bash
# Write sbom.cdx.json at the repo root
node scripts/sbom/generate.mjs --output sbom.cdx.json --validate

# Print to stdout
node scripts/sbom/generate.mjs

# Smoke-test with a synthetic lockfile fixture (no real deps needed)
node scripts/sbom/generate.mjs --demo --validate
```

Flags:

| Flag                 | Effect                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `--output <file>`    | Write JSON to file instead of stdout                              |
| `--demo`             | Use a built-in synthetic `package.json`/lock fixture              |
| `--validate`         | Check required CycloneDX fields before writing; exit 2 on failure |
| `--format cyclonedx` | Only format currently supported                                   |

## What each component contains

For every entry in the lockfile's `packages` map the generator emits:

- `type: "library"`, `name`, `version`
- `purl` — canonical npm package URL
- `licenses` — SPDX `id` when the license string is a simple identifier,
  otherwise free-form `name`
- `hashes` — `SHA-512` hex converted from the lockfile's SRI `integrity`
  field, for artifact verification
- `externalReferences` — the `resolved` tarball URL
- `scope: "excluded"` for dev-only packages, `"optional"` for optional deps

The root project itself is recorded under `metadata.component` as an
`application`.

## CI integration

`.github/workflows/sbom.yml` generates the SBOM on every push to `main`
and weekly (Mondays 06:00 UTC), then uploads it as a workflow artifact
(`sbom-<sha>`). To feed a scanner:

1. Download the artifact, or
2. Add a step running the generator, then pipe the output into your scanner
   (e.g. `grype sbom:sbom.cdx.json`, Dependency-Track's CycloneDX upload,
   or GitHub code scanning via a CycloneDX-to-SARIF converter).

Example component from a generated SBOM:

```json
{
  "type": "library",
  "bom-ref": "pkg:npm/react@19.1.0",
  "name": "react",
  "version": "19.1.0",
  "purl": "pkg:npm/react@19.1.0",
  "licenses": [{ "license": { "id": "MIT" } }],
  "hashes": [{ "alg": "SHA-512", "content": "01b09d11…" }],
  "externalReferences": [
    { "type": "distribution", "url": "https://registry.npmjs.org/react/-/react-19.1.0.tgz" }
  ]
}
```

## Regenerating after dependency changes

The SBOM is a build artifact, not committed. Any change to
`package.json`/`package-lock.json` changes the output; CI regenerates it
automatically. For ad-hoc audits run the generator locally against the
lockfile you intend to ship.
