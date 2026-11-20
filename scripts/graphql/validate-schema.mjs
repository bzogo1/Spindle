#!/usr/bin/env node
/**
 * validate-schema.mjs — dependency-free GraphQL SDL validator / linter /
 * breaking-change differ.
 *
 * Usage:
 *   node scripts/graphql/validate-schema.mjs <schema.graphql> [options]
 *   node scripts/graphql/validate-schema.mjs --demo
 *
 * Options:
 *   --baseline <file>   Compare against a previous schema; report breaking
 *                       changes and exit non-zero unless --allow-breaking.
 *   --allow-breaking    Report breaking changes but exit 0.
 *   --demo              Validate the bundled fixture schema
 *                       (scripts/graphql/fixtures/demo.schema.graphql).
 *   --json              Emit machine-readable JSON instead of text.
 *
 * Checks performed:
 *   ERRORS   - SDL parse errors, duplicate type/directive/field/arg/enum-value
 *              definitions, references to undefined types, kind mismatches
 *              (e.g. an object type used where an input type is required),
 *              unknown directive locations, interface fields missing on
 *              implementing object types.
 *   WARNINGS- Naming-convention lint (PascalCase types, camelCase fields,
 *              SCREAMING_SNAKE_CASE enum values) and missing descriptions.
 *   BREAKING - With --baseline: removed types/fields/args/enum values/union
 *              members/directives, changed type signatures, changed schema
 *              operation mapping.
 *   INFO     - Non-breaking additions.
 *
 * This script intentionally does NOT require the `graphql` package. If the
 * real package is ever added as a dependency, prefer `graphql`'s parser for
 * authoritative validation and this script for the zero-dep CI gate.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEMO_SCHEMA = resolve(HERE, "fixtures/demo.schema.graphql")

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"])
const INTROSPECTION_PREFIX = "__"

const DIRECTIVE_LOCATIONS = new Set([
  "QUERY",
  "MUTATION",
  "SUBSCRIPTION",
  "FIELD",
  "FRAGMENT_DEFINITION",
  "FRAGMENT_SPREAD",
  "INLINE_FRAGMENT",
  "VARIABLE_DEFINITION",
  "SCHEMA",
  "SCALAR",
  "OBJECT",
  "FIELD_DEFINITION",
  "ARGUMENT_DEFINITION",
  "INTERFACE",
  "UNION",
  "ENUM",
  "ENUM_VALUE",
  "INPUT_OBJECT",
  "INPUT_FIELD_DEFINITION",
])

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(src) {
  const tokens = []
  let i = 0
  const lineAt = (pos) => src.slice(0, pos).split("\n").length
  const push = (kind, value, pos) => tokens.push({ kind, value, line: lineAt(pos) })

  while (i < src.length) {
    const ch = src[i]

    // whitespace / commas / line terminators are insignificant
    if (/\s|,/.test(ch)) {
      i++
      continue
    }

    // comments: # ... to end of line
    if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }

    // block string """...""" (may contain \""" escapes; we keep raw value)
    if (src.startsWith('"""', i)) {
      const start = i
      i += 3
      let value = ""
      while (i < src.length && !src.startsWith('"""', i)) {
        if (src[i] === "\\" && src.startsWith('\\"""', i)) {
          value += '"""'
          i += 4
          continue
        }
        value += src[i++]
      }
      if (i >= src.length) throw new Error(`Unterminated block string at line ${lineAt(start)}`)
      i += 3
      push("BLOCKSTRING", value, start)
      continue
    }

    // regular string
    if (ch === '"') {
      const start = i
      i++
      let value = ""
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          value += src[i] + (src[i + 1] ?? "")
          i += 2
          continue
        }
        value += src[i++]
      }
      if (i >= src.length) throw new Error(`Unterminated string at line ${lineAt(start)}`)
      i++
      push("STRING", value, start)
      continue
    }

    // names
    if (/[A-Za-z_]/.test(ch)) {
      const start = i
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++
      push("NAME", src.slice(start, i), start)
      continue
    }

    // numbers (for enum values / default literals)
    if (/[0-9-]/.test(ch) && !/[A-Za-z_]/.test(src[i + 1] ?? "")) {
      const start = i
      if (src[i] === "-") i++
      while (i < src.length && /[0-9.eE+-]/.test(src[i]) && !/[ \t\n,{}()[\]:@!$&|=]/.test(src[i]))
        i++
      push("NUMBER", src.slice(start, i), start)
      continue
    }

    // punctuation (longest first: ...)
    if (src.startsWith("...", i)) {
      push("PUNCT", "...", i)
      i += 3
      continue
    }
    if ("!$&():=@[]{}|".includes(ch)) {
      push("PUNCT", ch, i)
      i++
      continue
    }

    throw new Error(`Unexpected character '${ch}' at line ${lineAt(i)}`)
  }
  tokens.push({ kind: "EOF", value: "", line: lineAt(src.length) })
  return tokens
}

// ---------------------------------------------------------------------------
// Parser — builds a type-system AST
// ---------------------------------------------------------------------------

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.pos = 0
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset]
  }
  next() {
    return this.tokens[this.pos++]
  }
  at(kind, value) {
    const t = this.peek()
    return t.kind === kind && (value === undefined || t.value === value)
  }
  expect(kind, value) {
    const t = this.next()
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Expected ${value ?? kind} but found '${t.value || t.kind}' at line ${t.line}`,
      )
    }
    return t
  }
  accept(kind, value) {
    if (this.at(kind, value)) {
      this.next()
      return true
    }
    return false
  }
  atName(...names) {
    return this.at("NAME") && names.includes(this.peek().value)
  }
  takeName() {
    const t = this.next()
    if (t.kind !== "NAME") throw new Error(`Expected name at line ${t.line}`)
    return t.value
  }

  parseSchema() {
    const defs = []
    while (!this.at("EOF")) defs.push(this.parseDefinition())
    return defs
  }

  // Optional leading description (STRING or BLOCKSTRING)
  takeDescription() {
    if (this.at("STRING") || this.at("BLOCKSTRING")) return this.next().value
    return null
  }

  parseDefinition() {
    const description = this.takeDescription()
    const t = this.peek()
    if (!this.at("NAME")) {
      throw new Error(`Expected definition at line ${t.line}, found '${t.value || t.kind}'`)
    }

    if (this.atName("schema")) return this.parseSchemaDef(description)
    if (this.atName("scalar")) return this.parseScalarDef(description)
    if (this.atName("type")) return this.parseObjectDef("object", description)
    if (this.atName("interface")) return this.parseObjectDef("interface", description)
    if (this.atName("union")) return this.parseUnionDef(description)
    if (this.atName("enum")) return this.parseEnumDef(description)
    if (this.atName("input")) return this.parseInputDef(description)
    if (this.atName("directive")) return this.parseDirectiveDef(description)
    if (this.atName("extend")) return this.parseExtension(description)

    throw new Error(`Unknown definition '${t.value}' at line ${t.line}`)
  }

  parseDirectives() {
    const dirs = []
    while (this.accept("PUNCT", "@")) {
      const name = this.takeName()
      const args = []
      if (this.accept("PUNCT", "(")) {
        // commas are insignificant in GraphQL; loop until ')'
        while (!this.at("PUNCT", ")")) args.push(this.parseInputValueDef())
        this.expect("PUNCT", ")")
      }
      dirs.push({ name, args })
    }
    return dirs
  }

  // Parses a type reference like `String!`, `[Post!]!`
  parseTypeRef() {
    let t
    if (this.accept("PUNCT", "[")) {
      const inner = this.parseTypeRef()
      this.expect("PUNCT", "]")
      t = { kind: "list", of: inner }
    } else {
      t = { kind: "named", name: this.takeName() }
    }
    if (this.accept("PUNCT", "!")) t = { kind: "nonNull", of: t }
    return t
  }

  typeRefToString(t) {
    if (t.kind === "named") return t.name
    if (t.kind === "list") return `[${this.typeRefToString(t.of)}]`
    if (t.kind === "nonNull") return `${this.typeRefToString(t.of)}!`
    return "?"
  }

  namedType(t) {
    while (t.kind !== "named") t = t.of
    return t.name
  }

  parseInputValueDef() {
    // name : Type = default
    const name = this.takeName()
    this.expect("PUNCT", ":")
    const type = this.parseTypeRef()
    let defaultValue = null
    if (this.accept("PUNCT", "=")) defaultValue = this.parseLiteral()
    const directives = this.parseDirectives()
    return { name, type, defaultValue, directives }
  }

  // Coarse literal parse — captures enough to compare defaults across schemas
  parseLiteral() {
    const t = this.peek()
    if (t.kind === "NAME") {
      this.next()
      return t.value
    }
    if (t.kind === "NUMBER") {
      this.next()
      return t.value
    }
    if (t.kind === "STRING" || t.kind === "BLOCKSTRING") {
      this.next()
      return JSON.stringify(t.value)
    }
    if (this.accept("PUNCT", "[")) {
      const items = []
      while (!this.at("PUNCT", "]")) items.push(this.parseLiteral())
      this.expect("PUNCT", "]")
      return `[${items.join(",")}]`
    }
    if (this.accept("PUNCT", "{")) {
      const fields = []
      while (!this.at("PUNCT", "}")) {
        const name = this.takeName()
        this.expect("PUNCT", ":")
        fields.push(`${name}:${this.parseLiteral()}`)
      }
      this.expect("PUNCT", "}")
      return `{${fields.join(",")}}`
    }
    if (t.kind === "PUNCT" && t.value === "-") {
      // negative number was tokenized as part of NUMBER already; fallback:
      throw new Error(`Unexpected '-' literal at line ${t.line}`)
    }
    throw new Error(`Expected literal value at line ${t.line}`)
  }

  parseFields(isInput) {
    const fields = []
    const seen = new Set()
    while (!this.at("PUNCT", "}") && !this.at("EOF")) {
      const nameTok = this.peek()
      const name = this.takeName()
      if (seen.has(name)) {
        throw new Error(`Duplicate field '${name}' at line ${nameTok.line}`)
      }
      seen.add(name)
      let field
      if (isInput) {
        this.expect("PUNCT", ":")
        const type = this.parseTypeRef()
        let defaultValue = null
        if (this.accept("PUNCT", "=")) defaultValue = this.parseLiteral()
        const directives = this.parseDirectives()
        field = { name, type, defaultValue, directives }
      } else {
        const args = []
        const argNames = new Set()
        if (this.accept("PUNCT", "(")) {
          while (!this.at("PUNCT", ")")) {
            const argTok = this.peek()
            const arg = this.parseInputValueDef()
            if (argNames.has(arg.name)) {
              throw new Error(
                `Duplicate argument '${arg.name}' on field '${name}' at line ${argTok.line}`,
              )
            }
            argNames.add(arg.name)
            args.push(arg)
          }
          this.expect("PUNCT", ")")
        }
        this.expect("PUNCT", ":")
        const type = this.parseTypeRef()
        const directives = this.parseDirectives()
        field = { name, args, type, directives }
      }
      fields.push(field)
    }
    return fields
  }

  parseSchemaDef(description) {
    this.expect("NAME", "schema")
    const operations = {}
    const directives = []
    if (this.accept("PUNCT", "{")) {
      while (!this.at("PUNCT", "}")) {
        const op = this.takeName()
        this.expect("PUNCT", ":")
        operations[op] = this.takeName()
      }
      this.expect("PUNCT", "}")
    }
    directives.push(...this.parseDirectives())
    return { kind: "schema", description, operations, directives }
  }

  parseScalarDef(description) {
    this.expect("NAME", "scalar")
    const name = this.takeName()
    const directives = this.parseDirectives()
    return { kind: "scalar", name, description, directives }
  }

  parseObjectDef(kind, description) {
    this.expect("NAME", kind === "object" ? "type" : "interface")
    const name = this.takeName()
    let interfaces = []
    if (this.accept("NAME", "implements")) {
      do {
        interfaces.push(this.takeName())
      } while (this.accept("PUNCT", "&"))
    }
    const directives = this.parseDirectives()
    let fields = []
    if (this.accept("PUNCT", "{")) {
      fields = this.parseFields(false)
      this.expect("PUNCT", "}")
    }
    return { kind, name, description, interfaces, directives, fields }
  }

  parseUnionDef(description) {
    this.expect("NAME", "union")
    const name = this.takeName()
    const directives = this.parseDirectives()
    const members = []
    if (this.accept("PUNCT", "=")) {
      do {
        members.push(this.takeName())
      } while (this.accept("PUNCT", "|"))
    }
    return { kind: "union", name, description, directives, members }
  }

  parseEnumDef(description) {
    this.expect("NAME", "enum")
    const name = this.takeName()
    const directives = this.parseDirectives()
    const values = []
    const seen = new Set()
    if (this.accept("PUNCT", "{")) {
      while (!this.at("PUNCT", "}")) {
        const valTok = this.peek()
        const valName = this.takeName()
        if (seen.has(valName)) {
          throw new Error(`Duplicate enum value '${valName}' in '${name}' at line ${valTok.line}`)
        }
        seen.add(valName)
        const directives = this.parseDirectives()
        values.push({ name: valName, directives })
      }
      this.expect("PUNCT", "}")
    }
    return { kind: "enum", name, description, directives, values }
  }

  parseInputDef(description) {
    this.expect("NAME", "input")
    const name = this.takeName()
    const directives = this.parseDirectives()
    let fields = []
    if (this.accept("PUNCT", "{")) {
      fields = this.parseFields(true)
      this.expect("PUNCT", "}")
    }
    return { kind: "input", name, description, directives, fields }
  }

  parseDirectiveDef(description) {
    this.expect("NAME", "directive")
    this.expect("PUNCT", "@")
    const name = this.takeName()
    const args = []
    if (this.accept("PUNCT", "(")) {
      while (!this.at("PUNCT", ")")) args.push(this.parseInputValueDef())
      this.expect("PUNCT", ")")
    }
    let repeatable = false
    if (this.atName("repeatable")) {
      this.next()
      repeatable = true
    }
    this.expect("NAME", "on")
    const locations = []
    do {
      if (this.accept("PUNCT", "|")) continue
      locations.push(this.takeName())
    } while (this.accept("PUNCT", "|"))
    return { kind: "directive", name, description, args, repeatable, locations }
  }

  parseExtension(description) {
    this.expect("NAME", "extend")
    const t = this.peek()
    if (this.atName("schema")) {
      const base = this.parseSchemaDef(null)
      return { ...base, kind: "schema", isExtension: true, description }
    }
    if (this.atName("scalar")) {
      const base = this.parseScalarDef(null)
      return { ...base, isExtension: true, description }
    }
    if (this.atName("type")) {
      const base = this.parseObjectDef("object", null)
      return { ...base, isExtension: true, description }
    }
    if (this.atName("interface")) {
      const base = this.parseObjectDef("interface", null)
      return { ...base, isExtension: true, description }
    }
    if (this.atName("union")) {
      const base = this.parseUnionDef(null)
      return { ...base, isExtension: true, description }
    }
    if (this.atName("enum")) {
      const base = this.parseEnumDef(null)
      return { ...base, isExtension: true, description }
    }
    if (this.atName("input")) {
      const base = this.parseInputDef(null)
      return { ...base, isExtension: true, description }
    }
    throw new Error(`Cannot extend '${t.value}' at line ${t.line}`)
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function typeKindOf(def) {
  switch (def.kind) {
    case "scalar":
      return "scalar"
    case "object":
      return "object"
    case "interface":
      return "interface"
    case "union":
      return "union"
    case "enum":
      return "enum"
    case "input":
      return "input"
    case "schema":
    case "directive":
      return null
  }
  return null
}

const isOutputKind = (k) =>
  k === "scalar" || k === "object" || k === "interface" || k === "union" || k === "enum"
const isInputKind = (k) => k === "scalar" || k === "enum" || k === "input"

function validate(defs) {
  const errors = []
  const warnings = []
  const err = (line, msg) => errors.push({ line, message: msg })
  const warn = (line, msg) => warnings.push({ line, message: msg })

  // Collect named definitions (schema/directive handled separately)
  const types = new Map() // name -> { def, line }
  const directives = new Map()
  const schemaOps = {}

  // Re-tokenize-free line lookup: defs don't carry line; use 0/unknown.
  // (Parser errors carry line numbers; semantic errors reference names.)

  for (const def of defs) {
    if (def.kind === "schema") {
      Object.assign(schemaOps, def.operations)
      continue
    }
    if (def.kind === "directive") {
      if (directives.has(def.name)) {
        err(0, `Duplicate directive definition '@${def.name}'`)
        continue
      }
      directives.set(def.name, def)
      for (const loc of def.locations) {
        if (!DIRECTIVE_LOCATIONS.has(loc)) {
          err(0, `Directive '@${def.name}' has unknown location '${loc}'`)
        }
      }
      continue
    }
    if (def.isExtension) continue // merged into base type below
    const tk = typeKindOf(def)
    if (!tk) continue
    if (types.has(def.name)) {
      err(0, `Duplicate type definition '${def.name}' (${types.get(def.name).kind} vs ${def.kind})`)
      continue
    }
    types.set(def.name, { def, kind: tk })
  }

  const resolveType = (name) =>
    BUILTIN_SCALARS.has(name) || name.startsWith(INTROSPECTION_PREFIX)
      ? { kind: "scalar", builtin: true }
      : (types.get(name) ?? null)

  // Merge extensions into base defs (fields/members/values/interfaces union)
  for (const def of defs) {
    if (!def.isExtension || def.kind === "schema") continue
    const base = types.get(def.name)
    if (!base) {
      err(0, `Extension of undefined type '${def.name}'`)
      continue
    }
    const b = base.def
    if (b.kind !== def.kind && !(b.kind === "object" && def.kind === "object")) {
      err(0, `Extension kind mismatch for '${def.name}'`)
      continue
    }
    if (Array.isArray(b.fields) && Array.isArray(def.fields)) {
      const existing = new Set(b.fields.map((f) => f.name))
      for (const f of def.fields) {
        if (existing.has(f.name)) err(0, `Extension redefines field '${def.name}.${f.name}'`)
        else b.fields.push(f)
      }
    }
    if (Array.isArray(b.members) && Array.isArray(def.members)) b.members.push(...def.members)
    if (Array.isArray(b.values) && Array.isArray(def.values)) b.values.push(...def.values)
    if (Array.isArray(b.interfaces) && Array.isArray(def.interfaces))
      b.interfaces.push(...def.interfaces)
  }

  // Per-type checks
  for (const [name, { def, kind }] of types) {
    // naming lint
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      warn(0, `Type '${name}' should be PascalCase`)
    }
    if (!def.description) warn(0, `Type '${name}' has no description`)

    if (kind === "object" || kind === "interface") {
      for (const iface of def.interfaces ?? []) {
        const target = types.get(iface)
        if (!target) {
          err(0, `'${name}' implements undefined interface '${iface}'`)
          continue
        }
        if (target.kind !== "interface") {
          err(0, `'${name}' implements '${iface}' which is not an interface`)
          continue
        }
        // object must declare all interface fields
        if (kind === "object") {
          const fieldNames = new Set((def.fields ?? []).map((f) => f.name))
          for (const f of target.def.fields ?? []) {
            if (!fieldNames.has(f.name)) {
              err(0, `'${name}' is missing interface field '${iface}.${f.name}'`)
            }
          }
        }
      }

      for (const f of def.fields ?? []) {
        if (!/^[a-z][A-Za-z0-9]*$/.test(f.name)) {
          warn(0, `Field '${name}.${f.name}' should be camelCase`)
        }
        checkOutputType(f.type, `${name}.${f.name}`)
        for (const a of f.args ?? []) {
          checkInputType(a.type, `${name}.${f.name}(${a.name}:)`)
        }
      }
    }

    if (kind === "input") {
      const seen = new Set()
      for (const f of def.fields ?? []) {
        if (seen.has(f.name)) err(0, `Duplicate input field '${name}.${f.name}'`)
        seen.add(f.name)
        checkInputType(f.type, `${name}.${f.name}`)
      }
    }

    if (kind === "union") {
      const seen = new Set()
      for (const m of def.members ?? []) {
        if (seen.has(m)) err(0, `Duplicate union member '${m}' in '${name}'`)
        seen.add(m)
        const target = types.get(m)
        if (!target) {
          err(0, `Union '${name}' references undefined type '${m}'`)
          continue
        }
        if (target.kind !== "object") {
          err(0, `Union '${name}' member '${m}' is not an object type`)
        }
      }
    }

    if (kind === "enum") {
      for (const v of def.values ?? []) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(v.name)) {
          warn(0, `Enum value '${name}.${v.name}' should be SCREAMING_SNAKE_CASE`)
        }
      }
    }
  }

  // schema operation targets must be object types
  for (const [op, target] of Object.entries(schemaOps)) {
    const t = types.get(target)
    if (!t) err(0, `Schema ${op} type '${target}' is not defined`)
    else if (t.kind !== "object") err(0, `Schema ${op} type '${target}' is not an object type`)
  }

  // directive argument types must be input types — checked via checkInputType
  // on usage sites is skipped (custom directive semantics are loose); only
  // definition arg types are verified here.
  for (const [dname, d] of directives) {
    for (const a of d.args ?? []) {
      checkInputType(a.type, `directive @${dname}(${a.name}:)`)
    }
  }

  function checkOutputType(typeRef, where) {
    const named = unwrapName(typeRef)
    const resolved = resolveType(named)
    if (!resolved) {
      err(0, `Type '${named}' referenced by ${where} is not defined`)
      return
    }
    if (resolved.kind && !resolved.builtin && !isOutputKind(resolved.kind)) {
      err(0, `${where} uses '${named}' which is an input-only type in output position`)
    }
    if (resolved.builtin && named === "ID" && /Input|Filter/.test(where)) {
      // no-op; ID is valid both ways
    }
  }

  function checkInputType(typeRef, where) {
    const named = unwrapName(typeRef)
    const resolved = resolveType(named)
    if (!resolved) {
      err(0, `Type '${named}' referenced by ${where} is not defined`)
      return
    }
    if (resolved.kind && !resolved.builtin && !isInputKind(resolved.kind)) {
      err(0, `${where} uses '${named}' which is an output-only type in input position`)
    }
  }

  function unwrapName(t) {
    while (t.kind !== "named") t = t.of
    return t.name
  }

  // Unknown applied directives (usage sites) — warn only
  for (const def of defs) {
    const applied = def.directives ?? []
    for (const d of applied) {
      if (!directives.has(d.name)) {
        warn(0, `Unknown directive '@${d.name}' applied to '${def.name ?? def.kind}'`)
      }
    }
    for (const f of def.fields ?? []) {
      for (const d of f.directives ?? []) {
        if (!directives.has(d.name))
          warn(0, `Unknown directive '@${d.name}' on '${def.name}.${f.name}'`)
      }
      for (const a of f.args ?? []) {
        for (const d of a.directives ?? []) {
          if (!directives.has(d.name)) warn(0, `Unknown directive '@${d.name}' on arg '${a.name}'`)
        }
      }
    }
  }

  return { errors, warnings, types, directives, schemaOps }
}

// ---------------------------------------------------------------------------
// Diff / breaking-change detection
// ---------------------------------------------------------------------------

function flattenForDiff(types, directives, schemaOps) {
  const out = { types: {}, directives: {}, schemaOps }
  for (const [name, { def, kind }] of types) {
    out.types[name] = {
      kind,
      fields: Object.fromEntries(
        (def.fields ?? []).map((f) => [
          f.name,
          {
            type: typeStrOf(f.type),
            args: Object.fromEntries((f.args ?? []).map((a) => [a.name, typeStrOf(a.type)])),
          },
        ]),
      ),
      members: def.members ? [...def.members].sort() : null,
      values: def.values ? def.values.map((v) => v.name).sort() : null,
      interfaces: def.interfaces ? [...def.interfaces].sort() : null,
    }
  }
  for (const [name, d] of directives) {
    out.directives[name] = {
      args: Object.fromEntries((d.args ?? []).map((a) => [a.name, typeStrOf(a.type)])),
      locations: [...d.locations].sort(),
      repeatable: d.repeatable,
    }
  }
  return out
}

function typeStrOf(t) {
  if (t.kind === "named") return t.name
  if (t.kind === "list") return `[${typeStrOf(t.of)}]`
  if (t.kind === "nonNull") return `${typeStrOf(t.of)}!`
  return "?"
}

function diffSchemas(oldFlat, newFlat) {
  const breaking = []
  const info = []

  // schema operation mapping
  for (const op of new Set([
    ...Object.keys(oldFlat.schemaOps),
    ...Object.keys(newFlat.schemaOps),
  ])) {
    const o = oldFlat.schemaOps[op]
    const n = newFlat.schemaOps[op]
    if (o !== n) {
      if (o === undefined) info.push(`Schema operation '${op}' added -> ${n}`)
      else if (n === undefined) breaking.push(`Schema operation '${op}' removed (was ${o})`)
      else breaking.push(`Schema operation '${op}' changed: ${o} -> ${n}`)
    }
  }

  // removed/changed types
  for (const [name, o] of Object.entries(oldFlat.types)) {
    const n = newFlat.types[name]
    if (!n) {
      breaking.push(`Type '${name}' (${o.kind}) removed`)
      continue
    }
    if (o.kind !== n.kind) {
      breaking.push(`Type '${name}' kind changed: ${o.kind} -> ${n.kind}`)
      continue
    }

    // fields (object/interface/input share `fields` shape)
    for (const [fname, fo] of Object.entries(o.fields)) {
      const fn = n.fields[fname]
      if (!fn) {
        breaking.push(`${o.kind} '${name}' field '${fname}' removed`)
        continue
      }
      if (fo.type !== fn.type) {
        breaking.push(`${o.kind} '${name}.${fname}' type changed: ${fo.type} -> ${fn.type}`)
      }
      for (const [aname, at] of Object.entries(fo.args)) {
        const an = fn.args[aname]
        if (!an) {
          breaking.push(`Field '${name}.${fname}' argument '${aname}' removed`)
          continue
        }
        if (at !== an) {
          breaking.push(`Argument '${name}.${fname}(${aname}:)' type changed: ${at} -> ${an}`)
        }
      }
    }
    // union members
    if (o.members && n.members) {
      const nset = new Set(n.members)
      for (const m of o.members) {
        if (!nset.has(m)) breaking.push(`Union '${name}' member '${m}' removed`)
      }
    }
    // enum values
    if (o.values && n.values) {
      const nset = new Set(n.values)
      for (const v of o.values) {
        if (!nset.has(v)) breaking.push(`Enum '${name}' value '${v}' removed`)
      }
    }
    // interfaces
    if (o.interfaces && n.interfaces) {
      const nset = new Set(n.interfaces)
      for (const i of o.interfaces) {
        if (!nset.has(i)) breaking.push(`Type '${name}' no longer implements interface '${i}'`)
      }
    }
  }

  // added types/fields — info only
  for (const [name, n] of Object.entries(newFlat.types)) {
    if (!oldFlat.types[name]) {
      info.push(`Type '${name}' (${n.kind}) added`)
      continue
    }
    const o = oldFlat.types[name]
    for (const fname of Object.keys(n.fields)) {
      if (!o.fields[fname]) info.push(`${o.kind} '${name}' field '${fname}' added`)
      else {
        const fo = o.fields[fname]
        const fn = n.fields[fname]
        for (const aname of Object.keys(fn.args)) {
          if (!fo.args[aname])
            info.push(`Argument '${name}.${fname}(${aname}:)' added (non-breaking)`)
        }
      }
    }
    if (n.members) {
      const oset = new Set(o.members ?? [])
      for (const m of n.members) if (!oset.has(m)) info.push(`Union '${name}' member '${m}' added`)
    }
    if (n.values) {
      const oset = new Set(o.values ?? [])
      for (const v of n.values) if (!oset.has(v)) info.push(`Enum '${name}' value '${v}' added`)
    }
  }

  // directives
  for (const [name, o] of Object.entries(oldFlat.directives)) {
    const n = newFlat.directives[name]
    if (!n) {
      breaking.push(`Directive '@${name}' removed`)
      continue
    }
    for (const [aname, at] of Object.entries(o.args)) {
      if (!n.args[aname]) breaking.push(`Directive '@${name}' argument '${aname}' removed`)
      else if (n.args[aname] !== at) breaking.push(`Directive '@${name}(${aname}:)' type changed`)
    }
    for (const loc of o.locations) {
      if (!n.locations.includes(loc))
        breaking.push(`Directive '@${name}' location '${loc}' removed`)
    }
  }
  for (const name of Object.keys(newFlat.directives)) {
    if (!oldFlat.directives[name]) info.push(`Directive '@${name}' added`)
  }

  return { breaking, info }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(`Usage: node scripts/graphql/validate-schema.mjs <schema.graphql> [--baseline <file>] [--allow-breaking] [--json]
       node scripts/graphql/validate-schema.mjs --demo`)
  process.exit(2)
}

function loadAndParse(path) {
  const src = readFileSync(path, "utf8")
  const tokens = tokenize(src)
  const parser = new Parser(tokens)
  return parser.parseSchema()
}

function main() {
  const args = process.argv.slice(2)
  let schemaPath = null
  let baselinePath = null
  let allowBreaking = false
  let json = false
  let demo = false

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--demo") demo = true
    else if (a === "--baseline") baselinePath = args[++i]
    else if (a === "--allow-breaking") allowBreaking = true
    else if (a === "--json") json = true
    else if (a === "--help" || a === "-h") usage()
    else if (!schemaPath) schemaPath = a
    else usage()
  }

  if (demo) schemaPath = DEMO_SCHEMA
  if (!schemaPath) usage()

  const result = { file: schemaPath, errors: [], warnings: [], breaking: [], info: [] }

  let defs
  try {
    defs = loadAndParse(schemaPath)
  } catch (e) {
    result.errors.push({ line: 0, message: `Parse error: ${e.message}` })
    emit(result, { breaking: [], info: [] }, allowBreaking, json)
    return
  }

  let validated
  try {
    validated = validate(defs)
  } catch (e) {
    result.errors.push({ line: 0, message: `Validation crash: ${e.message}` })
    emit(result, { breaking: [], info: [] }, allowBreaking, json)
    return
  }

  result.errors = validated.errors
  result.warnings = validated.warnings

  let diff = { breaking: [], info: [] }
  if (baselinePath && validated.errors.length === 0) {
    try {
      const oldDefs = loadAndParse(baselinePath)
      const oldVal = validate(oldDefs)
      const newFlat = flattenForDiff(validated.types, validated.directives, validated.schemaOps)
      const oldFlat = flattenForDiff(oldVal.types, oldVal.directives, oldVal.schemaOps)
      diff = diffSchemas(oldFlat, newFlat)
    } catch (e) {
      result.errors.push({ line: 0, message: `Baseline parse error: ${e.message}` })
    }
  }
  result.breaking = diff.breaking
  result.info = diff.info

  emit(result, diff, allowBreaking, json)
}

function emit(result, diff, allowBreaking, json) {
  const failed = result.errors.length > 0 || (diff.breaking.length > 0 && !allowBreaking)

  if (json) {
    console.log(JSON.stringify({ ...result, ok: !failed }, null, 2))
  } else {
    const p = (label, items, icon) => {
      if (!items.length) return
      console.log(`\n${label} (${items.length}):`)
      for (const it of items) {
        if (typeof it === "string") {
          console.log(`  ${icon} ${it}`)
          continue
        }
        const line = it.line ? `:${it.line}` : ""
        console.log(`  ${icon} ${it.message}${line ? ` [line ${it.line}]` : ""}`)
      }
    }
    p("ERRORS", result.errors, "✗")
    p("WARNINGS", result.warnings, "!")
    p("BREAKING CHANGES", result.breaking, "✗")
    p("INFO", result.info, "·")
    if (
      !result.errors.length &&
      !result.warnings.length &&
      !result.breaking.length &&
      !result.info.length
    ) {
      console.log("No issues found.")
    }
    console.log(
      `\nSummary: ${result.errors.length} error(s), ${result.warnings.length} warning(s), ` +
        `${result.breaking.length} breaking change(s), ${result.info.length} info.`,
    )
  }
  process.exit(failed ? 1 : 0)
}

main()
