/**
 * Runtime leak guard.
 *
 * Last line of defence for values that must never reach logs, error reports,
 * or client-visible messages. `scrubSecrets` rewrites free text — an error
 * message, a stack trace, a log line — replacing anything that looks like a
 * credential with `[Redacted]`.
 *
 * This complements `src/lib/logger.ts`, which redacts structured log fields;
 * the guard exists for paths where raw text escapes (third-party error
 * messages, `console.error` fallbacks, Sentry `beforeSend` hooks, API error
 * bodies). Keep patterns aligned with `scripts/secrets/leak-detection/detect.mjs`.
 */

export const REDACTED = "[Redacted]"

const privateKeyBlock =
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g

const credentialPatterns: RegExp[] = [
  privateKeyBlock,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?:ASIA)[0-9A-Z]{16}\b/g, // AWS temporary access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, // GitHub fine-grained tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bsk_live_[A-Za-z0-9]{20,}\b/g, // Stripe live keys
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic-style keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
  /\blin_api_[A-Za-z0-9]{20,}\b/g, // Linear API keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWTs
  /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, // Authorization header values
]

// Credentialed connection strings: scheme://user:password@host
const connectionString = /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s]+(@)/gi

// KEY=value / KEY: value assignments where the key names a secret.
const secretAssignment =
  /\b([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|AUTH)[A-Za-z0-9_]*)\s*([:=]\s*["']?)([^\s"'`,;)}]{6,})/gi

const placeholderValue =
  /^(?:\[?redacted\]?|\*+|x+|changeme|change-me|placeholder|example|sample|dummy|fake|test|your[-_]?\w*|<.*>|\$\{.*\}|process\.env.*|env\.[A-Z_]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/i

/**
 * Replaces credential-looking substrings in free text with `[Redacted]`.
 * Safe to run on already-clean text; it never throws and never alters the
 * shape of the surrounding message.
 */
export function scrubSecrets(text: string): string {
  if (!text) return text

  let result = text.replace(privateKeyBlock, REDACTED)

  for (const pattern of credentialPatterns) {
    result = result.replace(pattern, (match, ...groups) => {
      // Bearer/Basic keeps its scheme label so the message stays readable.
      if (/^(?:Bearer|Basic)$/i.test(groups[0] ?? match))
        return `${match.split(/\s+/)[0]} ${REDACTED}`
      return REDACTED
    })
  }

  result = result.replace(connectionString, `$1${REDACTED}$2`)

  result = result.replace(secretAssignment, (match, key, separator, value) => {
    // Leave placeholders and code references untouched.
    if (placeholderValue.test(value)) return match
    // `separator` is "=" / ":" plus optional quote; rebuild without the value.
    return `${key}${separator}${REDACTED}`
  })

  return result
}

/** Scrubs an Error's message and stack without mutating the original. */
export function scrubError<T extends Error>(error: T): T {
  const clone = new Error(scrubSecrets(error.message)) as T
  clone.name = error.name
  if (error.stack) clone.stack = scrubSecrets(error.stack)
  return clone
}

/** True when the text still contains something that looks like a credential. */
export function containsSecret(text: string): boolean {
  return scrubSecrets(text) !== text
}

// Re-export for callers that want the assignment check in isolation.
export { placeholderValue as secretPlaceholderPattern }
