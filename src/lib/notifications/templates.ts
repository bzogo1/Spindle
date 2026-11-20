import type { NotificationEventType } from "./events"

/**
 * Notification templates.
 *
 * Predefined copy for the events producers actually emit — run finished /
 * failed, automation triggered, snapshot diff ready, mentions, and a few
 * workspace staples. Templates use `{{variable}}` placeholders; every
 * variable declares an `example` so `renderNotificationTemplate(template)`
 * with no overrides produces a ready-to-send demo notification (used by the
 * "send test notification" control in preferences).
 *
 * Isomorphic: no React, no DOM.
 */

export interface NotificationTemplateVariable {
  /** Placeholder name inside `{{...}}`. */
  key: string
  /** Human label for future variable-picking UI. */
  label: string
  /** Value used when the caller does not supply one. */
  example: string
}

export interface NotificationTemplate {
  id: string
  label: string
  description: string
  type: NotificationEventType
  /** Category tag applied to rendered notifications (must match AppNotificationCategory values in use). */
  category?: string
  title: string
  body: string
  href?: string
  variables: readonly NotificationTemplateVariable[]
}

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  {
    id: "run-finished",
    label: "Agent run finished",
    description: "An agent run completed successfully.",
    type: "success",
    category: "agent",
    title: "Run {{runName}} finished",
    body: "Agent run **{{runName}}** completed in {{duration}}.",
    href: "/app/agent/{{runId}}",
    variables: [
      { key: "runName", label: "Run name", example: "Nightly diff" },
      { key: "runId", label: "Run id", example: "run_042" },
      { key: "duration", label: "Duration", example: "4m 12s" },
    ],
  },
  {
    id: "run-failed",
    label: "Agent run failed",
    description: "An agent run ended with an error.",
    type: "error",
    category: "agent",
    title: "Run {{runName}} failed",
    body: "Agent run **{{runName}}** stopped with an error: {{error}}.",
    href: "/app/agent/{{runId}}",
    variables: [
      { key: "runName", label: "Run name", example: "Nightly diff" },
      { key: "runId", label: "Run id", example: "run_042" },
      { key: "error", label: "Error summary", example: "2 unresolved comments" },
    ],
  },
  {
    id: "automation-triggered",
    label: "Automation triggered",
    description: "A scheduled automation fired.",
    type: "info",
    category: "automation",
    title: "Automation {{automationName}} triggered",
    body: "The **{{automationName}}** automation ran on its schedule.",
    href: "/app/automations",
    variables: [{ key: "automationName", label: "Automation name", example: "Weekly report" }],
  },
  {
    id: "snapshot-diff-ready",
    label: "Snapshot diff ready",
    description: "A lab snapshot comparison finished.",
    type: "success",
    category: "lab",
    title: "Snapshot diff ready for {{snapshotName}}",
    body: "The diff for **{{snapshotName}}** is ready to review.",
    href: "/app/lab",
    variables: [{ key: "snapshotName", label: "Snapshot name", example: "Wave tank v3" }],
  },
  {
    id: "lab-session-completed",
    label: "Lab session completed",
    description: "A lab session finished and results are available.",
    type: "success",
    category: "lab",
    title: "Lab session {{sessionName}} completed",
    body: "Results for **{{sessionName}}** are ready to inspect.",
    href: "/app/lab",
    variables: [{ key: "sessionName", label: "Session name", example: "Calibration run" }],
  },
  {
    id: "mention",
    label: "Mention",
    description: "Someone mentioned you in chat.",
    type: "info",
    category: "mentions",
    title: "{{author}} mentioned you",
    body: "{{author}} mentioned you in **{{channel}}**: “{{excerpt}}”",
    href: "/app/chat",
    variables: [
      { key: "author", label: "Author", example: "Ada" },
      { key: "channel", label: "Channel", example: "coastal-resilience" },
      { key: "excerpt", label: "Message excerpt", example: "can you review the diff?" },
    ],
  },
  {
    id: "storage-warning",
    label: "Storage warning",
    description: "Workspace storage is nearing its limit.",
    type: "warning",
    category: "activity",
    title: "Storage is nearing the workspace limit",
    body: "**{{projectName}}** is using most of the available file storage.",
    href: "/app/settings",
    variables: [{ key: "projectName", label: "Project name", example: "Coastal resilience" }],
  },
  {
    id: "scheduled-reminder",
    label: "Scheduled reminder",
    description: "A reminder the user scheduled earlier.",
    type: "info",
    category: "activity",
    title: "Reminder: {{title}}",
    body: "{{body}}",
    variables: [
      { key: "title", label: "Reminder title", example: "Review the quarterly report" },
      { key: "body", label: "Reminder body", example: "Due end of week." },
    ],
  },
]

export function getNotificationTemplate(id: string): NotificationTemplate | undefined {
  return NOTIFICATION_TEMPLATES.find((template) => template.id === id)
}

export interface RenderedNotificationTemplate {
  type: NotificationEventType
  title: string
  body: string
  href?: string
  category?: string
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g

function interpolate(template: string, resolve: (key: string) => string | undefined): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => resolve(key) ?? "")
}

/** Collapse the whitespace an empty substitution can leave behind. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Render a template with caller-supplied variables. Missing values fall back
 * to each variable's `example`, then to an empty string — rendering with no
 * variables always succeeds and produces demo-ready copy.
 */
export function renderNotificationTemplate(
  template: NotificationTemplate,
  variables?: Record<string, string>,
): RenderedNotificationTemplate {
  const examples = new Map(template.variables.map((variable) => [variable.key, variable.example]))
  const resolve = (key: string) => variables?.[key] ?? examples.get(key)

  const rendered: RenderedNotificationTemplate = {
    type: template.type,
    title: tidy(interpolate(template.title, resolve)),
    body: tidy(interpolate(template.body, resolve)),
  }
  const href = template.href ? interpolate(template.href, resolve).trim() : ""
  if (href) rendered.href = href
  if (template.category) rendered.category = template.category
  return rendered
}
