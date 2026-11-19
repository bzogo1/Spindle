/**
 * The secret-store contract.
 *
 * Every value the production runtime needs comes from the store; nothing here
 * is ever committed or baked into an image. The catalog is the single source
 * of truth for `scripts/secrets/check.ts`, the rotation runbook, and the env
 * schema test.
 */

export type SecretService = "b2" | "resend" | "llm" | "database" | "session" | "edge" | "worker"

export type SecretKind = "credential" | "symmetric-key" | "connection-string" | "setting"

export type SecretRotationStrategy = "dual-key" | "provider-overlap" | "role-overlap"

export type SecretDefinition = {
  service: SecretService
  label: string
  kind: SecretKind
  /** Variables the runtime must receive from the store. */
  variables: readonly string[]
  /** Extra variables that hold the old value only during a rotation window. */
  previousVariables?: readonly string[]
  requiredInProduction: boolean
  rotation: {
    maxAgeDays: number
    strategy: SecretRotationStrategy
    overlap: string
  }
  consumers: readonly ("app" | "worker" | "edge" | "deploy")[]
  notes: string
}

export const secretCatalog: readonly SecretDefinition[] = [
  {
    service: "b2",
    label: "Backblaze B2",
    kind: "credential",
    variables: ["B2_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET", "B2_ENDPOINT"],
    previousVariables: ["B2_KEY_ID_PREVIOUS", "B2_APPLICATION_KEY_PREVIOUS"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 90,
      strategy: "dual-key",
      overlap:
        "Create a second application key, set the previous pair, deploy the new pair, verify uploads and downloads, then revoke the old key.",
    },
    consumers: ["app", "worker", "deploy"],
    notes: "Bucket-scoped application key only; never an account-level master key.",
  },
  {
    service: "resend",
    label: "Resend",
    kind: "credential",
    variables: ["RESEND_API_KEY"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 180,
      strategy: "provider-overlap",
      overlap:
        "Create a second API key in Resend, deploy it, verify one transactional message, then revoke the old key.",
    },
    consumers: ["app", "worker"],
    notes: "Sending permission only; no audience or domain-management scope.",
  },
  {
    service: "llm",
    label: "LLM provider",
    kind: "credential",
    variables: ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 90,
      strategy: "provider-overlap",
      overlap:
        "Create a second provider key, deploy it, verify one completion, then revoke the old key.",
    },
    consumers: ["app", "worker"],
    notes: "One key per environment so staging traffic cannot spend production quota.",
  },
  {
    service: "database",
    label: "Postgres",
    kind: "connection-string",
    variables: ["DATABASE_URL", "DIRECT_URL"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 90,
      strategy: "role-overlap",
      overlap:
        "Create a second role and password, update both pooled and direct URLs, deploy, verify migrations and queries, then drop the old role after connections drain.",
    },
    consumers: ["app", "worker", "deploy"],
    notes: "Runtime uses the pooled URL; Prisma CLI uses the direct URL.",
  },
  {
    service: "session",
    label: "Session secret",
    kind: "symmetric-key",
    variables: ["SESSION_SECRET"],
    previousVariables: ["SESSION_SECRET_PREVIOUS"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 30,
      strategy: "dual-key",
      overlap:
        "Move the old value to SESSION_SECRET_PREVIOUS, set the new value as SESSION_SECRET, deploy, then remove the previous value after the session lifetime.",
    },
    consumers: ["app", "edge"],
    notes: "New tokens are signed with the current key; the previous key only verifies.",
  },
  {
    service: "edge",
    label: "Edge HMAC",
    kind: "symmetric-key",
    variables: ["EDGE_HMAC_SECRET"],
    previousVariables: ["EDGE_HMAC_SECRET_PREVIOUS"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 90,
      strategy: "dual-key",
      overlap:
        "Set the old value as EDGE_HMAC_SECRET_PREVIOUS and the new value as EDGE_HMAC_SECRET on the origin, deploy the edge signer, verify requests, then remove the previous value.",
    },
    consumers: ["app", "edge"],
    notes:
      "Signs method, path, timestamp, and body hash; the origin rejects requests outside the skew window.",
  },
  {
    service: "worker",
    label: "Worker",
    kind: "symmetric-key",
    variables: ["WORKER_SECRET"],
    previousVariables: ["WORKER_SECRET_PREVIOUS"],
    requiredInProduction: true,
    rotation: {
      maxAgeDays: 90,
      strategy: "dual-key",
      overlap:
        "Move the old value to WORKER_SECRET_PREVIOUS, set the new value as WORKER_SECRET, deploy both sides, then remove the previous value.",
    },
    consumers: ["app", "worker"],
    notes:
      "Shared bearer secret for app-to-worker calls; the worker accepts either key during overlap.",
  },
] as const

export const secretVariables = secretCatalog.flatMap((entry) => [
  ...entry.variables,
  ...(entry.previousVariables ?? []),
])

export const dualKeySecrets = secretCatalog.filter(
  (entry) => entry.rotation.strategy === "dual-key",
)
