import type { NodeTypeDef } from "./types"

/**
 * The fixed catalog of node types available in the builder. Keeping this a
 * static registry (rather than user-defined node types) lets the canvas,
 * inspector, validator, codegen, and dry-run engine share one source of truth.
 */
export const NODE_TYPES: readonly NodeTypeDef[] = [
  {
    type: "trigger.schedule",
    label: "Schedule trigger",
    category: "trigger",
    description: "Starts the automation on a cron schedule.",
    inputs: [],
    outputs: [{ id: "out", type: "json", label: "payload" }],
    configFields: [
      {
        key: "cron",
        label: "Cron expression",
        kind: "text",
        placeholder: "0 9 * * 1",
        required: true,
        hint: "Five-field cron, e.g. 0 9 * * 1 for Mondays at 09:00.",
      },
      {
        key: "payload",
        label: "Sample payload (JSON)",
        kind: "textarea",
        placeholder: '{"source": "schedule"}',
        hint: "Optional JSON used as the trigger output during dry runs.",
      },
    ],
    defaultConfig: { cron: "0 9 * * *", payload: "" },
  },
  {
    type: "trigger.event",
    label: "Event trigger",
    category: "trigger",
    description: "Starts the automation when a workspace event is emitted.",
    inputs: [],
    outputs: [{ id: "out", type: "json", label: "event" }],
    configFields: [
      {
        key: "event",
        label: "Event name",
        kind: "text",
        placeholder: "file.uploaded",
        required: true,
      },
      {
        key: "payload",
        label: "Sample payload (JSON)",
        kind: "textarea",
        placeholder: '{"file": "survey.csv"}',
        hint: "Optional JSON used as the trigger output during dry runs.",
      },
    ],
    defaultConfig: { event: "file.uploaded", payload: "" },
  },
  {
    type: "trigger.webhook",
    label: "Webhook trigger",
    category: "trigger",
    description: "Starts the automation when an inbound webhook delivery arrives.",
    inputs: [],
    outputs: [{ id: "out", type: "json", label: "payload" }],
    configFields: [
      {
        key: "url",
        label: "Endpoint URL",
        kind: "text",
        placeholder: "https://api.example.com/hooks/automation",
        required: true,
        hint: "Absolute http(s) URL that receives the inbound deliveries.",
      },
      {
        key: "secret",
        label: "Signing secret",
        kind: "text",
        placeholder: "whsec_…",
        hint: "Optional HMAC-SHA256 secret used to verify inbound signatures.",
      },
      {
        key: "events",
        label: "Event names",
        kind: "text",
        placeholder: "file.uploaded, deploy.finished",
        hint: "Optional comma-separated event names; leave empty to accept every delivery.",
      },
      {
        key: "payload",
        label: "Sample payload (JSON)",
        kind: "textarea",
        placeholder: '{"event": "deploy.finished"}',
        hint: "Optional JSON used as the trigger output during dry runs.",
      },
    ],
    defaultConfig: { url: "", secret: "", events: "", payload: "" },
  },
  {
    type: "transform",
    label: "Transform",
    category: "transform",
    description: "Reshapes the incoming value before passing it downstream.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "any", label: "out" }],
    configFields: [
      {
        key: "operation",
        label: "Operation",
        kind: "select",
        options: [
          { value: "identity", label: "Pass through" },
          { value: "uppercase", label: "Uppercase string" },
          { value: "json", label: "Serialize to JSON" },
          { value: "template", label: "Wrap in template" },
        ],
      },
      {
        key: "template",
        label: "Template",
        kind: "text",
        placeholder: "result: {{input}}",
        hint: "Used by the “Wrap in template” operation. {{input}} is replaced by the incoming value.",
      },
    ],
    defaultConfig: { operation: "identity", template: "{{input}}" },
  },
  {
    type: "condition",
    label: "Condition",
    category: "logic",
    description: "Routes the incoming value down the true or false branch.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [
      { id: "true", type: "any", label: "true" },
      { id: "false", type: "any", label: "false" },
    ],
    configFields: [
      {
        key: "field",
        label: "Field path",
        kind: "text",
        placeholder: "status",
        hint: "Dot path into the incoming object. Leave empty to test the value itself.",
      },
      {
        key: "operator",
        label: "Operator",
        kind: "select",
        options: [
          { value: "equals", label: "equals" },
          { value: "not-equals", label: "does not equal" },
          { value: "contains", label: "contains" },
          { value: "greater-than", label: "is greater than" },
          { value: "less-than", label: "is less than" },
          { value: "truthy", label: "is truthy" },
        ],
      },
      {
        key: "value",
        label: "Compare value",
        kind: "text",
        placeholder: "ok",
        hint: "Not used by the “is truthy” operator.",
      },
    ],
    defaultConfig: { field: "", operator: "equals", value: "" },
  },
  {
    type: "action.post-summary",
    label: "Post run summary",
    category: "action",
    description: "Posts a summary of the run to the workspace feed.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "json", label: "result" }],
    configFields: [
      {
        key: "channel",
        label: "Channel",
        kind: "text",
        placeholder: "#project-updates",
      },
      {
        key: "simulateError",
        label: "Simulate failure in dry runs",
        kind: "boolean",
      },
    ],
    defaultConfig: { channel: "#project-updates", simulateError: false },
  },
  {
    type: "action.update-files",
    label: "Update project files",
    category: "action",
    description: "Writes normalized output back into the project index.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "json", label: "result" }],
    configFields: [
      {
        key: "target",
        label: "Target path",
        kind: "text",
        placeholder: "results/summary.json",
      },
      {
        key: "simulateError",
        label: "Simulate failure in dry runs",
        kind: "boolean",
      },
    ],
    defaultConfig: { target: "results/summary.json", simulateError: false },
  },
  {
    type: "action.log",
    label: "Write log entry",
    category: "action",
    description: "Appends a structured entry to the automation run log.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "json", label: "result" }],
    configFields: [
      {
        key: "level",
        label: "Level",
        kind: "select",
        options: [
          { value: "info", label: "Info" },
          { value: "warn", label: "Warning" },
          { value: "error", label: "Error" },
        ],
      },
      {
        key: "message",
        label: "Message",
        kind: "textarea",
        placeholder: "Automation step completed",
        required: true,
      },
      {
        key: "simulateError",
        label: "Simulate failure in dry runs",
        kind: "boolean",
      },
    ],
    defaultConfig: { level: "info", message: "", simulateError: false },
  },
  {
    type: "action.webhook",
    label: "Send webhook",
    category: "action",
    description: "Delivers the incoming value to an external endpoint.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "json", label: "result" }],
    configFields: [
      {
        key: "url",
        label: "Endpoint URL",
        kind: "text",
        placeholder: "https://api.example.com/hooks/run",
        required: true,
        hint: "Absolute http(s) URL that receives the delivery.",
      },
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
        ],
      },
      {
        key: "secret",
        label: "Signing secret",
        kind: "text",
        placeholder: "whsec_…",
        hint: "Optional HMAC-SHA256 secret used to sign the delivery.",
      },
      {
        key: "simulateError",
        label: "Simulate failure in dry runs",
        kind: "boolean",
      },
    ],
    defaultConfig: { url: "", method: "POST", secret: "", simulateError: false },
  },
  {
    type: "agent.task",
    label: "Agent task",
    category: "action",
    description: "Runs an agent with the incoming value as context.",
    inputs: [{ id: "in", type: "any", label: "in" }],
    outputs: [{ id: "out", type: "json", label: "result" }],
    configFields: [
      {
        key: "prompt",
        label: "Prompt",
        kind: "textarea",
        placeholder: "Summarize the incoming data…",
        required: true,
      },
      {
        key: "simulateError",
        label: "Simulate failure in dry runs",
        kind: "boolean",
      },
    ],
    defaultConfig: { prompt: "", simulateError: false },
  },
]

const NODE_TYPE_MAP = new Map(NODE_TYPES.map((def) => [def.type, def]))

export function getNodeType(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_MAP.get(type)
}

export function isTriggerType(type: string): boolean {
  return getNodeType(type)?.category === "trigger"
}

/** Port ids that branch a condition node sends data on, keyed by node type. */
export const BRANCH_NODE_TYPE = "condition"
