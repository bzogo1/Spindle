/** Client-side validation rules for the auth dialog forms. */

export const PASSWORD_MIN_LENGTH = 8
export const WORKSPACE_NAME_MIN_LENGTH = 3
export const WORKSPACE_NAME_MAX_LENGTH = 40

export type PasswordRule = {
  id: string
  label: string
  test: (password: string) => boolean
}

/** Visible password requirements; each is checked live in the rule list. */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "letter",
    label: "Contains a letter",
    test: (password) => /[a-zA-Z]/.test(password),
  },
  {
    id: "number",
    label: "Contains a number",
    test: (password) => /\d/.test(password),
  },
]

export function passwordRulesMet(password: string): Record<string, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((rule) => [rule.id, rule.test(password)]))
}

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Trims and validates an email address; returns an error message or null. */
export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return "Enter your work email."
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address, like you@lab.edu."
  return null
}

/** Required-only password check for sign-in (no creation rules). */
export function validateSignInPassword(value: string): string | null {
  if (!value) return "Enter your password."
  return null
}

/** Full creation rules; the rule list under the field shows live progress. */
export function validateNewPassword(value: string): string | null {
  if (!value) return "Create a password."
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    return "Include a letter and a number."
  }
  return null
}

export function validateConfirmPassword(value: string, password: string): string | null {
  if (!value) return "Confirm your password."
  if (value !== password) return "Passwords don't match."
  return null
}

/** Slugs that cannot be used as workspace names. */
export const RESERVED_WORKSPACE_NAMES = new Set([
  "admin",
  "api",
  "app",
  "docs",
  "help",
  "login",
  "mail",
  "security",
  "signup",
  "spindle",
  "status",
  "support",
  "www",
])

const WORKSPACE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Workspace slug rules: lowercase letters, numbers and single dashes,
 * 3–40 characters, no leading/trailing dash, not a reserved name.
 */
export function validateWorkspaceName(value: string): string | null {
  const name = value.trim()
  if (!name) return "Name your workspace."
  if (name.length < WORKSPACE_NAME_MIN_LENGTH || name.length > WORKSPACE_NAME_MAX_LENGTH) {
    return `Use ${WORKSPACE_NAME_MIN_LENGTH}–${WORKSPACE_NAME_MAX_LENGTH} characters.`
  }
  if (!WORKSPACE_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, numbers and single dashes."
  }
  if (RESERVED_WORKSPACE_NAMES.has(name)) {
    return "That workspace name is reserved. Try another."
  }
  return null
}

export function validateTermsAccepted(accepted: boolean): string | null {
  if (!accepted) return "Accept the Terms of Service and Privacy Policy to continue."
  return null
}
