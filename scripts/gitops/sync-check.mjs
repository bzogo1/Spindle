#!/usr/bin/env node
// GitOps sync check: verifies that what is deployed on the origin host
// matches a git revision. This is the lightweight, pull-model equivalent of
// the drift detection an ArgoCD/Flux controller would provide — see
// docs/workflow/gitops.md for the full assessment.
//
// The deploy pipeline tags images with the pushed commit SHA
// (github.sha in .github/workflows/deploy-staging.yml), so "deployed == git"
// reduces to comparing the image tags recorded on the host against
// `git rev-parse <ref>`. The host-side source of truth is the release store
// maintained by scripts/deploy/rollback.mjs: <DEPLOY_DIR>/releases/current
// points at a *.env file pinning SPINDLE_APP_IMAGE / SPINDLE_WORKER_IMAGE,
// and the running container images are read from compose labels as a
// second, independent signal.
//
// Modes:
//   (default)   SSH to the host, read the release store and running images,
//               resolve the git ref locally, and compare.
//   --dry-run   Print the ssh/git commands that would run; executes nothing.
//   --demo      Fully offline demo: no git, no ssh, no network. Uses a
//               synthetic release store built from --sha (or a fixed demo
//               SHA) so the comparison logic can be exercised anywhere.
//
// Configuration (environment):
//   DEPLOY_HOST      user@host of the origin (required unless --dry-run/--demo).
//                    SSH config / DEPLOY_SSH_OPTS apply, same as rollback.mjs.
//   DEPLOY_DIR       stack directory on the host (default /srv/spindle-staging;
//                    use /srv/spindle for production).
//   DEPLOY_SSH_OPTS  extra ssh options, e.g. "-i ~/.ssh/deploy_key".
//
// Usage:
//   node scripts/gitops/sync-check.mjs                 # check origin/main vs host
//   node scripts/gitops/sync-check.mjs --ref HEAD      # check a local ref
//   node scripts/gitops/sync-check.mjs --dry-run       # show the plan only
//   node scripts/gitops/sync-check.mjs --demo          # offline self-test
//   node scripts/gitops/sync-check.mjs --demo --sha deadbeef...  # force a mismatch
//
// Exit codes: 0 = deployed revision matches the git ref, 1 = drift or
// missing release data, 2 = usage/configuration error.

import { execFileSync } from "node:child_process"
import { env } from "node:process"

const USAGE = `Usage: node scripts/gitops/sync-check.mjs [options]

Options:
  --ref <git-ref>   Git ref to compare against (default: origin/main; falls
                    back to HEAD when origin/main is unavailable).
  --sha <sha>       Skip git entirely and use this value as the expected
                    revision (mainly for --demo/--dry-run).
  --dry-run         Print the remote and git commands without executing.
  --demo            Offline demo with a synthetic release store; no git,
                    no ssh, no network access.
  -h, --help        Show this help.

Environment:
  DEPLOY_HOST       user@host of the origin (required unless --dry-run/--demo)
  DEPLOY_DIR        stack dir on the host (default /srv/spindle-staging)
  DEPLOY_SSH_OPTS   extra ssh options

Exit codes: 0 in sync, 1 drift/missing data, 2 usage error.`

const argv = process.argv.slice(2)

function parseArgs(args) {
  const flags = { demo: false, dryRun: false, help: false, ref: "", sha: "" }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--demo") flags.demo = true
    else if (arg === "--dry-run") flags.dryRun = true
    else if (arg === "--help" || arg === "-h") flags.help = true
    else if (arg === "--ref") {
      flags.ref = args[i + 1] ?? ""
      i += 1
      if (!flags.ref) fail("--ref requires a git ref")
    } else if (arg === "--sha") {
      flags.sha = args[i + 1] ?? ""
      i += 1
      if (!flags.sha) fail("--sha requires a revision")
    } else {
      fail(`Unknown argument: ${arg}`)
    }
  }
  return flags
}

function fail(message) {
  console.error(`error: ${message}`)
  console.error(USAGE)
  process.exit(2)
}

const flags = parseArgs(argv)
if (flags.help) {
  console.log(USAGE)
  process.exit(0)
}
if (flags.demo && flags.dryRun) fail("--demo and --dry-run cannot be combined")

const config = {
  host: env.DEPLOY_HOST ?? "",
  dir: env.DEPLOY_DIR ?? "/srv/spindle-staging",
  sshOpts: (env.DEPLOY_SSH_OPTS ?? "").split(/\s+/).filter(Boolean),
}

if (!flags.demo && !flags.dryRun && !config.host) {
  fail(
    "DEPLOY_HOST is not set (e.g. DEPLOY_HOST=deploy@staging.spindle.app); use --dry-run or --demo to preview",
  )
}

// ---------------------------------------------------------------------------
// Expected revision: the git ref the deploy pipeline would have used.
// ---------------------------------------------------------------------------

// In demo mode a fixed synthetic SHA keeps the output deterministic; --sha
// overrides it so a mismatch can be demonstrated.
const DEMO_SHA = "0123456789abcdef0123456789abcdef01234567"

function resolveExpectedRevision() {
  if (flags.sha) return { revision: flags.sha, source: "--sha" }
  if (flags.demo) return { revision: DEMO_SHA, source: "demo fixture" }
  if (flags.dryRun) return { revision: "<git-rev-parse>", source: "dry-run" }

  // Prefer origin/main because deploy-staging.yml runs on pushes to main;
  // fall back to HEAD so the check still works in a detached/local checkout.
  const candidates = flags.ref ? [flags.ref] : ["origin/main", "HEAD"]
  for (const ref of candidates) {
    try {
      const sha = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
        encoding: "utf8",
      }).trim()
      return { revision: sha, source: ref }
    } catch {
      // try the next candidate
    }
  }
  fail(
    `could not resolve any of: ${candidates.join(", ")} — run \`git fetch origin\` or pass --ref`,
  )
}

// ---------------------------------------------------------------------------
// Host state: release store + running container images.
// ---------------------------------------------------------------------------

// Runs on the host. Prints key=value lines:
//   current=<release-id or empty>
//   declared_app_image=... / declared_worker_image=...   (from releases/current)
//   running_app_image=... / running_worker_image=...     (from docker ps labels)
const STATE_SCRIPT = String.raw`
set -euo pipefail
cd "$1"

cur_link="releases/current"
cur=""
if [ -L "$cur_link" ]; then
  cur=$(basename "$(readlink "$cur_link")" .env)
fi
echo "current=$cur"

if [ -n "$cur" ] && [ -f "releases/$cur.env" ]; then
  grep -E '^SPINDLE_(APP|WORKER)_IMAGE=' "releases/$cur.env" | \
    sed -e 's/^SPINDLE_APP_IMAGE=/declared_app_image=/' \
        -e 's/^SPINDLE_WORKER_IMAGE=/declared_worker_image=/' || true
else
  echo "release_missing=1"
fi

# Running images, keyed by compose project/service labels so this works
# regardless of container index (same approach as rollback.mjs).
stack="spindle"
if [ -f host.env ]; then
  stack=$(sed -n 's/^SPINDLE_STACK_NAME=//p' host.env | head -n1)
  [ -z "$stack" ] && stack=spindle
fi
for svc in app worker; do
  img=$(docker ps --filter "label=com.docker.compose.project=$stack" \
    --filter "label=com.docker.compose.service=$svc" \
    --format '{{.Image}}' | head -n1)
  printf 'running_%s_image=%s\n' "$svc" "$img"
done
`

function demoState() {
  // Synthetic release store: the declared release and the running containers
  // agree, tagged with the fixed demo SHA. Passing --sha with a different
  // value demonstrates what a DRIFT report looks like.
  const tag = DEMO_SHA
  return [
    "current=demo-release",
    `declared_app_image=ghcr.io/spindle/app:${tag}`,
    `declared_worker_image=ghcr.io/spindle/worker:${tag}`,
    `running_app_image=ghcr.io/spindle/app:${tag}`,
    `running_worker_image=ghcr.io/spindle/worker:${tag}`,
  ].join("\n")
}

function sshArgs() {
  return ["-o", "BatchMode=yes", ...config.sshOpts, config.host || "<DEPLOY_HOST>"]
}

function fetchHostState() {
  const rendered = `ssh ${sshArgs().join(" ")} bash -s -- ${config.dir}`
  if (flags.dryRun) {
    console.log(`[dry-run] ${rendered}   # read release store + running images`)
    return null
  }
  if (flags.demo) return demoState()
  return execFileSync("ssh", [...sshArgs(), "bash", "-s", "--", config.dir], {
    input: STATE_SCRIPT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  }).trim()
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

// Image references look like registry/repo:tag; the tag is what carries the
// commit SHA. A digest pin (repo@sha256:...) has no git meaning here and is
// reported as unverifiable rather than silently passing.
function tagOf(imageRef) {
  if (!imageRef) return ""
  const withoutDigest = imageRef.split("@")[0]
  const idx = withoutDigest.lastIndexOf(":")
  if (idx === -1 || idx < withoutDigest.lastIndexOf("/")) return ""
  return withoutDigest.slice(idx + 1)
}

function revisionsMatch(tag, revision) {
  if (!tag || !revision) return false
  if (tag === revision) return true
  // Tolerate short SHAs on either side (image tags are usually full SHAs,
  // but a hand-pinned tag may be abbreviated).
  const a = tag.toLowerCase()
  const b = revision.toLowerCase()
  return (a.length >= 7 && b.startsWith(a)) || (b.length >= 7 && a.startsWith(b))
}

function parseState(out) {
  const state = { current: "", releaseMissing: false, images: {} }
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq)
    const value = line.slice(eq + 1)
    if (key === "current") state.current = value
    else if (key === "release_missing") state.releaseMissing = true
    else if (key.endsWith("_image")) state.images[key] = value
  }
  return state
}

// ---------------------------------------------------------------------------

const expected = resolveExpectedRevision()

if (flags.dryRun) {
  const shown = flags.sha || flags.ref || "origin/main (fallback HEAD)"
  console.log(`[dry-run] git rev-parse --verify ${shown}^{commit}`)
}

console.log(`==> GitOps sync check`)
console.log(`    host:       ${config.host || "<DEPLOY_HOST>"}`)
console.log(`    dir:        ${config.dir}`)
console.log(`    git ref:    ${flags.ref || "origin/main (fallback HEAD)"}`)
console.log(`    expected:   ${expected.revision}  (${expected.source})`)
console.log(`    mode:       ${flags.demo ? "demo (offline)" : flags.dryRun ? "dry-run" : "live"}`)

const raw = fetchHostState()
if (raw === null) {
  console.log("\n[dry-run] No host state fetched; comparison skipped.")
  process.exit(0)
}

const state = parseState(raw)
console.log(
  `    release:    ${state.current || "<none>"}${state.releaseMissing ? "  (env file missing!)" : ""}`,
)

let drift = false
const rows = [
  ["declared app", state.images.declared_app_image],
  ["declared worker", state.images.declared_worker_image],
  ["running app", state.images.running_app_image],
  ["running worker", state.images.running_worker_image],
]

console.log("")
for (const [label, image] of rows) {
  if (!image) {
    console.log(`  ?   ${label.padEnd(16)} <not found>`)
    if (label.startsWith("declared")) drift = true
    continue
  }
  const tag = tagOf(image)
  if (!tag) {
    console.log(`  ?   ${label.padEnd(16)} ${image}  (no tag to compare)`)
    continue
  }
  const ok = revisionsMatch(tag, expected.revision)
  if (!ok) drift = true
  console.log(`  ${ok ? "ok " : "DRIFT"} ${label.padEnd(16)} ${image}`)
}

// The declared release is what rollback.mjs would restore; the running
// containers are what is actually serving. Both must agree with git.
const declaredOk =
  revisionsMatch(tagOf(state.images.declared_app_image), expected.revision) &&
  revisionsMatch(tagOf(state.images.declared_worker_image), expected.revision)
const runningOk =
  revisionsMatch(tagOf(state.images.running_app_image), expected.revision) &&
  revisionsMatch(tagOf(state.images.running_worker_image), expected.revision)

console.log("")
if (drift) {
  console.log("Result: DRIFT — deployed images do not match the git revision.")
  console.log("  Re-deploy the ref (docs/deploy/staging.md) or record a release")
  console.log("  with scripts/deploy/rollback.mjs --record to re-sync the store.")
  process.exit(1)
}
if (!declaredOk || !runningOk) {
  console.log("Result: INCOMPLETE — some image references were missing or untagged.")
  process.exit(1)
}
console.log("Result: IN SYNC — deployed revision matches the git ref.")
process.exit(0)
