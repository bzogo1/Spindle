import { z } from "zod"

import { logger } from "@/lib/logger"

/**
 * Editable email-template store for the `/app/admin/email-templates` screen.
 *
 * A template is plain text: a `subject` and a `body` that may embed
 * `{{variable}}` placeholders (e.g. `Hi {{name}},`). `renderTemplate`
 * substitutes values at preview/send time — missing variables render as an
 * empty string (documented choice: previews stay readable instead of showing
 * raw `{{placeholders}}`). Nothing is HTML-escaped because the output is
 * plain text; callers that wrap it in HTML must escape it themselves.
 *
 * DEVELOPMENT SEAM: templates live in a process-local `Map`, the same
 * interim-store pattern as `newsletter-store.ts` / `email-series.ts`. On
 * multi-instance/serverless deploys each instance keeps its own copy and
 * everything is lost on restart — the upgrade path is an `EmailTemplate`
 * table. The exported function signatures are already shaped for that swap.
 *
 * NOT WIRED INTO SEND PATHS: `src/emails/templates.ts` and `src/lib/email.ts`
 * are untouched by design — this store is an editing/preview surface only.
 * Wiring a saved template into a send path is a separate task.
 *
 * Server-only in practice: imported by route handlers and tests; client
 * components must not import it.
 */

export const EMAIL_TEMPLATES_MAX = 200
export const EMAIL_TEMPLATE_SUBJECT_MAX = 200
export const EMAIL_TEMPLATE_BODY_MAX = 50_000
export const EMAIL_TEMPLATE_NAME_MAX = 120

/**
 * Placeholder syntax: `{{name}}` where `name` is `[A-Za-z_][A-Za-z0-9_]*`.
 * Surrounding whitespace inside the braces is tolerated (`{{ name }}`).
 */
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export interface EditableTemplate {
  id: string
  name: string
  subject: string
  /** Plain-text body; may contain `{{variable}}` placeholders. */
  body: string
  /** Variable names extracted from `subject` + `body`, first-appearance order. */
  variables: string[]
  /** ISO timestamps. */
  createdAt: string
  updatedAt: string
}

export class EmailTemplateError extends Error {
  readonly code: "invalid" | "store_full"
  constructor(code: "invalid" | "store_full", message: string) {
    super(message)
    this.name = "EmailTemplateError"
    this.code = code
  }
}

/**
 * Input schema for `createTemplate`. `variables` is not accepted — it is
 * derived from `subject`/`body` by `extractVariables`.
 */
export const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(EMAIL_TEMPLATE_NAME_MAX, "Name is too long."),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required.")
    .max(EMAIL_TEMPLATE_SUBJECT_MAX, "Subject is too long."),
  body: z.string().min(1, "Body is required.").max(EMAIL_TEMPLATE_BODY_MAX, "Body is too long."),
})

/** Patch schema for `updateTemplate`; at least one field must be present. */
export const updateTemplateSchema = z
  .object({
    name: createTemplateSchema.shape.name.optional(),
    subject: createTemplateSchema.shape.subject.optional(),
    body: createTemplateSchema.shape.body.optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.subject !== undefined || value.body !== undefined,
    { message: "Provide at least one of name, subject, or body." },
  )

export const EMAIL_TEMPLATE_VAR_VALUE_MAX = 2_000

/** Schema for the preview endpoint: ad-hoc subject/body plus variable values. */
export const previewTemplateSchema = z.object({
  subject: z.string().max(EMAIL_TEMPLATE_SUBJECT_MAX, "Subject is too long."),
  body: z.string().max(EMAIL_TEMPLATE_BODY_MAX, "Body is too long."),
  vars: z
    .record(z.string(), z.string().max(EMAIL_TEMPLATE_VAR_VALUE_MAX, "Variable value is too long."))
    .optional(),
})

/**
 * Returns the distinct `{{variable}}` names in `text`, in first-appearance
 * order. Used for both the stored `variables` list and the preview payload.
 */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

/**
 * Renders a template (or ad-hoc subject/body) by substituting `{{var}}`
 * placeholders with `vars[var]`. Missing variables render as an empty
 * string — previews stay readable and send-path callers decide how to handle
 * unset values. No HTML escaping: output is plain text.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  vars: Record<string, string> = {},
): { subject: string; body: string } {
  // `Object.hasOwn` (not `vars[name] ?? ""`) so placeholder names that collide
  // with `Object.prototype` members — `{{toString}}`, `{{constructor}}`,
  // `{{__proto__}}` are all valid per VARIABLE_PATTERN — render as "" like any
  // other missing variable instead of leaking prototype members into output.
  const substitute = (text: string) =>
    text.replace(VARIABLE_PATTERN, (_match, name: string) =>
      Object.hasOwn(vars, name) ? (vars[name] ?? "") : "",
    )
  return {
    subject: substitute(template.subject),
    body: substitute(template.body),
  }
}

const templates = new Map<string, EditableTemplate>() // id → record, insertion order
let seeded = false

function templateId(): string {
  return `tpl_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone(template: EditableTemplate): EditableTemplate {
  return { ...template, variables: [...template.variables] }
}

function variablesFor(subject: string, body: string): string[] {
  return extractVariables(`${subject}\n${body}`)
}

/**
 * Starter templates with deterministic ids, inserted once per process so the
 * editor is not empty. `seedStarterTemplates` is idempotent — it only fills
 * ids that are absent, so it is safe to call repeatedly (and after a test
 * reset).
 */
const SEED_TEMPLATES: ReadonlyArray<{
  id: string
  name: string
  subject: string
  body: string
}> = [
  {
    id: "tpl_seed_welcome",
    name: "Welcome",
    subject: "Welcome to Spindle, {{name}}",
    body: "Hi {{name}},\n\nYour Spindle account is ready. Open the dashboard to create your first workspace: {{appUrl}}\n\n— The Spindle team",
  },
  {
    id: "tpl_seed_password_reset",
    name: "Password reset",
    subject: "Reset your Spindle password",
    body: "Hi {{name}},\n\nUse this link to reset your password. It expires in {{expiresIn}} and can be used once:\n\n{{resetUrl}}\n\nIf you did not request this, ignore this email.",
  },
  {
    id: "tpl_seed_weekly_digest",
    name: "Weekly digest",
    subject: "Your Spindle digest — {{count}} notifications",
    body: "Hi {{name}},\n\nYou have {{count}} new notifications this week.\n\nView them here: {{notificationsUrl}}\n\nYou can change digest frequency in your notification settings.",
  },
]

/**
 * Inserts any missing starter templates and returns the store size. Safe to
 * call from read paths; idempotent via the deterministic seed ids.
 */
export function seedStarterTemplates(): number {
  ensureSeeded()
  const now = nowIso()
  for (const seed of SEED_TEMPLATES) {
    if (templates.has(seed.id)) continue
    templates.set(seed.id, {
      id: seed.id,
      name: seed.name,
      subject: seed.subject,
      body: seed.body,
      variables: variablesFor(seed.subject, seed.body),
      createdAt: now,
      updatedAt: now,
    })
  }
  seeded = true
  return templates.size
}

function ensureSeeded(): void {
  if (seeded) return
  seeded = true
  seedStarterTemplates()
}

/**
 * Validates and stores a new template. Throws `EmailTemplateError`
 * (`"invalid"` on schema failure). The store is bounded at
 * `EMAIL_TEMPLATES_MAX`; when full, the oldest entry (first in insertion
 * order) is evicted to make room, so creation never fails on capacity —
 * the `"store_full"` error code is retained on the type for forward
 * compatibility but is not thrown today.
 */
export function createTemplate(input: unknown): EditableTemplate {
  ensureSeeded()
  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid template."
    throw new EmailTemplateError("invalid", message)
  }

  if (templates.size >= EMAIL_TEMPLATES_MAX) {
    const oldest = templates.keys().next().value
    if (oldest !== undefined) templates.delete(oldest)
  }

  const data = parsed.data
  const now = nowIso()
  const template: EditableTemplate = {
    id: templateId(),
    name: data.name,
    subject: data.subject,
    body: data.body,
    variables: variablesFor(data.subject, data.body),
    createdAt: now,
    updatedAt: now,
  }
  templates.set(template.id, template)
  logger.info({ event: "email_template.created", id: template.id }, "Email template created")
  return clone(template)
}

/** Returns all templates newest-updated first. */
export function listTemplates(): EditableTemplate[] {
  ensureSeeded()
  return [...templates.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
    .map(clone)
}

/** Returns one template by id, or null when unknown. */
export function getTemplate(id: string): EditableTemplate | null {
  ensureSeeded()
  const template = templates.get(id)
  return template ? clone(template) : null
}

/**
 * Applies a partial update. `variables` is recomputed whenever `subject` or
 * `body` changes. Returns the updated template, or null when the id is
 * unknown. Throws `EmailTemplateError` (`"invalid"`) on schema failure.
 */
export function updateTemplate(id: string, patch: unknown): EditableTemplate | null {
  ensureSeeded()
  const parsed = updateTemplateSchema.safeParse(patch)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid template update."
    throw new EmailTemplateError("invalid", message)
  }

  const existing = templates.get(id)
  if (!existing) return null

  const data = parsed.data
  const subject = data.subject ?? existing.subject
  const body = data.body ?? existing.body
  existing.name = data.name ?? existing.name
  existing.subject = subject
  existing.body = body
  existing.variables = variablesFor(subject, body)
  existing.updatedAt = nowIso()
  return clone(existing)
}

/** Deletes a template. Returns true when a record was removed. */
export function deleteTemplate(id: string): boolean {
  ensureSeeded()
  return templates.delete(id)
}

/**
 * Test hook: clears all templates. By default starter seeding stays
 * suppressed (tests start empty); pass `{ seed: true }` to re-arm lazy
 * seeding so the next store access inserts the starter set.
 */
export function resetEmailTemplateStoreForTests(options?: { seed?: boolean }): void {
  templates.clear()
  seeded = options?.seed !== true
}
