/**
 * Local heuristic password strength scorer.
 *
 * Pure functions, no external APIs and no dependencies. Produces a 0–100
 * score plus a 0–3 level used by the sign-up strength meter.
 */

export const PASSWORD_STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong"] as const

export type PasswordStrengthLevel = 0 | 1 | 2 | 3

export type PasswordStrength = {
  /** Heuristic score from 0 (worst) to 100 (best). */
  score: number
  /** Coarse band: 0 Weak, 1 Fair, 2 Good, 3 Strong. */
  level: PasswordStrengthLevel
  label: (typeof PASSWORD_STRENGTH_LABELS)[PasswordStrengthLevel]
}

/**
 * Small built-in blocklist of commonly used passwords (top-password lists,
 * keyboard walks and seasonal defaults). Compared case-insensitively, and
 * also after stripping trailing digits/symbols so "password1!" still hits.
 */
const COMMON_PASSWORDS = new Set([
  "123456",
  "123456789",
  "12345678",
  "12345",
  "1234567",
  "1234567890",
  "111111",
  "000000",
  "121212",
  "123123",
  "654321",
  "666666",
  "696969",
  "112233",
  "102030",
  "987654321",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "qazwsx",
  "1q2w3e",
  "1q2w3e4r",
  "q1w2e3",
  "q1w2e3r4",
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "passwd",
  "pass123",
  "admin",
  "admin123",
  "administrator",
  "root",
  "toor",
  "letmein",
  "welcome",
  "welcome1",
  "login",
  "master",
  "dragon",
  "monkey",
  "shadow",
  "superman",
  "batman",
  "trustno1",
  "starwars",
  "football",
  "baseball",
  "soccer",
  "hockey",
  "killer",
  "hunter",
  "hunter2",
  "ranger",
  "buster",
  "thomas",
  "robert",
  "michael",
  "jennifer",
  "michelle",
  "jessica",
  "ashley",
  "amanda",
  "daniel",
  "andrew",
  "joshua",
  "matthew",
  "charlie",
  "andrea",
  "samantha",
  "nicole",
  "chelsea",
  "anthony",
  "sunshine",
  "princess",
  "flower",
  "angel",
  "lovely",
  "babygirl",
  "sweetie",
  "honey",
  "iloveyou",
  "iloveyou1",
  "iloveyou2",
  "loveyou",
  "forever",
  "freedom",
  "whatever",
  "secret",
  "secret123",
  "computer",
  "internet",
  "server",
  "system",
  "security",
  "access",
  "matrix",
  "google",
  "microsoft",
  "windows",
  "linux",
  "ubuntu",
  "macbook",
  "iphone",
  "android",
  "samsung",
  "pokemon",
  "naruto",
  "harrypotter",
  "potter",
  "hello",
  "hello123",
  "freedom1",
  "changeme",
  "default",
  "temp123",
  "test123",
  "demo123",
  "user",
  "user123",
  "guest",
  "guest123",
  "sample",
  "example",
  "spindle",
  "spindle123",
  "qwerty1",
  "1qaz2wsx",
  "zaq12wsx",
  "abcd1234",
  "abc123",
  "aaa123",
  "a123456",
  "zxc123",
  "asdf1234",
  "passw0rd123",
])

/** Three consecutive characters stepping by +1 or -1 inside one class. */
function hasSequentialRun(password: string): boolean {
  const isDigit = (code: number) => code >= 48 && code <= 57
  const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

  for (let i = 0; i + 2 < password.length; i++) {
    const a = password.charCodeAt(i)
    const b = password.charCodeAt(i + 1)
    const c = password.charCodeAt(i + 2)
    const sameClass =
      (isDigit(a) && isDigit(b) && isDigit(c)) || (isLetter(a) && isLetter(b) && isLetter(c))
    if (!sameClass) continue
    if ((b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1)) return true
  }
  return false
}

/** Triple (or longer) run of the same character, e.g. "aaa" or "!!!". */
const REPEATED_CHAR = /(.)\1{2,}/

function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return true
  // "password1!" / "sunshine2024" style suffixes still hit the blocklist.
  const stripped = lower.replace(/[^a-z]+$/, "")
  return stripped.length >= 4 && COMMON_PASSWORDS.has(stripped)
}

/**
 * Scores a password heuristically. Length and character-class variety add
 * points; sequential runs, repeated characters, low alphabet size and the
 * common-password blocklist subtract or cap the result.
 */
export function scorePassword(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, level: 0, label: PASSWORD_STRENGTH_LABELS[0] }
  }

  const length = password.length
  const classes = [
    /[a-z]/.test(password), // lowercase
    /[A-Z]/.test(password), // uppercase
    /\d/.test(password), // digits
    /[^a-zA-Z0-9]/.test(password), // symbols / spaces
  ].filter(Boolean).length

  let score = Math.min(length, 12) * 4 // up to 48 for length
  score += classes * 10 // up to 40 for variety
  if (length >= 16) score += 8
  if (classes === 4 && length >= 12) score += 4

  // Very small alphabets ("abababab", "aaaaaaaa") are trivially guessable.
  if (new Set(password).size <= 3) score = Math.min(score, 25)
  if (REPEATED_CHAR.test(password)) score -= 12
  if (hasSequentialRun(password)) score -= 15
  if (isCommonPassword(password)) score = Math.min(score, 20)

  score = Math.max(0, Math.min(100, Math.round(score)))
  const level: PasswordStrengthLevel = score >= 80 ? 3 : score >= 55 ? 2 : score >= 30 ? 1 : 0
  return { score, level, label: PASSWORD_STRENGTH_LABELS[level] }
}
