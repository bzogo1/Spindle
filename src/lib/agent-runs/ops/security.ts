/**
 * Agent run security — secret/PII scanning and redaction for recorded runs.
 *
 * `scanRunForSecrets` walks step titles/details/payloads and stream event
 * messages/data looking for credentials (API keys, tokens, private keys,
 * bearer strings), PII (emails), and generic secret assignments. Findings
 * carry redacted samples only — raw secrets never leave this module.
 * `redactRun` returns a sanitized deep copy suitable for sharing.
 */

import type { AgentRunRecord, AgentRunOpsStep } from "./types"

export type SecretDetectorId =
  "email" | "api_key" | "private_key" | "bearer_token" | "jwt" | "secret_assignment" | "secret_key"

export type SecretSeverity = "low" | "medium" | "high" | "critical"

export interface SecretDetector {
  id: SecretDetectorId
  label: string
  severity: SecretSeverity
  pattern: RegExp
  /** Replacement used by `redactText` — keeps findings readable. */
  redaction: string
}

export const SECRET_DETECTORS: readonly SecretDetector[] = [
  {
    id: "private_key",
    label: "Private key block",
    severity: "critical",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    redaction: "[REDACTED:private_key]",
  },
  {
    id: "api_key",
    label: "API key / access token",
    severity: "high",
    pattern:
      /\b(?:sk|pk|rk|xox[baprs]|ghp|gho|ghu|ghs|ghr|glpat|hf|npm|pypi)[-_][A-Za-z0-9_-]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    redaction: "[REDACTED:api_key]",
  },
  {
    id: "jwt",
    label: "JWT token",
    severity: "high",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    redaction: "[REDACTED:jwt]",
  },
  {
    id: "bearer_token",
    label: "Bearer token",
    severity: "high",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
    redaction: "[REDACTED:bearer_token]",
  },
  {
    id: "secret_assignment",
    label: "Secret-looking assignment",
    severity: "medium",
    // Handles `key=value`, `key: value`, JSON-shaped `"key":"value"` /
    // `{"key": "value with spaces"}` (optional quotes around the key name,
    // plural key forms like `passwords`, and quoted values with spaces).
    pattern:
      /["'`]?(?:api[_-]?keys?|secrets?|passwd|passwords?|access[_-]?tokens?|auth[_-]?tokens?|client[_-]?secrets?|private[_-]?keys?|credentials)["'`]?\s*[:=]\s*(?:"[^"\n]{8,}"|'[^'\n]{8,}'|`[^`\n]{8,}`|[A-Za-z0-9._~+/=-]{8,})/gi,
    redaction: "[REDACTED:secret_assignment]",
  },
  {
    id: "email",
    label: "Email address (PII)",
    severity: "low",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    redaction: "[REDACTED:email]",
  },
]

export interface SecretLocation {
  /** "run" (top-level fields), "step", or "event". */
  target: "run" | "step" | "event"
  /** Run id, step id, or event id. */
  ref: string
  /** Which field matched: prompt, name, summary, actor, title, detail, payload, message, data, source. */
  field: string
}

export interface SecretFinding {
  detector: SecretDetectorId
  label: string
  severity: SecretSeverity
  count: number
  locations: SecretLocation[]
  /** Redacted sample of the first match (max ~80 chars). */
  sample: string
}

export interface RunSecurityScan {
  runId: string
  findings: SecretFinding[]
  /** Total raw match count across all detectors. */
  totalMatches: number
  /** Number of text fields inspected. */
  scannedFields: number
}

interface ScanTarget {
  target: "run" | "step" | "event"
  ref: string
  field: string
  text: string
  /**
   * Set for synthetic targets emitted under a SECRET_KEY_RE-matching object
   * key. These bypass the regex detectors entirely — the key name already
   * establishes sensitivity (mirroring `redactValue`), so no length floor or
   * value pattern applies. `scanRunForSecrets` aggregates them into a single
   * `secret_key` finding.
   */
  keyAnchored?: boolean
}

function collectTargets(run: AgentRunRecord): ScanTarget[] {
  const targets: ScanTarget[] = []
  // Top-level run fields are just as exposed as step/event content — a
  // secret pasted into the prompt or summary must not get a clean bill.
  pushField(targets, "run", run.id, "prompt", run.prompt)
  if (run.name) pushField(targets, "run", run.id, "name", run.name)
  if (run.summary) pushField(targets, "run", run.id, "summary", run.summary)
  if (run.actor) pushField(targets, "run", run.id, "actor", run.actor)
  for (const step of run.steps) {
    pushField(targets, "step", step.id, "title", step.title)
    if (step.detail) pushField(targets, "step", step.id, "detail", step.detail)
    if (step.payload) {
      collectPayloadTargets(targets, "step", step.id, "payload", step.payload)
    }
  }
  for (const event of run.events) {
    pushField(targets, "event", event.id, "message", event.message)
    pushField(targets, "event", event.id, "source", event.source)
    if (event.data) {
      collectPayloadTargets(targets, "event", event.id, "data", event.data)
    }
  }
  return targets
}

/**
 * Walk a payload/data object and emit scan targets per string leaf and per
 * object key. Scanning leaves verbatim — rather than the JSON.stringify
 * output — avoids escape-mangled secrets (`\"password\"` inside serialized
 * JSON defeats assignment patterns) and yields precise dotted locations.
 *
 * `secretKey` carries the object key that declared the current value
 * secret-bearing, mirroring `redactValue` exactly: it propagates through
 * arrays but is RESET at object boundaries (a nested object's children are
 * judged by their own keys, not the parent's). Object form
 * `{password: "x"}` never presents key+separator+value adjacency to the
 * assignment detector, and short values like `"x"` or `"hunter2"` fall under
 * its 8-char floor — yet `redactValue` redacts them wholesale. So for
 * non-empty strings under a secret key we emit a `keyAnchored` target that
 * `scanRunForSecrets` reports via the dedicated `secret_key` detector with
 * no length floor. Values already containing `[REDACTED:` are skipped so a
 * redact-then-rescan cycle stays clean. The boundary is SECRET_KEY_RE
 * itself — identical for scan and redaction, so e.g. `passwordHint` is
 * flagged AND redacted (conservative substring semantics), while
 * `secretKey`/`apiKey` compounds are covered for free.
 */
function collectPayloadTargets(
  targets: ScanTarget[],
  target: ScanTarget["target"],
  ref: string,
  prefix: string,
  value: unknown,
  secretKey?: string,
): void {
  if (typeof value === "string") {
    if (value.length === 0) return
    targets.push({ target, ref, field: prefix, text: value })
    // Skip already-redacted values: `[REDACTED:secret_key]` under `password`
    // would otherwise self-flag and break the redact-then-rescan recipe.
    if (secretKey && !value.includes("[REDACTED:")) {
      targets.push({
        target,
        ref,
        field: prefix,
        text: `${secretKey}: ${JSON.stringify(value)}`,
        keyAnchored: true,
      })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      collectPayloadTargets(targets, target, ref, `${prefix}[${i}]`, item, secretKey),
    )
    return
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.length > 0) {
        targets.push({ target, ref, field: `${prefix}.<key>`, text: key })
      }
      // Object boundary: the child's own key decides — the parent keyHint
      // does NOT propagate into nested objects (same as redactValue).
      const childSecretKey = SECRET_KEY_RE.test(key) ? key : undefined
      collectPayloadTargets(targets, target, ref, `${prefix}.${key}`, child, childSecretKey)
    }
  }
}

function pushField(
  targets: ScanTarget[],
  target: ScanTarget["target"],
  ref: string,
  field: string,
  text: string | undefined,
): void {
  if (typeof text === "string" && text.length > 0) targets.push({ target, ref, field, text })
}

function sampleOf(match: string): string {
  const flat = match.replace(/\s+/g, " ").trim()
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat
}

export function scanRunForSecrets(run: AgentRunRecord): RunSecurityScan {
  const targets = collectTargets(run)
  const findings: SecretFinding[] = []
  let totalMatches = 0

  for (const detector of SECRET_DETECTORS) {
    detector.pattern.lastIndex = 0
    const re = new RegExp(detector.pattern.source, detector.pattern.flags)
    let count = 0
    let sample = ""
    const locations: SecretLocation[] = []
    const seen = new Set<string>()

    for (const target of targets) {
      // Key-anchored targets are reported via the dedicated `secret_key`
      // finding below — running them through the regex detectors too would
      // double-count the same leak.
      if (target.keyAnchored) continue
      re.lastIndex = 0
      let match: RegExpExecArray | null
      let hit = false
      while ((match = re.exec(target.text)) !== null) {
        count += 1
        totalMatches += 1
        hit = true
        if (!sample) sample = sampleOf(match[0])
        if (match[0].length === 0) re.lastIndex += 1 // avoid infinite loop on empty matches
      }
      if (hit) {
        const key = `${target.target}:${target.ref}:${target.field}`
        if (!seen.has(key)) {
          seen.add(key)
          locations.push({ target: target.target, ref: target.ref, field: target.field })
        }
      }
    }

    if (count > 0) {
      findings.push({
        detector: detector.id,
        label: detector.label,
        severity: detector.severity,
        count,
        locations,
        sample: redactText(sample, detector.id),
      })
    }
  }

  // Key-anchored findings: any non-empty string stored under a
  // SECRET_KEY_RE-matching object key. The key name alone establishes
  // sensitivity — identical predicate to `redactValue` — so there is no
  // length floor and no value pattern. Aggregated into one finding.
  const anchored = targets.filter((t) => t.keyAnchored)
  if (anchored.length > 0) {
    totalMatches += anchored.length
    const locations: SecretLocation[] = []
    const seen = new Set<string>()
    for (const t of anchored) {
      const key = `${t.target}:${t.ref}:${t.field}`
      if (!seen.has(key)) {
        seen.add(key)
        locations.push({ target: t.target, ref: t.ref, field: t.field })
      }
    }
    findings.push({
      detector: "secret_key",
      label: "Secret-keyed value",
      severity: "high",
      count: anchored.length,
      locations,
      sample: "[REDACTED:secret_key]",
    })
  }

  // Sort by severity then count for stable display.
  const rank: Record<SecretSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count)

  return { runId: run.id, findings, totalMatches, scannedFields: targets.length }
}

/** Replace all detector matches in `text` with their redaction markers. */
export function redactText(text: string, only?: SecretDetectorId): string {
  let out = text
  for (const detector of SECRET_DETECTORS) {
    if (only && detector.id !== only) continue
    out = out.replace(detector.pattern, detector.redaction)
  }
  return out
}

/** Object keys that mark a value as secret-bearing regardless of content. */
const SECRET_KEY_RE =
  /(?:api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|credential)/i

/** Deep-walk a JSON-ish value redacting every string leaf. */
function redactValue(value: unknown, keyHint?: string): unknown {
  // Entries under a secret-looking key are redacted wholesale — the key name
  // itself declares the value sensitive even when the detectors don't match
  // (e.g. short or unusual token formats).
  if (typeof value === "string" && keyHint && SECRET_KEY_RE.test(keyHint) && value.length > 0) {
    return "[REDACTED:secret_key]"
  }
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map((v) => redactValue(v, keyHint))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k)
    }
    return out
  }
  return value
}

/** Return a sanitized deep copy of the run with all secrets redacted. */
export function redactRun(run: AgentRunRecord): AgentRunRecord {
  const redactedSteps: AgentRunOpsStep[] = run.steps.map((step) => ({
    ...step,
    title: redactText(step.title),
    detail: step.detail ? redactText(step.detail) : step.detail,
    payload: step.payload ? (redactValue(step.payload) as Record<string, unknown>) : step.payload,
  }))
  const redactedEvents = run.events.map((event) => ({
    ...event,
    message: redactText(event.message),
    source: redactText(event.source),
    data: event.data ? (redactValue(event.data) as Record<string, unknown>) : event.data,
  }))
  return {
    ...run,
    prompt: redactText(run.prompt),
    name: run.name ? redactText(run.name) : run.name,
    summary: run.summary ? redactText(run.summary) : run.summary,
    actor: run.actor ? redactText(run.actor) : run.actor,
    steps: redactedSteps,
    events: redactedEvents,
  }
}

export type SecurityRisk = "clean" | "low" | "medium" | "high"

export interface SecurityReport {
  runId: string
  risk: SecurityRisk
  findings: SecretFinding[]
  totalMatches: number
  scannedFields: number
  recommendations: string[]
}

export function buildSecurityReport(scan: RunSecurityScan): SecurityReport {
  const maxSeverity = scan.findings.reduce<SecretSeverity | null>((acc, f) => {
    const rank: Record<SecretSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 }
    if (!acc) return f.severity
    return rank[f.severity] > rank[acc] ? f.severity : acc
  }, null)

  const risk: SecurityRisk =
    maxSeverity === "critical" || maxSeverity === "high"
      ? "high"
      : maxSeverity === "medium"
        ? "medium"
        : scan.findings.length > 0
          ? "low"
          : "clean"

  const recommendations: string[] = []
  if (scan.findings.length === 0) {
    recommendations.push("No secrets or PII patterns detected; safe to share or archive.")
  } else {
    if (scan.findings.some((f) => f.detector === "private_key" || f.detector === "api_key")) {
      recommendations.push(
        "Rotate any exposed credentials immediately — assume they are compromised once recorded.",
      )
    }
    if (scan.findings.some((f) => f.detector === "email")) {
      recommendations.push(
        "Consider pseudonymizing email addresses before sharing the run externally.",
      )
    }
    recommendations.push("Use redactRun() before exporting the run to a share link or backup file.")
    recommendations.push(
      "Add secret scanning to the run-recording pipeline to catch leaks at write time.",
    )
  }

  return {
    runId: scan.runId,
    risk,
    findings: scan.findings,
    totalMatches: scan.totalMatches,
    scannedFields: scan.scannedFields,
    recommendations,
  }
}
