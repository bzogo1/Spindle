/**
 * Shareable automation links and config export for the automations panel.
 *
 * The flattened studio config (the same shape every creation mode produces)
 * is encoded into a single `automation` URL param as base64url JSON, so a
 * copied link reopens the create dialog pre-filled with the same config —
 * same self-contained-link convention as `dashboard-share.ts`. The payload
 * is versioned and every field is re-validated on decode, so hand-edited or
 * stale links degrade to "invalid link" instead of crashing the dialog.
 */

import { stringify as stringifyYaml } from "yaml"

import type { AutomationSchedule } from "@/lib/automations/schedule"

export const AUTOMATION_SHARE_PARAM = "automation"
export const AUTOMATION_SHARE_VERSION = 1

export type AutomationShareMode = "ask" | "build" | "cron" | "graph"
export type AutomationShareTriggerKind = "schedule" | "event" | "webhook"
export type AutomationShareStepKind = "trigger" | "condition" | "action"

export interface AutomationShareStep {
  kind: AutomationShareStepKind
  label: string
  detail?: string
}

/** JSON-safe snapshot of everything needed to recreate an automation. */
export interface AutomationShareConfig {
  version: number
  name: string
  triggerKind: AutomationShareTriggerKind
  /** Human-readable trigger summary shown in the table. */
  triggerDetail: string
  /** Cron expression for schedule triggers. */
  triggerMeta?: string
  /** Event name for event triggers. */
  eventName?: string
  /** Endpoint URL for webhook triggers. */
  webhookUrl?: string
  actionKey: string
  actionLabel: string
  prompt: string
  /** Creation mode the config was authored in; seeds the matching tab. */
  mode: AutomationShareMode
  schedule?: AutomationSchedule
  steps: AutomationShareStep[]
}

/**
 * Structural subset of the panel's `Automation` record — declared here so the
 * share module stays decoupled from the component file.
 */
export interface ShareableAutomation {
  name: string
  actionKey?: string
  actionLabel: string
  prompt: string
  trigger: {
    kind: AutomationShareTriggerKind
    label?: string
    detail: string
    meta?: string
  }
  schedule?: AutomationSchedule
  steps?: Array<{ kind: AutomationShareStepKind; label: string; detail?: string }>
  createdVia?: AutomationShareMode
}

const TRIGGER_KINDS: readonly AutomationShareTriggerKind[] = ["schedule", "event", "webhook"]
const SHARE_MODES: readonly AutomationShareMode[] = ["ask", "build", "cron", "graph"]
const STEP_KINDS: readonly AutomationShareStepKind[] = ["trigger", "condition", "action"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  if (!isRecord(value)) return false
  if (value.kind === "cron") return typeof value.expr === "string" && value.expr.trim() !== ""
  if (value.kind === "interval") {
    return (
      typeof value.every === "number" &&
      Number.isInteger(value.every) &&
      (value.unit === "minutes" || value.unit === "hours" || value.unit === "days")
    )
  }
  return false
}

/** Flatten an automation row into the shareable config payload. */
export function automationToShareConfig(automation: ShareableAutomation): AutomationShareConfig {
  const triggerKind = TRIGGER_KINDS.includes(automation.trigger.kind)
    ? automation.trigger.kind
    : "event"
  return {
    version: AUTOMATION_SHARE_VERSION,
    name: automation.name,
    triggerKind,
    triggerDetail: automation.trigger.detail,
    triggerMeta: optionalString(automation.trigger.meta),
    eventName: triggerKind === "event" ? optionalString(automation.trigger.meta) : undefined,
    webhookUrl: triggerKind === "webhook" ? optionalString(automation.trigger.meta) : undefined,
    actionKey: automation.actionKey ?? "agent-task",
    actionLabel: automation.actionLabel,
    prompt: automation.prompt,
    // Webhook triggers only exist in the graph model; everything else falls
    // back to the cron tab when no creation mode was recorded.
    mode:
      automation.createdVia ??
      (triggerKind === "webhook" ? "graph" : triggerKind === "event" ? "build" : "cron"),
    schedule: automation.schedule,
    steps: (automation.steps ?? []).map((step) => ({
      kind: step.kind,
      label: step.label,
      detail: optionalString(step.detail),
    })),
  }
}

/* ------------------------------------------------------------------------ */
/* base64url codec                                                           */
/* ------------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeAutomationShare(config: AutomationShareConfig): string {
  const json = JSON.stringify(config)
  return bytesToBase64Url(new TextEncoder().encode(json))
}

/**
 * Decode a share param back into a config. Returns `null` for anything that
 * isn't a versioned, well-formed payload — callers treat that as "invalid
 * shared link".
 */
export function decodeAutomationShare(value: string): AutomationShareConfig | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)))
    if (!isRecord(parsed) || parsed.version !== AUTOMATION_SHARE_VERSION) return null
    if (typeof parsed.name !== "string" || parsed.name.trim() === "") return null
    if (!TRIGGER_KINDS.includes(parsed.triggerKind as AutomationShareTriggerKind)) return null
    if (!SHARE_MODES.includes(parsed.mode as AutomationShareMode)) return null
    if (typeof parsed.actionLabel !== "string" || typeof parsed.prompt !== "string") return null

    const steps = Array.isArray(parsed.steps)
      ? parsed.steps
          .filter(
            (step): step is Record<string, unknown> =>
              isRecord(step) &&
              STEP_KINDS.includes(step.kind as AutomationShareStepKind) &&
              typeof step.label === "string" &&
              step.label.trim() !== "",
          )
          .map((step) => ({
            kind: step.kind as AutomationShareStepKind,
            label: step.label as string,
            detail: optionalString(step.detail),
          }))
      : []

    return {
      version: AUTOMATION_SHARE_VERSION,
      name: parsed.name,
      triggerKind: parsed.triggerKind as AutomationShareTriggerKind,
      triggerDetail: typeof parsed.triggerDetail === "string" ? parsed.triggerDetail : "",
      triggerMeta: optionalString(parsed.triggerMeta),
      eventName: optionalString(parsed.eventName),
      webhookUrl: optionalString(parsed.webhookUrl),
      actionKey: typeof parsed.actionKey === "string" ? parsed.actionKey : "agent-task",
      actionLabel: parsed.actionLabel,
      prompt: parsed.prompt,
      mode: parsed.mode as AutomationShareMode,
      schedule: isAutomationSchedule(parsed.schedule) ? parsed.schedule : undefined,
      steps,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------ */
/* URLs + file export                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Build a shareable URL for `config` from the current page URL, preserving
 * unrelated params (e.g. `?project=` from the project switcher). Evaluated
 * lazily by callers so `window` is only touched in the browser.
 */
export function automationShareHref(config: AutomationShareConfig, currentUrl?: string): string {
  const base = currentUrl ?? (typeof window === "undefined" ? "" : window.location.href)
  const url = new URL(base || "http://localhost/")
  url.searchParams.set(AUTOMATION_SHARE_PARAM, encodeAutomationShare(config))
  return url.toString()
}

/** Read and decode the share param from a `location.search` string. */
export function readAutomationShareParam(search: string): AutomationShareConfig | null {
  const raw = new URLSearchParams(search).get(AUTOMATION_SHARE_PARAM)
  return raw ? decodeAutomationShare(raw) : null
}

function slugifyFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "automation"
}

export type AutomationExportFormat = "json" | "yaml"

/** Serialize the share config as pretty JSON or YAML for file export. */
export function serializeAutomationConfig(
  config: AutomationShareConfig,
  format: AutomationExportFormat,
): string {
  if (format === "yaml") return stringifyYaml(config)
  return JSON.stringify(config, null, 2)
}

/** Download `config` as `<slug>-automation.json|yaml`. */
export function downloadAutomationConfig(
  config: AutomationShareConfig,
  format: AutomationExportFormat,
) {
  const source = serializeAutomationConfig(config, format)
  const mime = format === "yaml" ? "application/yaml" : "application/json"
  const blob = new Blob([source], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${slugifyFileName(config.name)}-automation.${format}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
