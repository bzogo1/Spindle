/** Client-side validation rules for the auth forms.
 *
 * Validators return i18n message KEYS (e.g. "auth.validation.emailRequired"),
 * not English copy — the forms translate them through `t()` at render time
 * so validation errors follow the active locale. `validation.test.ts`
 * resolves keys through `t("en", …)` to keep asserting the English text.
 */

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

/** Trims and validates an email address; returns a message key or null. */
export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return "auth.validation.emailRequired"
  if (!EMAIL_PATTERN.test(email)) return "auth.validation.emailInvalid"
  return null
}

/** Required-only password check for sign-in (no creation rules). */
export function validateSignInPassword(value: string): string | null {
  if (!value) return "auth.validation.passwordRequired"
  return null
}

/** Full creation rules; the rule list under the field shows live progress. */
export function validateNewPassword(value: string): string | null {
  if (!value) return "auth.validation.passwordCreateRequired"
  if (value.length < PASSWORD_MIN_LENGTH) return "auth.validation.passwordTooShort"
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    return "auth.validation.passwordLetterNumber"
  }
  return null
}

export function validateConfirmPassword(value: string, password: string): string | null {
  if (!value) return "auth.validation.confirmRequired"
  if (value !== password) return "auth.validation.passwordsDontMatch"
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
  if (!name) return "auth.validation.workspaceNameRequired"
  if (name.length < WORKSPACE_NAME_MIN_LENGTH || name.length > WORKSPACE_NAME_MAX_LENGTH) {
    return "auth.validation.workspaceNameLength"
  }
  if (!WORKSPACE_NAME_PATTERN.test(name)) {
    return "auth.validation.workspaceNameFormat"
  }
  if (RESERVED_WORKSPACE_NAMES.has(name)) {
    return "auth.validation.workspaceNameReserved"
  }
  return null
}

export function validateTermsAccepted(accepted: boolean): string | null {
  if (!accepted) return "auth.validation.termsRequired"
  return null
}

/**
 * Interpolation params every validation message may need. `t()` ignores
 * params a template doesn't reference, so forms can pass this uniformly:
 * `t(errors.email, VALIDATION_PARAMS)`.
 */
export const VALIDATION_PARAMS = {
  min: PASSWORD_MIN_LENGTH,
  wmin: WORKSPACE_NAME_MIN_LENGTH,
  wmax: WORKSPACE_NAME_MAX_LENGTH,
} as const
