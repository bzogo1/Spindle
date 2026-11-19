import type { EnvSource } from "@/lib/env"

import { secretCatalog } from "./catalog"

export type SecretIssue = {
  key: string
  message: string
}

export type SecretValidationResult = {
  issues: SecretIssue[]
  /** Variable names that are present. Values are never included. */
  present: string[]
  /** Variable names that are missing. Values are never included. */
  missing: string[]
}

const PLACEHOLDER = /^(change[-_ ]?me|replace[-_ ]?me|example|todo|secret|password|test|xxx+)$/i

/**
 * Validates the secret-store contract without ever reading a value into a
 * message. `requireAll` is set by the production entrypoint; development can
 * run the same check to see which names are missing without failing.
 */
export function validateSecretEnvironment(
  source: EnvSource,
  options: { requireAll?: boolean } = {},
): SecretValidationResult {
  const issues: SecretIssue[] = []
  const present: string[] = []
  const missing: string[] = []

  for (const entry of secretCatalog) {
    for (const key of entry.variables) {
      const value = source[key]?.trim()

      if (!value) {
        missing.push(key)
        if (options.requireAll && entry.requiredInProduction) {
          issues.push({
            key,
            message: `${entry.label} is not configured. Add ${key} to the production secret store.`,
          })
        }
        continue
      }

      present.push(key)

      if (PLACEHOLDER.test(value)) {
        issues.push({ key, message: "Looks like a placeholder, not a real secret." })
      }

      if (entry.kind === "symmetric-key" && value.length < 32) {
        issues.push({ key, message: "Symmetric keys must be at least 32 characters." })
      }
    }

    for (const key of entry.previousVariables ?? []) {
      const value = source[key]?.trim()
      if (!value) continue

      present.push(key)

      const currentKey = entry.variables[0]
      const currentValue = source[currentKey]?.trim()

      if (!currentValue) {
        issues.push({ key, message: `Set ${currentKey} before ${key}.` })
      } else if (value === currentValue) {
        issues.push({
          key,
          message: `Must differ from ${currentKey}; otherwise the rotation does not change the key.`,
        })
      }
    }
  }

  return { issues, present, missing }
}
