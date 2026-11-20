#!/usr/bin/env node
/**
 * generate.mjs — dependency-free CycloneDX SBOM generator.
 *
 * Walks package-lock.json (lockfileVersion 3 `packages` map) and emits a
 * CycloneDX 1.5 JSON SBOM containing name, version, license, resolved URL,
 * integrity hash, and package URL (purl) for every locked dependency.
 *
 * Usage:
 *   node scripts/sbom/generate.mjs [--output sbom.cdx.json] [--format cyclonedx]
 *   node scripts/sbom/generate.mjs --demo [--output demo.cdx.json]
 *   node scripts/sbom/generate.mjs --validate   # validate before writing
 *
 * Exit codes: 0 ok, 1 usage/io error, 2 validation failure.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

const SPEC_VERSION = "1.5"
const BOM_FORMAT = "CycloneDX"

// Minimal synthetic lockfile used by --demo so the tool can be exercised
// without touching the real dependency tree.
const DEMO_PACKAGE_JSON = {
  name: "demo-app",
  version: "0.0.0",
  private: true,
}
const DEMO_LOCK = {
  name: "demo-app",
  version: "0.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "demo-app",
      version: "0.0.0",
      dependencies: { react: "^19.0.0" },
    },
    "node_modules/react": {
      version: "19.1.0",
      resolved: "https://registry.npmjs.org/react/-/react-19.1.0.tgz",
      integrity: "sha512-9n0f3pKx6S8bN0L2lD7Y3e7Vx1rCqz8hQwE5tY0uI1oP4sD6fG8hJ0kL2mN4bV6cX8z",
      license: "MIT",
    },
    "node_modules/react-dom": {
      version: "19.1.0",
      resolved: "https://registry.npmjs.org/react-dom/-/react-dom-19.1.0.tgz",
      integrity: "sha512-3xR9f8Yz0aBcDeFgHiJkLmNoPqRsTuVwXyZ1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6",
      license: "MIT",
      peerDependencies: { react: "^19.0.0" },
    },
    "node_modules/@scope/widget": {
      version: "2.3.1",
      resolved: "https://registry.npmjs.org/@scope/widget/-/widget-2.3.1.tgz",
      integrity: "sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789aBcDeFgHiJkLmNoPqRsTuVwXy",
      license: { type: "Apache-2.0" },
      engines: { node: ">=18" },
    },
  },
}

function usage() {
  return `Usage: node scripts/sbom/generate.mjs [options]

Options:
  --output <file>   Write SBOM JSON to <file> (default: stdout)
  --format <fmt>    Output format; only "cyclonedx" is supported (default)
  --demo            Use a synthetic package.json/package-lock.json fixture
  --validate        Validate the generated BOM before writing (exit 2 on failure)
  --help            Show this help
`
}

function parseArgs(argv) {
  const args = { output: null, format: "cyclonedx", demo: false, validate: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--help" || a === "-h") args.help = true
    else if (a === "--demo") args.demo = true
    else if (a === "--validate") args.validate = true
    else if (a === "--output" || a === "-o") {
      args.output = argv[++i]
      if (!args.output) throw new Error("--output requires a file path")
    } else if (a === "--format") {
      args.format = argv[++i]
      if (!args.format) throw new Error("--format requires a value")
    } else if (a.startsWith("--output=")) args.output = a.slice("--output=".length)
    else if (a.startsWith("--format=")) args.format = a.slice("--format=".length)
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (args.format !== "cyclonedx") {
    throw new Error(`Unsupported format "${args.format}". Only "cyclonedx" is implemented.`)
  }
  return args
}

function loadInputs(demo) {
  if (demo) {
    return { pkg: DEMO_PACKAGE_JSON, lock: DEMO_LOCK }
  }
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"))
  const lock = JSON.parse(readFileSync(resolve(REPO_ROOT, "package-lock.json"), "utf8"))
  return { pkg, lock }
}

// Extract the package name from a lockfile `packages` key, e.g.
// "node_modules/foo/node_modules/@scope/bar" -> "@scope/bar".
function nameFromKey(key) {
  const idx = key.lastIndexOf("node_modules/")
  return idx === -1 ? key : key.slice(idx + "node_modules/".length)
}

// Encode an npm package name for a Package URL (purl).
// Scoped names map to namespace/name, e.g. "@scope/widget" -> "%40scope/widget"
// producing "pkg:npm/%40scope/widget@2.3.1".
function npmPurl(name, version) {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/")
    if (slash !== -1) {
      const ns = encodeURIComponent(name.slice(0, slash)) // "@" -> "%40"
      const pkgName = encodeURIComponent(name.slice(slash + 1))
      return `pkg:npm/${ns}/${pkgName}@${version}`
    }
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`
}

// Convert SRI integrity "sha512-<base64>" to CycloneDX hash {algorithm, content}.
// CycloneDX prefers hex; fall back to raw content if decoding fails.
function integrityToHash(integrity) {
  if (typeof integrity !== "string") return []
  const match = integrity.match(/^(sha\d+)-(.+)$/)
  if (!match) return []
  const alg = match[1].toUpperCase().replace("SHA", "SHA-")
  const b64 = match[2]
  try {
    const hex = Buffer.from(b64, "base64").toString("hex")
    if (hex.length > 0) return [{ alg, content: hex }]
  } catch {
    // fall through
  }
  return [{ alg, content: b64 }]
}

function licenseEntries(licenseField) {
  if (!licenseField) return []
  const values = Array.isArray(licenseField) ? licenseField : [licenseField]
  const out = []
  for (const v of values) {
    const name = typeof v === "string" ? v : v?.type || v?.name
    if (!name || typeof name !== "string") continue
    // Treat plain SPDX-ish identifiers as license.id, everything else as a
    // free-form license.name.
    if (/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(name) && name.length <= 40) {
      out.push({ license: { id: name } })
    } else {
      out.push({ license: { name } })
    }
  }
  return out
}

function buildComponents(lock) {
  const packages = lock.packages || {}
  const seen = new Set()
  const components = []
  for (const [key, meta] of Object.entries(packages)) {
    if (!key || key === "" || !meta || !meta.version) continue
    const name = nameFromKey(key)
    const version = meta.version
    const purl = npmPurl(name, version)
    if (seen.has(purl)) continue
    seen.add(purl)

    const component = {
      type: "library",
      "bom-ref": purl,
      name,
      version,
      purl,
    }
    const licenses = licenseEntries(meta.license)
    if (licenses.length > 0) component.licenses = licenses
    const hashes = integrityToHash(meta.integrity)
    if (hashes.length > 0) component.hashes = hashes
    if (typeof meta.resolved === "string" && meta.resolved) {
      component.externalReferences = [{ type: "distribution", url: meta.resolved }]
    }
    if (meta.dev === true) component.scope = "excluded"
    if (meta.optional === true) component.scope = "optional"
    components.push(component)
  }
  // Deterministic ordering for stable diffs.
  components.sort((a, b) => a.purl.localeCompare(b.purl))
  return components
}

function buildBom(pkg, lock) {
  const components = buildComponents(lock)
  const bom = {
    bomFormat: BOM_FORMAT,
    specVersion: SPEC_VERSION,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "spindle",
          name: "scripts/sbom/generate.mjs",
        },
      ],
      component: {
        type: "application",
        "bom-ref": `pkg:npm/${pkg.name || "app"}@${pkg.version || "0.0.0"}`,
        name: pkg.name || "app",
        version: pkg.version || "0.0.0",
      },
    },
    components,
  }
  return bom
}

// Structural validation of the fields CycloneDX consumers rely on.
// Returns a list of problems; empty means valid.
function validateBom(bom) {
  const problems = []
  if (bom.bomFormat !== "CycloneDX") problems.push('bomFormat must be "CycloneDX"')
  if (!/^\d+\.\d+$/.test(String(bom.specVersion || ""))) {
    problems.push("specVersion must be a major.minor string")
  }
  if (!Array.isArray(bom.components)) {
    problems.push("components must be an array")
  } else {
    bom.components.forEach((c, i) => {
      if (!c.name) problems.push(`components[${i}] missing name`)
      if (!c.version) problems.push(`components[${i}] missing version`)
      if (!c.purl || !c.purl.startsWith("pkg:npm/")) {
        problems.push(`components[${i}] missing/invalid purl`)
      }
      if (c.type !== "library") problems.push(`components[${i}] type must be "library"`)
    })
  }
  if (!bom.metadata?.component?.name) problems.push("metadata.component.name missing")
  return problems
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`error: ${err.message}\n\n${usage()}`)
    process.exit(1)
  }
  if (args.help) {
    console.log(usage())
    return
  }

  let inputs
  try {
    inputs = loadInputs(args.demo)
  } catch (err) {
    console.error(`error: failed to load inputs: ${err.message}`)
    process.exit(1)
  }

  const bom = buildBom(inputs.pkg, inputs.lock)
  const json = `${JSON.stringify(bom, null, 2)}\n`

  if (args.validate) {
    const problems = validateBom(bom)
    if (problems.length > 0) {
      console.error("SBOM validation failed:")
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(2)
    }
    console.error(`validated: ${bom.components.length} components, specVersion ${bom.specVersion}`)
  }

  if (args.output) {
    const outPath = resolve(args.output)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, json, "utf8")
    console.error(
      `wrote ${bom.components.length} components to ${outPath}` +
        (args.demo ? " (demo fixture)" : ""),
    )
  } else {
    process.stdout.write(json)
  }
}

main()
