#!/usr/bin/env node
/**
 * GraphQL operation complexity analyzer (zero dependencies).
 *
 * Computes depth, field count, and a schema-agnostic cost heuristic for a
 * .graphql operation document — the static-analysis half of GraphQL
 * complexity limiting (see docs/api/graphql-complexity.md).
 *
 * Usage:
 *   node scripts/graphql/complexity.mjs --demo
 *   node scripts/graphql/complexity.mjs --file query.graphql
 *   node scripts/graphql/complexity.mjs --file q.graphql --json \
 *        --max-depth 8 --max-fields 300 --max-cost 500
 *
 * Exit codes: 0 within limits | 1 parse error | 2 limit exceeded | 3 usage/IO
 */
import { readFileSync } from "node:fs"

const COST_ARGS = new Set(["first", "last", "take", "limit", "count", "pageSize", "page_size"])
const COST_ARG_PENALTY = 5

const DEMO_QUERY = `
query DashboardOverview($first: Int = 10) {
  viewer {
    id
    organization {
      id
      name
      members(first: $first) {
        edges {
          node {
            id
            user {
              id
              name
              teams {
                nodes {
                  id
                  name
                  projects(first: 50) {
                    nodes {
                      id
                      title
                      issues(first: 100) {
                        nodes {
                          id
                          title
                          state
                          assignee { id name }
                        }
                        pageInfo { hasNextPage endCursor }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      settings { theme locale }
    }
  }
  __typename
}

fragment UserFields on User {
  id
  name
  email
  createdAt
}
`

// ---------- tokenizer ----------
function tokenize(src) {
  const tokens = []
  let i = 0
  const isNameStart = (c) => /[A-Za-z_]/.test(c)
  const isNameChar = (c) => /[A-Za-z0-9_]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (/\s|,/.test(c)) {
      i++
      continue
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (src.startsWith("...", i)) {
      tokens.push({ t: "punct", v: "..." })
      i += 3
      continue
    }
    if ("{}()[]:=@!".includes(c)) {
      tokens.push({ t: "punct", v: c })
      i++
      continue
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3)
        if (end === -1) throw new Error(`unterminated block string at offset ${i}`)
        tokens.push({ t: "str", v: src.slice(i, end + 3) })
        i = end + 3
      } else {
        let j = i + 1
        while (j < src.length && src[j] !== '"') {
          if (src[j] === "\\") j++
          j++
        }
        if (j >= src.length) throw new Error(`unterminated string at offset ${i}`)
        tokens.push({ t: "str", v: src.slice(i, j + 1) })
        i = j + 1
      }
      continue
    }
    if (isNameStart(c)) {
      let j = i + 1
      while (j < src.length && isNameChar(src[j])) j++
      tokens.push({ t: "name", v: src.slice(i, j) })
      i = j
      continue
    }
    if (c === "-" || /[0-9]/.test(c)) {
      // GraphQL Number: [-]? IntegerPart FracPart? ExpPart?
      let j = i + 1
      while (j < src.length && /[0-9]/.test(src[j])) j++
      if (src[j] === ".") {
        j++
        while (j < src.length && /[0-9]/.test(src[j])) j++
      }
      if (src[j] === "e" || src[j] === "E") {
        let k = j + 1
        if (src[k] === "+" || src[k] === "-") k++
        if (k < src.length && /[0-9]/.test(src[k])) {
          j = k + 1
          while (j < src.length && /[0-9]/.test(src[j])) j++
        }
      }
      tokens.push({ t: "num", v: src.slice(i, j) })
      i = j
      continue
    }
    if (c === "$") {
      i++
      if (!isNameStart(src[i])) throw new Error(`bad variable at offset ${i}`)
      let j = i + 1
      while (j < src.length && isNameChar(src[j])) j++
      tokens.push({ t: "var", v: src.slice(i, j) })
      i = j
      continue
    }
    throw new Error(`unexpected character ${JSON.stringify(c)} at offset ${i}`)
  }
  tokens.push({ t: "eof" })
  return tokens
}

// ---------- parser (executable documents only) ----------
function parse(src) {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const expect = (v) => {
    const t = next()
    if (t.t !== "punct" || t.v !== v)
      throw new Error(`expected '${v}' near token ${JSON.stringify(t)}`)
  }
  const skipDirectives = () => {
    while (peek().t === "punct" && peek().v === "@") {
      next()
      if (peek().t !== "name") throw new Error("directive requires a name")
      next()
      if (peek().t === "punct" && peek().v === "(") parseArguments()
    }
  }
  const parseValue = () => {
    const t = peek()
    if (t.t === "name") {
      next()
      if (t.v === "true" || t.v === "false" || t.v === "null") return { k: "const", v: t.v }
      // enum value
      return { k: "enum", v: t.v }
    }
    if (t.t === "num" || t.t === "str" || t.t === "var") {
      next()
      return { k: t.t, v: t.v }
    }
    if (t.t === "punct" && t.v === "[") {
      next()
      const items = []
      while (!(peek().t === "punct" && peek().v === "]")) items.push(parseValue())
      expect("]")
      return { k: "list", v: items }
    }
    if (t.t === "punct" && t.v === "{") {
      next()
      const fields = []
      while (!(peek().t === "punct" && peek().v === "}")) {
        const name = next()
        if (name.t !== "name") throw new Error("object value requires field name")
        expect(":")
        fields.push({ k: "field", n: name.v, v: parseValue() })
      }
      expect("}")
      return { k: "obj", v: fields }
    }
    throw new Error(`unexpected value token ${JSON.stringify(t)}`)
  }
  const parseArguments = () => {
    expect("(")
    const args = []
    while (!(peek().t === "punct" && peek().v === ")")) {
      const name = next()
      if (name.t !== "name") throw new Error("argument requires name")
      expect(":")
      args.push({ n: name.v, v: parseValue() })
    }
    expect(")")
    return args
  }
  const parseSelectionSet = () => {
    expect("{")
    const sels = []
    while (!(peek().t === "punct" && peek().v === "}")) {
      const t = next()
      if (t.t === "punct" && t.v === "...") {
        const n = peek()
        if (n.t === "name" && n.v === "on") {
          next()
          const type = next()
          if (type.t !== "name") throw new Error("inline fragment requires type")
          skipDirectives()
          sels.push({ k: "inline", type: type.v, sels: parseSelectionSet() })
        } else {
          const frag = next()
          if (frag.t !== "name") throw new Error("fragment spread requires name")
          sels.push({ k: "spread", name: frag.v })
          skipDirectives()
        }
      } else if (t.t === "name") {
        const f = { k: "field", name: t.v, args: [], sels: [] }
        if (peek().t === "punct" && peek().v === ":") {
          next()
          const a = next()
          f.alias = t.v
          f.name = a.v
        }
        if (peek().t === "punct" && peek().v === "(") f.args = parseArguments()
        skipDirectives()
        if (peek().t === "punct" && peek().v === "{") f.sels = parseSelectionSet()
        sels.push(f)
      } else {
        throw new Error(`unexpected selection token ${JSON.stringify(t)}`)
      }
    }
    expect("}")
    return sels
  }
  const definitions = []
  const fragments = new Map()
  while (peek().t !== "eof") {
    const t = next()
    if (t.t === "name" && (t.v === "query" || t.v === "mutation" || t.v === "subscription")) {
      const op = { k: "op", op: t.v, name: null, sels: null }
      const n = peek()
      if (n.t === "name") {
        op.name = next().v
      }
      // variable definitions: '(' $var : Type ... ')'
      if (peek().t === "punct" && peek().v === "(") {
        expect("(")
        while (!(peek().t === "punct" && peek().v === ")")) {
          const v = next()
          if (v.t !== "var") throw new Error("variable definition requires $name")
          expect(":")
          // skip type (name, [type], type!, nested)
          const skipType = () => {
            let tok = next()
            if (tok.t === "punct" && tok.v === "[") {
              skipType()
              expect("]")
            }
            if (peek().t === "punct" && peek().v === "!") next()
          }
          skipType()
          if (peek().t === "punct" && peek().v === "=") {
            next()
            parseValue()
          }
        }
        expect(")")
      }
      skipDirectives()
      op.sels = parseSelectionSet()
      definitions.push(op)
    } else if (t.t === "name" && t.v === "fragment") {
      const name = next()
      if (name.t !== "name") throw new Error("fragment requires name")
      const onTok = next()
      if (onTok.t !== "name" || onTok.v !== "on")
        throw new Error("fragment requires 'on' type condition")
      const type = next()
      skipDirectives()
      fragments.set(name.v, { type: type.v, sels: parseSelectionSet() })
    } else if (t.t === "punct" && t.v === "{") {
      p--
      definitions.push({ k: "op", op: "query", name: null, sels: parseSelectionSet() })
    } else {
      throw new Error(
        `unsupported document element '${t.v ?? t.t}' (only executable operations/fragments are supported)`,
      )
    }
  }
  return { definitions, fragments }
}

// ---------- analysis ----------
function analyzeSelection(sels, fragments, depth, acc, fragStack) {
  for (const s of sels) {
    if (s.k === "field") {
      acc.fields++
      acc.cost += 1
      for (const a of s.args) {
        if (COST_ARGS.has(a.n) && typeof argNumeric(a.v) === "number" && argNumeric(a.v) >= 1) {
          acc.cost += COST_ARG_PENALTY
        }
      }
      acc.maxDepth = Math.max(acc.maxDepth, depth)
      if (s.sels.length) {
        // No cycle guard needed: the parsed AST is a tree — same-name
        // nesting (e.g. `node { node { id } }`) is legitimate and must count.
        analyzeSelection(s.sels, fragments, depth + 1, acc, fragStack)
      }
    } else if (s.k === "inline") {
      analyzeSelection(s.sels, fragments, depth, acc, fragStack)
    } else if (s.k === "spread") {
      const f = fragments.get(s.name)
      if (!f) throw new Error(`undefined fragment '${s.name}'`)
      if (fragStack.has(s.name)) continue // fragment cycle guard
      fragStack.add(s.name)
      analyzeSelection(f.sels, fragments, depth, acc, fragStack)
      fragStack.delete(s.name)
    }
  }
}

function argNumeric(v) {
  if (v.k === "num") return Number(v.v)
  if (v.k === "list" && v.v.length) return argNumeric(v.v[0])
  return null // variables/enums: unknown — no penalty (documented heuristic)
}

function analyze(src) {
  const { definitions, fragments } = parse(src)
  const ops = []
  for (const d of definitions) {
    const acc = { fields: 0, cost: 0, maxDepth: 0 }
    analyzeSelection(d.sels, fragments, 1, acc, new Set())
    ops.push({ name: d.name ?? "(anonymous)", type: d.op, ...acc })
  }
  return { operations: ops, fragments: [...fragments.keys()] }
}

// ---------- CLI ----------
function usage() {
  console.error(`Usage:
  node scripts/graphql/complexity.mjs --demo [--json] [limits]
  node scripts/graphql/complexity.mjs --file <query.graphql> [--json] [limits]
Limits (all optional, defaults unlimited):
  --max-depth N   --max-fields N   --max-cost N`)
  process.exit(3)
}

const args = process.argv.slice(2)
let file = null,
  demo = false,
  json = false
const limits = {}
const parseLimit = (flag, raw) => {
  const n = Number(raw)
  if (raw == null || !Number.isFinite(n) || n < 0) {
    console.error(`error: ${flag} requires a non-negative number, got ${JSON.stringify(raw)}`)
    process.exit(3)
  }
  return n
}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--demo") demo = true
  else if (a === "--json") json = true
  else if (a === "--file") file = args[++i]
  else if (a === "--max-depth") limits.depth = parseLimit(a, args[++i])
  else if (a === "--max-fields") limits.fields = parseLimit(a, args[++i])
  else if (a === "--max-cost") limits.cost = parseLimit(a, args[++i])
  else usage()
}
if (!demo && !file) usage()
if (file && demo) usage()

let src
try {
  src = demo ? DEMO_QUERY : readFileSync(file, "utf8")
} catch (e) {
  console.error(`error reading input: ${e.message}`)
  process.exit(3)
}

let result
try {
  result = analyze(src)
} catch (e) {
  console.error(`parse error: ${e.message}`)
  process.exit(1)
}

const exceeded = []
for (const op of result.operations) {
  const hits = []
  if (limits.depth != null && op.maxDepth > limits.depth)
    hits.push(`depth ${op.maxDepth} > ${limits.depth}`)
  if (limits.fields != null && op.fields > limits.fields)
    hits.push(`fields ${op.fields} > ${limits.fields}`)
  if (limits.cost != null && op.cost > limits.cost) hits.push(`cost ${op.cost} > ${limits.cost}`)
  if (hits.length) exceeded.push({ operation: op.name, violations: hits })
}

if (json) {
  console.log(JSON.stringify({ ...result, limits, exceeded }, null, 2))
} else {
  console.log(`GraphQL complexity analysis${demo ? " (demo)" : `: ${file}`}`)
  for (const op of result.operations) {
    console.log(`  ${op.type} ${op.name}: depth=${op.maxDepth} fields=${op.fields} cost=${op.cost}`)
  }
  if (result.fragments.length) console.log(`  fragments: ${result.fragments.join(", ")}`)
  if (limits.depth != null || limits.fields != null || limits.cost != null) {
    if (exceeded.length) {
      for (const e of exceeded)
        console.log(`  LIMIT EXCEEDED ${e.operation}: ${e.violations.join("; ")}`)
    } else {
      console.log("  all operations within limits")
    }
  }
}
process.exit(exceeded.length ? 2 : 0)
