/**
 * Agent run templates — prompt + config presets that instantiate recorded
 * runs. The built-in registry ships a small set of common presets; the
 * marketplace module (`marketplace.ts`) layers user-installed templates on
 * top through the same shape.
 */

import { nextOpsId, type AgentRunRecord } from "./types"

export interface AgentRunTemplateConfig {
  model?: string
  temperature?: number
  maxSteps?: number
  /** Tags stamped onto every run instantiated from this template. */
  tags?: string[]
  /** Default retention window (days) for compliance/audit tooling. */
  retentionDays?: number
}

export interface AgentRunTemplate {
  id: string
  name: string
  version: number
  description: string
  category: string
  prompt: string
  config: AgentRunTemplateConfig
  /** Where the template came from: "builtin" or a marketplace listing id. */
  source?: string
  featured?: boolean
}

/** Built-in template registry. Order is the gallery order. */
export const BUILTIN_AGENT_RUN_TEMPLATES: readonly AgentRunTemplate[] = [
  {
    id: "tpl.code-review",
    name: "Code review",
    version: 1,
    description: "Review a diff or file for correctness, style, and security issues.",
    category: "engineering",
    prompt:
      "Review the provided change for correctness, readability, and security. " +
      "List findings ordered by severity with file/line references.",
    config: { model: "reviewer-large", maxSteps: 12, tags: ["review", "engineering"] },
    source: "builtin",
    featured: true,
  },
  {
    id: "tpl.docs-summarizer",
    name: "Docs summarizer",
    version: 1,
    description: "Condense long documentation into a short executive summary.",
    category: "docs",
    prompt:
      "Summarize the attached documentation in under 200 words. " +
      "Lead with the key takeaways, then list open questions.",
    config: { model: "writer-small", maxSteps: 6, tags: ["docs", "summarize"] },
    source: "builtin",
    featured: true,
  },
  {
    id: "tpl.test-generator",
    name: "Test generator",
    version: 1,
    description: "Draft unit tests covering the happy path and edge cases.",
    category: "engineering",
    prompt:
      "Write unit tests for the provided module. Cover the happy path, " +
      "boundary conditions, and at least two failure modes.",
    config: { model: "coder-large", maxSteps: 15, tags: ["testing", "engineering"] },
    source: "builtin",
  },
  {
    id: "tpl.data-explainer",
    name: "Data explainer",
    version: 2,
    description: "Turn a dataset or query result into a plain-language narrative.",
    category: "data",
    prompt:
      "Explain the dataset below for a non-technical stakeholder. " +
      "Highlight trends, outliers, and anything that looks like a data-quality issue.",
    config: { model: "analyst-medium", maxSteps: 8, tags: ["data", "reporting"] },
    source: "builtin",
  },
  {
    id: "tpl.incident-triage",
    name: "Incident triage",
    version: 1,
    description: "Classify an incident report and propose first-response steps.",
    category: "ops",
    prompt:
      "Triage the incident report: severity, blast radius, likely cause, " +
      "and the first three mitigation steps. Flag anything needing approval.",
    config: { model: "ops-large", maxSteps: 10, retentionDays: 365, tags: ["ops", "incident"] },
    source: "builtin",
    featured: true,
  },
]

const registry = new Map<string, AgentRunTemplate>()
for (const template of BUILTIN_AGENT_RUN_TEMPLATES) registry.set(template.id, template)

export function listAgentRunTemplates(): AgentRunTemplate[] {
  return [...registry.values()]
}

export function getAgentRunTemplate(id: string): AgentRunTemplate | null {
  return registry.get(id) ?? null
}

/** Register (or replace) a template — used by marketplace installs. */
export function registerAgentRunTemplate(template: AgentRunTemplate): void {
  registry.set(template.id, template)
}

export function unregisterAgentRunTemplate(id: string): boolean {
  return registry.delete(id)
}

/** Templates grouped by category, preserving registry order within groups. */
export function groupAgentRunTemplatesByCategory(
  templates: readonly AgentRunTemplate[] = listAgentRunTemplates(),
): Map<string, AgentRunTemplate[]> {
  const groups = new Map<string, AgentRunTemplate[]>()
  for (const template of templates) {
    const list = groups.get(template.category) ?? []
    list.push(template)
    groups.set(template.category, list)
  }
  return groups
}

export interface InstantiateRunOptions {
  /** Override the prompt recorded on the run (e.g. user edits before launch). */
  prompt?: string
  /** Extra tags merged with the template's configured tags. */
  extraTags?: string[]
  projectId?: string
  projectName?: string
  actor?: string
  now?: Date
}

/**
 * Create a fresh `queued` run record from a template. The template's config
 * seeds model, tags, and retention; the prompt override wins over the
 * template prompt when provided.
 */
export function instantiateRunFromTemplate(
  template: AgentRunTemplate,
  options: InstantiateRunOptions = {},
): AgentRunRecord {
  const now = (options.now ?? new Date()).toISOString()
  const tags = [...(template.config.tags ?? []), ...(options.extraTags ?? [])]
  return {
    id: nextOpsId("run"),
    prompt: options.prompt ?? template.prompt,
    status: "queued",
    model: template.config.model,
    projectId: options.projectId,
    projectName: options.projectName,
    actor: options.actor,
    createdAt: now,
    steps: [],
    events: [],
    metrics: { model: template.config.model },
    tags: [...new Set(tags)],
    retentionDays: template.config.retentionDays,
    templateId: template.id,
    templateVersion: template.version,
  }
}
