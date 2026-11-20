/**
 * Local password breach detection — no external APIs, no network calls.
 *
 * Two layers, both pure and synchronous so they can run in route handlers
 * (and, if ever needed, client bundles):
 *
 *  1. A denylist of the most common passwords. The base word list is curated
 *     from public top-password rankings (rockyou/seclists style); each base
 *     is expanded with the suffixes attackers actually use ("1", "123",
 *     "2024", "!", …) and every entry is stored in a folded form — lowercased,
 *     leetspeak-normalised (`p@ssw0rd` → `password`), non-alphanumerics
 *     stripped. Lookup tries the full folded password plus the password with
 *     its trailing digits/symbols removed, so "sunshine2024!" still hits.
 *  2. Heuristic checks for patterns that are weak even when not literally
 *     listed: keyboard walks, sequential runs ("abcd1234"), repeated
 *     characters, low character variety and all-digit passwords.
 *
 * Passwords are never logged anywhere; callers should likewise avoid putting
 * the password itself into log lines or error payloads.
 */

export type BreachSeverity = "high" | "medium"

export type PasswordBreachResult = {
  /** True when the password matches the denylist or a strong heuristic. */
  breached: boolean
  /** Stable machine-readable reason codes (safe to return to clients). */
  reasons: string[]
  /** "high" for denylist hits, "medium" for heuristic-only hits, null when clean. */
  severity: BreachSeverity | null
}

/**
 * Curated base words: the most common passwords/names/brands plus seasonal
 * and keyboard-adjacent favourites. Single whitespace-separated tokens only —
 * they are split at module load.
 */
const COMMON_WORDS = `
123456 123456789 12345678 12345 1234567 1234567890 111111 000000 121212 123123
654321 666666 696969 112233 102030 987654321 123321 147258 258456 159357
753951 963852 159753 789456123 qwerty qwertyuiop asdfghjkl zxcvbnm password
passw0rd p@ssw0rd p@ssword passwd pass123 admin administrator root toor
letmein welcome login master dragon monkey shadow superman batman trustno1
starwars football baseball soccer hockey killer hunter hunter2 ranger buster
thomas robert michael jennifer michelle jessica ashley amanda daniel andrew
joshua matthew charlie andrea samantha nicole chelsea anthony sunshine
princess flower angel lovely babygirl sweetie honey iloveyou iloveyou1
iloveyou2 loveyou forever freedom whatever secret secret123 computer
internet server system security access matrix google microsoft windows linux
ubuntu macbook iphone android samsung pokemon naruto harrypotter potter hello
hello123 freedom1 changeme default temp123 test123 demo123 user user123
guest guest123 sample example spindle spindle123 qwerty1 abc123 aaa123
a123456 zxc123 asdf1234 passw0rd123 qazwsx zaq12wsx 1qaz2wsx 1q2w3e
1q2w3e4r q1w2e3 q1w2e3r4 abcd1234 jordan liverpool arsenal barcelona madrid
lakers yankees cowboys steelers packers patriots mustang corvette camaro
harley honda suzuki kawasaki bmw mercedes audi porsche ferrari lamborghini
tesla toyota ford chevy nissan mazda subaru kobe lebron curry durant harden
james summer winter spring autumn january february march april may june july
august september october november december monday tuesday wednesday thursday
friday saturday sunday love money happy lucky magic devil god jesus christ
heaven hell peace war blue red green yellow black white purple orange pink
brown silver gold golden diamond ruby emerald crystal pearl opal dark light
night day dawn dusk morning evening afternoon coffee beer wine vodka
whiskey tequila rum gin brandy champagne cocktail pizza burger taco sushi
pasta spaghetti lasagna hamburger sandwich cookie chocolate vanilla
strawberry caramel cinnamon ginger pepper salt sugar maple banana apple
orange lemon lime peach mango pineapple blueberry raspberry blackberry
cherry grape watermelon cantaloupe peanut almond cashew walnut pistachio
hazelnut coconut avocado tomato potato carrot onion garlic broccoli spinach
lettuce cucumber radish beet turnip parsnip yam squash pumpkin zucchini
eggplant celery asparagus mushroom salmon tuna shrimp lobster crab
scallop clam squid octopus trout bass dolphin shark koala kangaroo
wombat hamster squirrel chipmunk gopher meerkat mongoose lemur gibbon
orangutan chimpanzee gorilla baboon howler marmoset tamarin
bandit smokey tigger
mary patricia linda elizabeth barbara susan jessica sarah karen lisa nancy
betty margaret sandra kimberly emily dorothy melissa deborah stephanie
rebecca sharon laura cynthia kathleen amy shirley angela helen anna brenda
pamela katherine christine emma catherine debra rachel carolyn janet ruth
maria olivia heather diane julie joyce victoria kelly christina lauren joan
evelyn judith hannah megan cheryl jacqueline martha madison teresa gloria
sara janice kathryn abigail sophia frances isabella julia grace
`

/**
 * Suffixes attackers append to a base word. Kept deliberately broad but
 * finite — arbitrary trailing junk is already caught by the base-strip
 * lookup, these cover common non-trailing variants too.
 */
const SUFFIXES = [
  "",
  "1",
  "12",
  "123",
  "1234",
  "12345",
  "123456",
  "0",
  "00",
  "01",
  "000",
  "11",
  "22",
  "69",
  "88",
  "99",
  "007",
  "321",
  "111",
  "777",
  "789",
  "!",
  "!!",
  "@",
  "#",
  "?",
  "1!",
  "12!",
  "123!",
  "1234!",
  "!@#",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
  "2019",
  "2018",
] as const

/**
 * Leetspeak fold shared by the denylist and lookups. Digits that double as
 * letters are mapped BEFORE non-alphanumerics are stripped so `p@ssw0rd`
 * folds to `password`. Entries and queries go through the same function, so
 * `password1` and `passwordl` both resolve consistently.
 */
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[0134578@$]/g, (ch) => LEET_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]/g, "")
}

const DENYLIST = new Set<string>()
for (const word of COMMON_WORDS.trim().split(/\s+/)) {
  const base = fold(word)
  if (!base) continue
  DENYLIST.add(base)
  for (const suffix of SUFFIXES) {
    const expanded = fold(word + suffix)
    if (expanded && expanded !== base) DENYLIST.add(expanded)
  }
}

/**
 * Keyboard rows (letters, digits, and common diagonal runs), each stored
 * forward and reversed. Every 6-character window becomes a gram; a password
 * containing any gram is treated as a keyboard walk.
 */
const KEYBOARD_ROWS = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
  "0987654321",
  "1qaz2wsx",
  "qazwsxedc",
  "zaq12wsx",
  "1q2w3e4r",
  "q1w2e3r4",
  "poiuytrewq",
  "lkjhgfdsa",
  "mnbvcxz",
  "!qaz2wsx",
  "qazwsx",
  "wsxedc",
  "zxcvbn",
  "asdfgh",
  "qwerty",
]

const GRAM_LENGTH = 6
const KEYBOARD_GRAMS = new Set<string>()
for (const row of KEYBOARD_ROWS) {
  const variants = [row, [...row].reverse().join("")]
  for (const variant of variants) {
    for (let i = 0; i + GRAM_LENGTH <= variant.length; i++) {
      KEYBOARD_GRAMS.add(variant.slice(i, i + GRAM_LENGTH))
    }
  }
}

function isLetterCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90)
}
function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57
}

/** Four or more consecutive same-class characters stepping by ±1. */
function hasSequentialRun(compact: string): boolean {
  for (let i = 0; i + 3 < compact.length; i++) {
    const codes = [
      compact.charCodeAt(i),
      compact.charCodeAt(i + 1),
      compact.charCodeAt(i + 2),
      compact.charCodeAt(i + 3),
    ]
    const sameClass = codes.every(isLetterCode) || codes.every(isDigitCode)
    if (!sameClass) continue
    const step = codes[1] - codes[0]
    if (step !== 1 && step !== -1) continue
    if (codes[2] - codes[1] === step && codes[3] - codes[2] === step) return true
  }
  return false
}

function hasKeyboardWalk(compact: string): boolean {
  if (compact.length < GRAM_LENGTH) return false
  for (let i = 0; i + GRAM_LENGTH <= compact.length; i++) {
    if (KEYBOARD_GRAMS.has(compact.slice(i, i + GRAM_LENGTH))) return true
  }
  return false
}

/** Four or more identical characters in a row, e.g. "aaaa" or "####". */
const REPEATED_RUN = /(.)\1{3,}/

/**
 * Evaluates a candidate password against the local denylist and heuristics.
 * Returns stable reason codes; never includes the password itself.
 */
export function checkPasswordBreach(password: string): PasswordBreachResult {
  const reasons: string[] = []
  if (!password) {
    return { breached: false, reasons, severity: null }
  }

  const lower = password.toLowerCase()
  // compact keeps letters+digits only — used for pattern heuristics.
  const compact = lower.replace(/[^a-z0-9]/g, "")

  // Denylist lookups: the full folded password, plus the password with its
  // trailing digits/symbols stripped ("sunshine2024!" → "sunshine").
  const strippedBase = lower.replace(/[^a-z]+$/, "")
  if (
    DENYLIST.has(fold(password)) ||
    (strippedBase.length >= 4 && DENYLIST.has(fold(strippedBase)))
  ) {
    reasons.push("common_password")
  }

  if (hasKeyboardWalk(compact)) reasons.push("keyboard_pattern")
  if (hasSequentialRun(compact)) reasons.push("sequential_characters")
  if (REPEATED_RUN.test(lower)) reasons.push("repeated_characters")
  if (compact.length >= 8 && new Set(compact).size <= 3) {
    reasons.push("low_character_variety")
  }
  if (/^\d{6,}$/.test(compact)) reasons.push("numeric_only")

  const breached = reasons.length > 0
  const severity: BreachSeverity | null = !breached
    ? null
    : reasons.includes("common_password")
      ? "high"
      : "medium"
  return { breached, reasons, severity }
}
