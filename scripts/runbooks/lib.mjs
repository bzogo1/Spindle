// Shared helpers for the runbook tooling under scripts/runbooks/.
//
// Everything here is offline and dependency-free: the index, lint, staleness,
// and executor scripts all read the runbook markdown plus registry.json and
// (optionally) ask git for last-commit dates. No network, no database.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// Runbooks live in two places: operational procedures in docs/runbooks/ and
// resilience/DR documents in docs/resilience/.
export const RUNBOOK_DIRS = ["docs/runbooks", "docs/resilience"]

export const REGISTRY_FILE = join(ROOT, "scripts", "runbooks", "registry.json")

export const SEVERITIES = ["critical", "high", "medium", "low"]

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function listRunbooks(root = ROOT) {
  const files = []
  for (const dir of RUNBOOK_DIRS) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs).sort()) {
      if (name.endsWith(".md")) files.push(`${dir}/${name}`)
    }
  }
  return files.sort()
}

export function readRunbook(root, relPath) {
  return readFileSync(join(root, relPath), "utf8")
}

export function runbookTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function loadRegistry(root = ROOT) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "scripts/runbooks/registry.json"), "utf8"))
    return parsed?.runbooks ?? {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Last-reviewed date
// ---------------------------------------------------------------------------

// Returns { date: ISO string|null, source: "git"|"mtime"|"missing", ageDays }.
// `useGit=false` (--demo) skips git entirely and uses file mtimes.
export function lastReviewed(root, relPath, { useGit = true, now = new Date() } = {}) {
  if (useGit) {
    const result = spawnSync("git", ["log", "-1", "--format=%cI", "--", relPath], {
      cwd: root,
      encoding: "utf8",
    })
    const out = (result.stdout ?? "").trim()
    if (result.status === 0 && out) {
      const date = new Date(out)
      return { date: out, source: "git", ageDays: ageInDays(date, now) }
    }
    // Empty output: file is untracked — fall through to mtime.
  }
  try {
    const mtime = statSync(join(root, relPath)).mtime
    return {
      date: mtime.toISOString(),
      source: useGit ? "mtime" : "mtime",
      ageDays: ageInDays(mtime, now),
    }
  } catch {
    return { date: null, source: "missing", ageDays: null }
  }
}

export function ageInDays(date, now = new Date()) {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Reference extraction (shared by lint and the executor)
// ---------------------------------------------------------------------------

// Repo-relative path prefixes that runbooks are allowed to reference.
export const PATH_PREFIXES = [
  "scripts/",
  "docs/",
  "infra/",
  "prisma/",
  ".github/",
  "src/",
  "e2e/",
  "compose.yaml",
  "package.json",
  "package-lock.json",
  "prisma7.config.ts",
  "tsconfig.json",
]

const BACKTICK_RE = /`([^`\n]+)`/g
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g
const FENCE_RE = /```(\w*)\n([\s\S]*?)```/g
const COMMAND_START_RE =
  /^(?:[$#]\s*)?(node|npx|npm|pnpm|yarn|bash|sh|tsx|docker|pg_dump|pg_restore|psql|gpg|openssl|curl|git)\b/

// Inline `code` spans are ambiguous — runbooks mention `pg_dump`, `openssl`,
// and `npm install` in prose. An inline span only counts as a command when it
// carries evidence of an actual invocation: a repo script path, `npm run`, a
// shell script, `node -e`, or a docker compose invocation.
const INLINE_EVIDENCE_RE =
  /(?:scripts\/|npm\s+run|node_modules\/\.bin|\.sh\b|node\s+-e|docker\s+compose)/

// Strip trailing punctuation and markdown decorations from a candidate token.
function cleanToken(token) {
  return token
    .trim()
    .replace(/^['"(]+|['").,;:!?]+$/g, "")
    .replace(/#.*$/, "")
}

function looksLikePath(token) {
  if (!token || token.includes(" ")) return false
  if (token.includes("<") || token.includes(">")) return false // template placeholder
  if (/^https?:\/\//.test(token)) return false
  return PATH_PREFIXES.some((prefix) => token.startsWith(prefix))
}

// Resolve a candidate path against the repo root (absolute-style repo paths)
// or, failing that, relative to the runbook's own directory (markdown links).
export function resolveReference(root, docRelPath, token) {
  const cleaned = cleanToken(token)
  if (!cleaned) return null
  if (looksLikePath(cleaned)) {
    const abs = join(root, cleaned)
    return { rel: cleaned, abs, templated: false }
  }
  // Relative link target, e.g. ../../scripts/db/migrate.mjs
  const docDir = dirname(join(root, docRelPath))
  const abs = resolve(docDir, cleaned)
  const rel = abs
    .slice(root.length + 1)
    .split(sep)
    .join("/")
  if (rel.startsWith("..") || rel === docRelPath) return null
  if (!PATH_PREFIXES.some((p) => rel === p || rel.startsWith(p))) return null
  return { rel, abs, templated: false }
}

// Extract every repo-path reference from a runbook: markdown link targets and
// backtick-quoted tokens that start with a known repo prefix.
export function extractPathReferences(root, docRelPath, markdown) {
  const refs = new Map() // relPath -> { rel, abs, templated, via }
  const add = (token, via) => {
    const resolved = resolveReference(root, docRelPath, token)
    if (!resolved || refs.has(resolved.rel)) return
    refs.set(resolved.rel, { ...resolved, via })
  }

  for (const match of markdown.matchAll(LINK_RE)) {
    add(match[1], "link")
  }
  for (const match of markdown.matchAll(BACKTICK_RE)) {
    // A backtick span may hold a whole command; scan its whitespace-separated
    // tokens too so `node scripts/db/migrate.mjs --ci` yields the script path.
    const span = match[1]
    if (looksLikePath(cleanToken(span))) {
      add(span, "code")
      continue
    }
    for (const token of span.split(/\s+/)) {
      const cleaned = cleanToken(token)
      if (looksLikePath(cleaned)) add(cleaned, "code")
    }
  }
  return [...refs.values()]
}

// Extract executable-looking commands: fenced bash/sh/console blocks (one
// command per line, `\`-continuations joined) plus inline `code` spans that
// start with a known command word.
export function extractCommands(markdown) {
  const commands = []

  for (const match of markdown.matchAll(FENCE_RE)) {
    const lang = match[1].toLowerCase()
    const isShell =
      ["", "bash", "sh", "shell", "console", "zsh", "text", "txt"].includes(lang) ||
      lang === "shellsession"
    if (!isShell) continue
    const lines = match[2].split("\n")
    let buffer = ""
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      const continued = line.endsWith("\\")
      buffer = buffer ? `${buffer} ${line.slice(0, -1).trim()}` : line
      if (!continued) {
        if (COMMAND_START_RE.test(buffer.replace(/^[$#]\s*/, ""))) {
          commands.push({ text: buffer.replace(/^[$#]\s*/, ""), via: "fence" })
        }
        buffer = ""
      }
    }
    if (buffer && COMMAND_START_RE.test(buffer.replace(/^[$#]\s*/, ""))) {
      commands.push({ text: buffer.replace(/^[$#]\s*/, ""), via: "fence" })
    }
  }

  for (const match of markdown.matchAll(BACKTICK_RE)) {
    const span = match[1].trim()
    if (span.includes("\n")) continue // fenced content handled above
    const cleaned = span.replace(/^[$#]\s*/, "")
    if (COMMAND_START_RE.test(cleaned) && INLINE_EVIDENCE_RE.test(cleaned)) {
      commands.push({ text: cleaned, via: "inline" })
    }
  }

  // De-duplicate identical command strings, preserving order.
  const seen = new Set()
  return commands.filter((c) => {
    if (seen.has(c.text)) return false
    seen.add(c.text)
    return true
  })
}

// ---------------------------------------------------------------------------
// Command classification (executor)
// ---------------------------------------------------------------------------

const DRY_RUN_FLAG_RE = /--(dry-run|demo|help|list|plan)\b/

// A command is "dry-run safe" when it targets a repo script and carries an
// explicit no-side-effect flag. Everything else is plan-only.
export function classifyCommand(command) {
  const text = command.text
  const first = text.split(/\s+/)[0] ?? ""
  const runner = ["node", "npx", "tsx", "npm", "pnpm", "yarn"].includes(first)
  const scriptRef = /(?:^|\s)(?:node|npx|tsx)\s+(\S+)/.exec(text)?.[1] ?? null
  const hasDryFlag = DRY_RUN_FLAG_RE.test(text)

  if (!hasDryFlag) {
    return { safe: false, reason: "no dry-run/demo/help flag present" }
  }
  if (!runner) {
    return { safe: false, reason: `unrecognized runner: ${first}` }
  }
  if (scriptRef && scriptRef.startsWith("scripts/") === false && scriptRef.includes("/")) {
    return { safe: false, reason: `script target outside scripts/: ${scriptRef}` }
  }
  return { safe: true, reason: "carries a no-side-effect flag" }
}

// Find script file references inside a command for existence checks.
export function scriptTargetsInCommand(command) {
  const text = command.text
  const targets = []
  const fileRe = /(?:node|npx|tsx)\s+(\S*(?:scripts|\.\/scripts)\/\S+\.(?:mjs|cjs|js|ts|sh))/g
  for (const match of text.matchAll(fileRe)) targets.push(match[1])
  const npmRunRe = /npm\s+run\s+([a-zA-Z0-9:_-]+)/g
  for (const match of text.matchAll(npmRunRe)) targets.push(`npm:${match[1]}`)
  return targets
}

export function packageJsonScripts(root = ROOT) {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}
  } catch {
    return {}
  }
}
