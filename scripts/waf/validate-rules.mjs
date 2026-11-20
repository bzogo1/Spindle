#!/usr/bin/env node
// Sanity-checks the Cloudflare ruleset JSON under infra/waf/.
//
//   node scripts/waf/validate-rules.mjs [file ...]
//
// With no arguments it validates every *.json file in infra/waf/. This is a
// syntax/schema-lite check, not a Cloudflare API call: it catches typos in
// field names, malformed JSON, unbalanced expressions, missing ratelimit
// blocks, and duplicate rule refs before the ruleset is uploaded.

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const wafDir = join(repoRoot, "infra/waf")

const PHASES = new Set([
  "http_request_firewall_custom",
  "http_request_firewall_managed",
  "http_ratelimit",
])

const ACTIONS = new Set([
  "block",
  "challenge",
  "js_challenge",
  "managed_challenge",
  "log",
  "skip",
  "redirect",
])

// Fields Cloudflare silently ignores or rejects when misspelled at rule level.
// Rules use the user-supplied `ref` identifier; Cloudflare assigns the real
// rule `id` on upload, so id/version are not (and should not be) in these files.
const RULE_FIELDS = new Set([
  "ref",
  "action",
  "action_parameters",
  "expression",
  "description",
  "enabled",
  "logging",
  "ratelimit",
])

const RULESET_FIELDS = new Set(["name", "kind", "phase", "description", "rules"])

const KNOWN_FIELD_RE = /\b(?:http|cf|ip)\.[a-z_]+(?:\.[a-z_]+)*/

function defaultFiles() {
  return readdirSync(wafDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(wafDir, name))
}

function checkBalanced(text, open, close, what, errors) {
  let depth = 0
  let inString = false
  let escaped = false

  for (const ch of text) {
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth < 0) {
        errors.push(`${what}: unbalanced ${close} (closes before it opens)`)
        return
      }
    }
  }
  if (inString) errors.push(`${what}: unterminated string literal`)
  if (depth !== 0) errors.push(`${what}: unbalanced ${open} (depth ${depth})`)
}

function checkExpression(expression, where, errors) {
  if (typeof expression !== "string" || expression.trim() === "") {
    errors.push(`${where}: expression is missing or empty`)
    return
  }
  checkBalanced(expression, "(", ")", `${where} expression parens`, errors)
  checkBalanced(expression, "{", "}", `${where} expression braces`, errors)
  if (!KNOWN_FIELD_RE.test(expression)) {
    errors.push(`${where}: expression references no http./cf./ip. field`)
  }
}

function checkRatelimit(rule, where, errors) {
  const rl = rule.ratelimit
  if (typeof rl !== "object" || rl === null) {
    errors.push(`${where}: http_ratelimit rule is missing the ratelimit block`)
    return
  }
  const required = ["characteristics", "period", "requests_per_period", "mitigation_timeout"]
  for (const field of required) {
    if (!(field in rl)) errors.push(`${where}: ratelimit.${field} is missing`)
  }
  if (Array.isArray(rl.characteristics) && rl.characteristics.length === 0) {
    errors.push(`${where}: ratelimit.characteristics must not be empty`)
  }
  for (const field of ["period", "requests_per_period", "mitigation_timeout"]) {
    if (field in rl && (!Number.isInteger(rl[field]) || rl[field] <= 0)) {
      errors.push(`${where}: ratelimit.${field} must be a positive integer`)
    }
  }
}

function validateRuleset(path) {
  const errors = []
  const warnings = []
  const label = path.replace(`${repoRoot}/`, "")

  let doc
  try {
    doc = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    return { label, errors: [`invalid JSON: ${err.message}`], warnings }
  }

  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { label, errors: ["top level must be a JSON object"], warnings }
  }

  for (const field of Object.keys(doc)) {
    if (!RULESET_FIELDS.has(field)) warnings.push(`unknown ruleset field "${field}"`)
  }
  for (const field of ["name", "kind", "phase"]) {
    if (typeof doc[field] !== "string" || doc[field] === "") {
      errors.push(`ruleset is missing "${field}"`)
    }
  }
  if (doc.kind !== undefined && doc.kind !== "zone") {
    warnings.push(`kind is "${doc.kind}"; these rulesets are written for kind "zone"`)
  }
  if (doc.phase !== undefined && !PHASES.has(doc.phase)) {
    errors.push(`unknown phase "${doc.phase}"`)
  }
  if (!Array.isArray(doc.rules)) {
    errors.push('"rules" must be an array')
    return { label, errors, warnings }
  }

  const seenRefs = new Set()
  doc.rules.forEach((rule, index) => {
    const where = `rules[${index}] (${rule?.ref ?? "no ref"})`

    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      errors.push(`${where}: rule must be an object`)
      return
    }
    for (const field of Object.keys(rule)) {
      if (!RULE_FIELDS.has(field)) warnings.push(`${where}: unknown rule field "${field}"`)
    }
    for (const field of ["ref", "action", "expression"]) {
      if (typeof rule[field] !== "string" || rule[field] === "") {
        errors.push(`${where}: missing or empty "${field}"`)
      }
    }
    if (rule.ref) {
      if (seenRefs.has(rule.ref)) errors.push(`${where}: duplicate rule ref "${rule.ref}"`)
      seenRefs.add(rule.ref)
    }
    if (rule.action && !ACTIONS.has(rule.action)) {
      errors.push(`${where}: unknown action "${rule.action}"`)
    }
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      errors.push(`${where}: "enabled" must be a boolean`)
    }
    if (typeof rule.expression === "string") {
      checkExpression(rule.expression, where, errors)
    }
    if (doc.phase === "http_ratelimit") {
      checkRatelimit(rule, where, errors)
    }
  })

  return { label, errors, warnings }
}

const files = process.argv.slice(2)
const targets = files.length > 0 ? files.map((f) => resolve(f)) : defaultFiles()

if (targets.length === 0) {
  console.error("No ruleset JSON files found in infra/waf/.")
  process.exit(2)
}

let failed = false
for (const file of targets) {
  const { label, errors, warnings } = validateRuleset(file)
  for (const warning of warnings) console.warn(`WARN  ${label}: ${warning}`)
  for (const error of errors) console.error(`ERROR ${label}: ${error}`)
  if (errors.length === 0) {
    console.log(`PASS  ${label}`)
  } else {
    failed = true
  }
}

process.exit(failed ? 1 : 0)
