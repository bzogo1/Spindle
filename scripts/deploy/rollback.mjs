#!/usr/bin/env node
// Deployment rollback helper for the compose stacks described in
// docs/runbooks/hosting.md (app + worker on one origin host, images pinned by
// tag, Cloudflare Tunnel as the only ingress).
//
// Releases are recorded on the host under <DEPLOY_DIR>/releases/ as flat env
// files that pin SPINDLE_APP_IMAGE / SPINDLE_WORKER_IMAGE, plus a `current`
// symlink. Rolling back re-runs `docker compose up` with the target release
// env file merged over host.env, then verifies the app health endpoint.
//
// The script never edits host.env and never touches the database; image tags
// are the only thing a release changes.
//
// Configuration (environment):
//   DEPLOY_HOST           user@host for the target origin (required unless
//                         --dry-run). SSH config / DEPLOY_SSH_OPTS apply.
//   DEPLOY_DIR            stack directory on the host (default /srv/spindle,
//                         /srv/spindle-staging for staging).
//   DEPLOY_HEALTH_URL     in-cluster health URL curled on the host after a
//                         rollback (default http://127.0.0.1:8080/).
//   DEPLOY_PUBLIC_URL     optional public URL (e.g. https://app.spindle.app)
//                         checked from this machine after the host check.
//   DEPLOY_KEEP_RELEASES  release files to retain on the host (default 5).
//
// Usage:
//   node scripts/deploy/rollback.mjs --list
//   node scripts/deploy/rollback.mjs --record
//   node scripts/deploy/rollback.mjs [--to <release>] [--keep N]
//   node scripts/deploy/rollback.mjs --dry-run

import { execFileSync } from "node:child_process"
import { env } from "node:process"

const USAGE = `Usage: node scripts/deploy/rollback.mjs [options]

Options:
  --list           List recorded releases and the current one.
  --record         Snapshot the images of the running app/worker containers
                   as a new release (run after each deploy).
  --to <release>   Roll back to a specific release id (default: the release
                   before the current one).
  --keep <N>       Release files to keep on the host (default: env or 5).
  --dry-run        Print the plan and the remote commands without executing.
  -h, --help       Show this help.

Environment:
  DEPLOY_HOST           user@host of the origin (required unless --dry-run)
  DEPLOY_DIR            stack dir on the host (default /srv/spindle)
  DEPLOY_HEALTH_URL     health URL checked on the host (default http://127.0.0.1:8080/)
  DEPLOY_PUBLIC_URL     optional public URL checked locally after rollback
  DEPLOY_KEEP_RELEASES  releases to retain (default 5)
  DEPLOY_SSH_OPTS       extra ssh options, e.g. "-i ~/.ssh/deploy_key"`

const argv = process.argv.slice(2)

function parseArgs(args) {
  const flags = { list: false, record: false, dryRun: false, help: false, to: "", keep: 0 }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--list") flags.list = true
    else if (arg === "--record") flags.record = true
    else if (arg === "--dry-run") flags.dryRun = true
    else if (arg === "--help" || arg === "-h") flags.help = true
    else if (arg === "--to") {
      flags.to = args[i + 1] ?? ""
      i += 1
      if (!flags.to) fail("--to requires a release id")
    } else if (arg === "--keep") {
      flags.keep = Number(args[i + 1])
      i += 1
      if (!Number.isInteger(flags.keep) || flags.keep < 1)
        fail("--keep requires a positive integer")
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

const config = {
  host: env.DEPLOY_HOST ?? "",
  dir: env.DEPLOY_DIR ?? "/srv/spindle",
  healthUrl: env.DEPLOY_HEALTH_URL ?? "http://127.0.0.1:8080/",
  publicUrl: env.DEPLOY_PUBLIC_URL ?? "",
  keep: flags.keep || Number(env.DEPLOY_KEEP_RELEASES ?? 5),
  sshOpts: (env.DEPLOY_SSH_OPTS ?? "").split(/\s+/).filter(Boolean),
}

if (!Number.isInteger(config.keep) || config.keep < 1) {
  fail("DEPLOY_KEEP_RELEASES must be a positive integer")
}

if (!flags.dryRun && !config.host) {
  fail("DEPLOY_HOST is not set (e.g. DEPLOY_HOST=deploy@app.spindle.app); use --dry-run to preview")
}
if (flags.list && flags.record) fail("--list and --record cannot be combined")
if (flags.record && flags.to) fail("--record cannot be combined with --to")

// ---------------------------------------------------------------------------
// Remote execution helpers. Everything remote runs as `ssh <host> bash -s`
// with the script on stdin, so no quoting of the remote script itself is
// needed; only the interpolated values below are shell-quoted.
// ---------------------------------------------------------------------------

function sh(command, commandArgs, options = {}) {
  const rendered = [command, ...commandArgs].join(" ")
  if (flags.dryRun) {
    console.log(`[dry-run] ${rendered}`)
    return ""
  }
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
  }).trim()
}

function sshArgs() {
  // In dry-run mode DEPLOY_HOST may be unset; the placeholder only ever gets
  // printed because non-dry-run paths fail earlier without a host.
  return ["-o", "BatchMode=yes", ...config.sshOpts, config.host || "<DEPLOY_HOST>"]
}

// Run a bash script on the host. `args` are passed after `--`. In dry-run
// mode only the command line is printed, not the script body.
function remote(script, args = [], label = "") {
  const rendered = `ssh ${sshArgs().join(" ")} bash -s -- ${args.join(" ")}`
  if (flags.dryRun) {
    console.log(`[dry-run] ${rendered}${label ? `  # ${label}` : ""}`)
    return ""
  }
  return execFileSync("ssh", [...sshArgs(), "bash", "-s", "--", ...args], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  }).trim()
}

function sq(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function checkUrl(url, label) {
  if (flags.dryRun) {
    console.log(
      `[dry-run] curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors ${sq(url)}`,
    )
    return
  }
  sh("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--retry",
    "12",
    "--retry-delay",
    "5",
    "--retry-all-errors",
    url,
  ])
  console.log(`${label}: OK (${url})`)
}

// ---------------------------------------------------------------------------
// Release store on the host: <dir>/releases/<id>.env + releases/current link.
// ---------------------------------------------------------------------------

const RELEASE_SCRIPT = String.raw`
set -euo pipefail
cd "$1"
releases="releases"
mkdir -p "$releases"

list_releases() {
  ls -1 "$releases"/*.env 2>/dev/null | xargs -r -n1 basename | sed 's/\.env$//' | sort
}

current_release() {
  local link="$releases/current"
  if [ -L "$link" ]; then basename "$(readlink "$link")" .env; fi
}

# Prints "service=image" lines for the running compose services, using the
# compose project/service labels so it works regardless of container index.
detect_images() {
  local stack="spindle"
  if [ -f host.env ]; then
    stack=$(sed -n 's/^SPINDLE_STACK_NAME=//p' host.env | head -n1)
    if [ -z "$stack" ]; then stack=spindle; fi
  fi
  local svc img
  for svc in app worker; do
    img=$(docker ps --filter "label=com.docker.compose.project=$stack" \
      --filter "label=com.docker.compose.service=$svc" \
      --format '{{.Image}}' | head -n1)
    printf '%s=%s\n' "$svc" "$img"
  done
}

case "$2" in
  list)
    cur=$(current_release)
    if [ -z "$cur" ]; then cur="<none>"; fi
    echo "current=$cur"
    for rel in $(list_releases); do
      echo "release=$rel"
    done
    ;;
  record)
    rel="$3"
    app_img=""
    worker_img=""
    while IFS='=' read -r svc img; do
      case "$svc" in
        app) app_img="$img" ;;
        worker) worker_img="$img" ;;
      esac
    done < <(detect_images)
    if [ -z "$app_img" ] || [ -z "$worker_img" ]; then
      echo "error: could not detect running app/worker images on the host" >&2
      exit 1
    fi
    tmp="$releases/.$rel.tmp"
    {
      printf 'SPINDLE_APP_IMAGE=%s\n' "$app_img"
      printf 'SPINDLE_WORKER_IMAGE=%s\n' "$worker_img"
      printf 'SPINDLE_RELEASE_ID=%s\n' "$rel"
      printf 'SPINDLE_RELEASE_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$tmp"
    mv "$tmp" "$releases/$rel.env"
    ln -sfn "$rel.env" "$releases/current"
    # Retain the newest $4 releases; never delete the current symlink target.
    cur=$(current_release)
    ls -1t "$releases"/*.env | tail -n "+$(( $4 + 1 ))" | while read -r old; do
      [ "$(basename "$old")" = "$cur.env" ] || rm -f "$old"
    done
    echo "recorded=$rel"
    echo "app=$app_img"
    echo "worker=$worker_img"
    ;;
esac
`

function listReleases() {
  if (flags.dryRun) {
    remote(RELEASE_SCRIPT, [config.dir, "list"], "list releases")
    return null
  }
  const out = remote(RELEASE_SCRIPT, [config.dir, "list"], "list releases")
  const lines = out.split("\n").filter(Boolean)
  const current = (lines.find((l) => l.startsWith("current=")) ?? "").slice("current=".length)
  const releases = lines
    .filter((l) => l.startsWith("release="))
    .map((l) => l.slice("release=".length))
    .sort()
  return { current: current === "<none>" ? "" : current, releases }
}

function recordRelease() {
  const rel = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\..+/, "Z")
  console.log(`==> Recording current deployment as release ${rel}`)
  const out = remote(
    RELEASE_SCRIPT,
    [config.dir, "record", rel, String(config.keep)],
    `record release ${rel} (keep ${config.keep})`,
  )
  if (!flags.dryRun) console.log(out)
  console.log(`Release ${rel} is now current; keeping up to ${config.keep} releases.`)
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

const ROLLBACK_SCRIPT = String.raw`
set -euo pipefail
cd "$1"
target="$2"        # release id, e.g. 20250102T030405Z
health="$3"        # health URL checked on the host

if [ ! -f "releases/$target.env" ]; then
  echo "error: release $target not found under releases/" >&2
  exit 1
fi

# Merge host.env with the release env so only image tags change. host.env
# stays untouched; the merged file is removed on exit. Guard against a
# missing trailing newline in host.env so the release file's first line
# cannot merge into the previous one.
merged=$(mktemp)
trap 'rm -f "$merged"' EXIT
{
  cat host.env
  [ -n "$(tail -c1 host.env)" ] && echo
  cat "releases/$target.env"
} > "$merged"

docker compose --env-file "$merged" config --quiet
docker compose --env-file "$merged" up -d --remove-orphans --wait
ln -sfn "$target.env" releases/current

# Wait for the app health endpoint through the loopback port; --wait above
# covers container health, this covers the HTTP surface.
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors "$health" > /dev/null
echo "rollback_target=$target"
`

const RESTORE_SCRIPT = String.raw`
set -euo pipefail
cd "$1"
target="$2"
merged=$(mktemp)
trap 'rm -f "$merged"' EXIT
{
  cat host.env
  [ -n "$(tail -c1 host.env)" ] && echo
  cat "releases/$target.env"
} > "$merged"
docker compose --env-file "$merged" up -d --remove-orphans --wait
ln -sfn "$target.env" releases/current
echo "restored=$target"
`

function resolveTarget(state) {
  if (flags.to) {
    const id = flags.to.replace(/\.env$/, "")
    if (state && !state.releases.includes(id)) {
      fail(`release '${id}' is not recorded on the host (see --list)`)
    }
    return id
  }
  if (!state) {
    // Dry run without host access: the previous-release pick needs the remote
    // release list, so defer it to the printed plan.
    return "<previous-release>"
  }
  if (!state.current) {
    fail("no current release recorded; run --record after a deploy or pass --to")
  }
  const idx = state.releases.indexOf(state.current)
  if (idx <= 0) {
    fail(`release '${state.current}' has no earlier release to roll back to`)
  }
  return state.releases[idx - 1]
}

function restoreOnFailure(target, previous) {
  if (flags.dryRun || !previous || previous === target) return
  console.error(`!! Health check failed after rollback to ${target}; restoring ${previous}`)
  try {
    const out = remote(
      RESTORE_SCRIPT,
      [config.dir, previous],
      `restore previous release ${previous}`,
    )
    console.log(out)
    console.log(`Restored previous release ${previous}. Investigate before retrying.`)
  } catch (error) {
    console.error(`!! Automatic restore to ${previous} also failed:`)
    console.error(String(error.stderr ?? error.message ?? error))
    console.error("Manual intervention required on the host.")
  }
}

// ---------------------------------------------------------------------------

try {
  if (flags.list) {
    if (flags.dryRun) {
      listReleases()
    } else {
      const state = listReleases()
      if (state.current) console.log(`current:  ${state.current}`)
      else console.log("current:  <none>")
      for (const rel of state.releases) {
        console.log(`release: ${rel}${rel === state.current ? "  (current)" : ""}`)
      }
      if (state.releases.length === 0) {
        console.log("No releases recorded yet; run --record after the next deploy.")
      }
    }
  } else if (flags.record) {
    recordRelease()
  } else {
    // Wrap the rollback so a failed health check can trigger a restore.
    const state = listReleases()
    const target = resolveTarget(state)
    const previous = state?.current ?? ""
    console.log("==> Rollback plan")
    console.log(`    host:        ${config.host || "<DEPLOY_HOST>"}`)
    console.log(`    dir:         ${config.dir}`)
    console.log(`    target:      ${target}`)
    console.log(`    from:        ${previous || "<unrecorded/unknown>"}`)
    console.log(`    health:      ${config.healthUrl} (checked on the host)`)
    if (config.publicUrl) console.log(`    public:      ${config.publicUrl} (checked locally)`)
    try {
      const out = remote(
        ROLLBACK_SCRIPT,
        [config.dir, target, config.healthUrl],
        `rollback to release ${target}`,
      )
      if (!flags.dryRun) console.log(out)
      if (config.publicUrl) checkUrl(config.publicUrl, "Public health check")
      if (!flags.dryRun) console.log(`Rollback to ${target} complete.`)
    } catch (error) {
      if (!flags.dryRun) {
        console.error(String(error.stderr ?? error.message ?? error))
        restoreOnFailure(target, previous)
      }
      throw error
    }
  }
} catch (error) {
  if (error && typeof error === "object" && "status" in error) {
    process.exitCode = error.status ?? 1
  } else {
    console.error(error)
    process.exitCode = 1
  }
}
