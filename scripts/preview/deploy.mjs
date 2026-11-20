#!/usr/bin/env node
/**
 * Preview deployment helper for pull requests.
 *
 * Infrastructure-agnostic on purpose: it assumes only Node.js, npm, and a
 * checkout of this repository on the machine it runs on. `.github/workflows/
 * preview.yml` ships the repo to a preview host over SSH and invokes this
 * script there; the same commands work on any Linux box for local testing.
 *
 * Commands:
 *   deploy    Install deps (cached), build, and serve the app on a port that
 *             is unique per PR. Writes state + URL files for `status`/`gc`.
 *   teardown  Stop the server for a PR and remove its state. Optionally
 *             removes the app directory.
 *   status    List every preview currently registered in the state dir.
 *   gc        Tear down previews older than --max-age-hours (safety net for
 *             PRs closed without the teardown job running).
 *
 * Examples:
 *   node scripts/preview/deploy.mjs deploy --pr 123 --state-dir /srv/preview/state
 *   node scripts/preview/deploy.mjs teardown --pr 123 --state-dir /srv/preview/state \
 *     --app-dir /srv/preview/apps/pr-123
 *
 * Environment (all optional; flags win over env, env-file wins over both for
 * the build/serve child processes):
 *   PREVIEW_PORT_BASE       first port of the allocation range (default 3100)
 *   PREVIEW_PORT_RANGE      size of the allocation range (default 900)
 *   PREVIEW_BIND_HOST       address `next start` binds (default 0.0.0.0)
 *   PREVIEW_PUBLIC_HOST     hostname/IP used to build the public URL
 *   PREVIEW_SITE_URL_TEMPLATE  URL template; placeholders {pr} {port} {host}
 *                           {publicHost} (default http://{host}:{port})
 *   NEXT_PUBLIC_MOCK_AUTH   "1" builds the mock-authenticated app shell
 *   --env-file              KEY=VALUE file layered into the build/serve env
 *
 * State lives outside the app directory (`--state-dir`, default
 * `<repo>/../../state`) so `teardown`/`gc` keep working even when the app
 * directory is gone.
 */

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
// `env` is imported from node:process (instead of touching `process.env`)
// because the repo eslint config reserves `process.env` for src/lib/env.ts;
// this script is deployment tooling that runs outside the app.
import { env } from "node:process"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..", "..")

const USAGE = `Usage: node scripts/preview/deploy.mjs <command> [options]

Commands:
  deploy     Build and serve a preview for a PR
  teardown   Stop and remove a PR's preview
  status     List registered previews
  gc         Tear down previews older than --max-age-hours

Options:
  --pr <number>          Pull request number (required for deploy/teardown)
  --app-dir <path>       App checkout dir (default: repository root)
  --state-dir <path>     Preview state dir (default: <app-dir>/../../state)
  --env-file <path>      KEY=VALUE env file for build/serve
  --port-base <n>        First port of the allocation range
  --port-range <n>       Size of the allocation range
  --bind-host <host>     Address next start binds (default 0.0.0.0)
  --max-age-hours <n>    gc cutoff age in hours (default 72)
  --skip-build           Serve the existing .next output without rebuilding
  --keep-app-dir         teardown: keep the app directory
  --dry-run              Validate and print the plan without changing anything
  -h, --help             Show this help
`

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, keepAppDir: false, skipBuild: false }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const next = () => {
      i += 1
      if (i >= rest.length) throw new Error(`Missing value for ${arg}`)
      return rest[i]
    }
    switch (arg) {
      case "--pr":
        options.pr = Number(next())
        break
      case "--app-dir":
        options.appDir = path.resolve(next())
        break
      case "--state-dir":
        options.stateDir = path.resolve(next())
        break
      case "--env-file":
        options.envFile = path.resolve(next())
        break
      case "--port-base":
        options.portBase = Number(next())
        break
      case "--port-range":
        options.portRange = Number(next())
        break
      case "--bind-host":
        options.bindHost = next()
        break
      case "--max-age-hours":
        options.maxAgeHours = Number(next())
        break
      case "--skip-build":
        options.skipBuild = true
        break
      case "--keep-app-dir":
        options.keepAppDir = true
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "-h":
      case "--help":
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function fail(message) {
  console.error(`preview: ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`preview: ${message}`)
}

/** FNV-1a — small stable hash, no dependencies. */
function fnv1a(value) {
  let hash = 0x811c9dc5
  for (const char of value) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Parses a KEY=VALUE env file. Blank lines and # comments are ignored. */
async function readEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {}
  const content = await readFile(filePath, "utf8")
  const values = {}
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line
    const eq = stripped.indexOf("=")
    if (eq <= 0) continue
    const key = stripped.slice(0, eq).trim()
    let value = stripped.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function statePath(stateDir, pr) {
  return path.join(stateDir, `pr-${pr}.json`)
}

async function readState(stateDir, pr) {
  const file = statePath(stateDir, pr)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return null
  }
}

async function writeState(stateDir, state) {
  await mkdir(stateDir, { recursive: true })
  const file = statePath(stateDir, state.pr)
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmp, file)
  await writeFile(path.join(stateDir, `pr-${state.pr}.url`), `${state.url}\n`)
}

async function removeState(stateDir, pr) {
  await rm(statePath(stateDir, pr), { force: true })
  await rm(path.join(stateDir, `pr-${pr}.url`), { force: true })
  await rm(path.join(stateDir, `pr-${pr}.log`), { force: true })
}

async function listStates(stateDir) {
  if (!existsSync(stateDir)) return []
  const files = await readdir(stateDir)
  const states = []
  for (const file of files) {
    if (!/^pr-\d+\.json$/.test(file)) continue
    try {
      states.push(JSON.parse(await readFile(path.join(stateDir, file), "utf8")))
    } catch {
      // Corrupt state file — skip it; gc can still remove the file by age.
    }
  }
  return states
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/**
 * Picks a port deterministically biased by the PR number, then walks the
 * range until it finds one that no other preview state claims and the bind
 * host can actually listen on.
 */
async function allocatePort({ pr, portBase, portRange, bindHost, stateDir }) {
  const states = await listStates(stateDir)
  const claimed = new Set(states.filter((s) => s.pr !== pr).map((s) => s.port))
  const start = fnv1a(`pr-${pr}`) % portRange
  for (let i = 0; i < portRange; i += 1) {
    const port = portBase + ((start + i) % portRange)
    if (claimed.has(port)) continue
    if (await canListen(port, bindHost)) return port
  }
  throw new Error(`No free preview port in ${portBase}-${portBase + portRange - 1}`)
}

/** Renders PREVIEW_SITE_URL_TEMPLATE with {pr} {port} {host} {publicHost}. */
function renderSiteUrl(template, { pr, port, host, publicHost }) {
  return template
    .replaceAll("{pr}", String(pr))
    .replaceAll("{port}", String(port))
    .replaceAll("{publicHost}", publicHost)
    .replaceAll("{host}", host)
}

async function run(command, args, { cwd, env: childEnv, capture = false } = {}) {
  log(`$ ${command} ${args.join(" ")}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    })
    let stdout = ""
    let stderr = ""
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk
      })
    }
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${stderr}`))
    })
  })
}

async function sha256File(filePath) {
  const content = await readFile(filePath)
  return createHash("sha256").update(content).digest("hex")
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** SIGTERM the process group (next start is spawned detached), then SIGKILL. */
async function stopServer(pid, { graceMs = 10_000 } = {}) {
  if (!pid || !pidAlive(pid)) return
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      return
    }
  }
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }
}

async function waitForServer(url, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = "no response yet"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" })
      // Any HTTP response means next start is up; status codes are the app's
      // business, not the server's.
      await response.arrayBuffer()
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  throw new Error(`Server did not respond at ${url} within ${timeoutMs}ms (${lastError})`)
}

async function deploy(options) {
  const pr = options.pr
  if (!Number.isInteger(pr) || pr <= 0) fail("deploy requires --pr <number>")

  const appDir = options.appDir ?? repoRoot
  const stateDir = options.stateDir ?? path.resolve(appDir, "..", "..", "state")
  const portBase = options.portBase ?? Number(env.PREVIEW_PORT_BASE ?? 3100)
  const portRange = options.portRange ?? Number(env.PREVIEW_PORT_RANGE ?? 900)
  const bindHost = options.bindHost ?? env.PREVIEW_BIND_HOST ?? "0.0.0.0"
  const fileEnv = await readEnvFile(options.envFile)

  // A previous deploy for this PR (e.g. left behind by a cancelled run) must
  // not keep holding its port.
  const previous = await readState(stateDir, pr)
  if (previous?.pid && !options.dryRun) {
    log(`stopping previous preview pid ${previous.pid}`)
    await stopServer(previous.pid)
  }

  const port = await allocatePort({ pr, portBase, portRange, bindHost, stateDir })
  const publicHost = fileEnv.PREVIEW_PUBLIC_HOST ?? env.PREVIEW_PUBLIC_HOST ?? bindHost
  const siteUrlTemplate =
    fileEnv.PREVIEW_SITE_URL_TEMPLATE ?? env.PREVIEW_SITE_URL_TEMPLATE ?? "http://{host}:{port}"
  const url = renderSiteUrl(siteUrlTemplate, {
    pr,
    port,
    host: publicHost,
    publicHost,
  })
  const localUrl = `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}`

  log(`PR #${pr}: port ${port}, url ${url}`)

  if (options.dryRun) {
    log(
      `dry-run: would install deps in ${appDir}, ` +
        `${options.skipBuild ? "reuse .next" : "run npm run build"}, ` +
        `spawn next start -p ${port} -H ${bindHost}, and write state to ${stateDir}`,
    )
    return
  }

  // ---- dependencies -------------------------------------------------------
  const lockPath = path.join(appDir, "package-lock.json")
  const lockHash = existsSync(lockPath) ? await sha256File(lockPath) : null
  const modulesDir = path.join(appDir, "node_modules")
  const childBaseEnv = { ...env, ...fileEnv, CI: "1", NEXT_TELEMETRY_DISABLED: "1" }

  if (existsSync(modulesDir)) {
    if (previous?.lockHash && previous.lockHash === lockHash) {
      log("node_modules up to date with package-lock.json — skipping install")
    } else {
      await run("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: appDir,
        env: childBaseEnv,
      })
    }
  } else {
    await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: appDir, env: childBaseEnv })
  }

  // ---- build ---------------------------------------------------------------
  const buildEnv = {
    ...childBaseEnv,
    NEXT_PUBLIC_SITE_URL: fileEnv.NEXT_PUBLIC_SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? url,
  }
  if (!options.skipBuild) {
    await run("npm", ["run", "build"], { cwd: appDir, env: buildEnv })
  } else {
    log("--skip-build: reusing existing .next output")
    if (!existsSync(path.join(appDir, ".next"))) {
      fail("--skip-build given but .next does not exist")
    }
  }

  // ---- serve ----------------------------------------------------------------
  const nextBin = path.join(appDir, "node_modules", "next", "dist", "bin", "next")
  if (!existsSync(nextBin)) fail(`next binary not found at ${nextBin} — did npm install run?`)

  await mkdir(stateDir, { recursive: true })
  const logPath = path.join(stateDir, `pr-${pr}.log`)
  const logFd = await open(logPath, "a")
  const serveEnv = { ...buildEnv }
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", bindHost], {
    cwd: appDir,
    env: serveEnv,
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
  })
  child.unref()
  await logFd.close()
  if (!child.pid) fail("failed to spawn next start")

  try {
    await waitForServer(localUrl)
  } catch (error) {
    await stopServer(child.pid)
    fail(`${error instanceof Error ? error.message : String(error)} — see ${logPath}`)
  }

  const sha = fileEnv.GITHUB_SHA ?? env.GITHUB_SHA ?? gitSha(appDir) ?? "unknown"
  const state = {
    version: 1,
    pr,
    sha,
    port,
    pid: child.pid,
    appDir,
    url,
    localUrl,
    bindHost,
    logPath,
    lockHash,
    deployedAt: new Date().toISOString(),
  }
  await writeState(stateDir, state)
  log(`ready: ${url} (pid ${child.pid}, log ${logPath})`)
}

function gitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

async function teardown(options) {
  const pr = options.pr
  if (!Number.isInteger(pr) || pr <= 0) fail("teardown requires --pr <number>")

  const stateDir = options.stateDir ?? path.resolve(options.appDir ?? repoRoot, "..", "..", "state")
  const state = await readState(stateDir, pr)

  if (options.dryRun) {
    log(
      `dry-run: would stop pid ${state?.pid ?? "none"} for pr #${pr}, ` +
        `remove state in ${stateDir}` +
        (options.keepAppDir
          ? ""
          : `, and remove app dir ${options.appDir ?? state?.appDir ?? "(none recorded)"}`),
    )
    return
  }

  if (state?.pid) {
    log(`stopping preview pid ${state.pid} (pr #${pr})`)
    await stopServer(state.pid)
  } else {
    log(`no running preview registered for pr #${pr}`)
  }

  await removeState(stateDir, pr)

  const appDir = options.appDir ?? state?.appDir ?? null
  if (appDir && !options.keepAppDir && existsSync(appDir)) {
    log(`removing app dir ${appDir}`)
    await rm(appDir, { recursive: true, force: true })
  }
  log(`teardown complete for pr #${pr}`)
}

async function status(options) {
  const stateDir = options.stateDir ?? path.resolve(repoRoot, "..", "..", "state")
  const states = await listStates(stateDir)
  if (states.length === 0) {
    log("no previews registered")
    return
  }
  for (const state of states.sort((a, b) => a.pr - b.pr)) {
    const alive = state.pid ? pidAlive(state.pid) : false
    console.log(
      `pr-${state.pr}\t${alive ? "up" : "down"}\tport ${state.port}\t${state.url}\tdeployed ${state.deployedAt}`,
    )
  }
}

async function gc(options) {
  const stateDir = options.stateDir ?? path.resolve(repoRoot, "..", "..", "state")
  const maxAgeHours = options.maxAgeHours ?? Number(env.PREVIEW_GC_MAX_AGE_HOURS ?? 72)
  const cutoff = Date.now() - maxAgeHours * 3_600_000
  const states = await listStates(stateDir)
  let removed = 0
  for (const state of states) {
    const deployedAt = Date.parse(state.deployedAt ?? "")
    if (Number.isNaN(deployedAt) || deployedAt > cutoff) continue
    if (options.dryRun) {
      log(`dry-run: would tear down stale preview pr #${state.pr} (deployed ${state.deployedAt})`)
      removed += 1
      continue
    }
    log(`gc: tearing down stale preview pr #${state.pr} (deployed ${state.deployedAt})`)
    await stopServer(state.pid)
    await removeState(stateDir, state.pr)
    removed += 1
  }
  // State files that failed to parse still count as stale garbage; drop the
  // matching .url/.log siblings as well.
  if (!options.dryRun && existsSync(stateDir)) {
    for (const file of await readdir(stateDir)) {
      const match = /^pr-(\d+)\.(url|log)$/.exec(file)
      if (!match) continue
      const jsonFile = path.join(stateDir, `pr-${match[1]}.json`)
      if (!existsSync(jsonFile)) await rm(path.join(stateDir, file), { force: true })
    }
  }
  log(`gc complete: ${removed} preview(s) removed`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (
    options.help ||
    !options.command ||
    options.command === "-h" ||
    options.command === "--help"
  ) {
    console.log(USAGE)
    return
  }
  switch (options.command) {
    case "deploy":
      await deploy(options)
      break
    case "teardown":
      await teardown(options)
      break
    case "status":
      await status(options)
      break
    case "gc":
      await gc(options)
      break
    default:
      console.error(USAGE)
      fail(`unknown command: ${options.command}`)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
