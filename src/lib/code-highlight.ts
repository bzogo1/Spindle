import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import type { LanguageRegistration, ThemeRegistration, ThemedToken } from "shiki/types"

import diff from "@shikijs/langs/diff"
import javascript from "@shikijs/langs/javascript"
import json from "@shikijs/langs/json"
import jsx from "@shikijs/langs/jsx"
import markdown from "@shikijs/langs/markdown"
import python from "@shikijs/langs/python"
import r from "@shikijs/langs/r"
import shellscript from "@shikijs/langs/shellscript"
import toml from "@shikijs/langs/toml"
import tsx from "@shikijs/langs/tsx"
import typescript from "@shikijs/langs/typescript"
import yaml from "@shikijs/langs/yaml"

/**
 * Shiki runs at build time on the server only. The theme colours are CSS
 * variables so the same tokens work with the site palette and any future
 * light theme without shipping a highlighter to the browser.
 */
const spindleTheme = {
  name: "spindle",
  type: "dark",
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": "var(--code-text)",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "var(--code-comment)", fontStyle: "italic" },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.unquoted",
        "punctuation.definition.string",
        "markup.inline.raw",
      ],
      settings: { foreground: "var(--code-string)" },
    },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"],
      settings: { foreground: "var(--code-keyword)" },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character.escape"],
      settings: { foreground: "var(--code-number)" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "var(--code-function)" },
    },
    {
      scope: ["variable", "variable.other", "variable.parameter", "meta.object-literal.key"],
      settings: { foreground: "var(--code-variable)" },
    },
    {
      scope: ["entity.name.tag", "support.class", "entity.name.type", "support.type"],
      settings: { foreground: "var(--code-type)" },
    },
    {
      scope: ["keyword.operator", "punctuation"],
      settings: { foreground: "var(--code-punctuation)" },
    },
    {
      scope: ["markup.inserted"],
      settings: { foreground: "var(--code-string)" },
    },
    {
      scope: ["markup.deleted"],
      settings: { foreground: "var(--code-number)" },
    },
    {
      scope: ["invalid"],
      settings: { foreground: "var(--code-invalid)" },
    },
  ],
} satisfies ThemeRegistration

/**
 * Shiki has no cron grammar. A tiny TextMate grammar gives the five time
 * fields, comments, paths, and shell operators the same palette as the rest
 * of the docs.
 */
const cronLanguage = {
  name: "cron",
  displayName: "Cron",
  scopeName: "source.cron",
  aliases: ["crontab"],
  repository: {},
  patterns: [
    { match: "#.*$", name: "comment.line.number-sign.cron" },
    {
      match: "(?<!\\S)(?:[0-9]+|\\*)(?:[/,*0-9-]+)?(?=\\s)",
      name: "constant.numeric.cron",
    },
    { match: "&&|\\|\\||;", name: "keyword.operator.cron" },
    { match: "\\/[\\w./-]+", name: "string.unquoted.path.cron" },
  ],
} satisfies LanguageRegistration

const languages = [
  cronLanguage,
  diff,
  javascript,
  json,
  jsx,
  markdown,
  python,
  r,
  shellscript,
  toml,
  tsx,
  typescript,
  yaml,
]

let highlighterPromise: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    themes: [spindleTheme],
    langs: languages,
    engine: createJavaScriptRegexEngine(),
  })

  return highlighterPromise
}

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shellscript",
  sh: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  shellscript: "shellscript",
  cron: "cron",
  crontab: "cron",
  diff: "diff",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  json: "json",
  py: "python",
  python: "python",
  r: "r",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  text: "text",
  txt: "text",
  plain: "text",
  plaintext: "text",
  tree: "text",
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  shellscript: "Shell",
  cron: "Cron",
  crontab: "Cron",
  diff: "Diff",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  py: "Python",
  python: "Python",
  r: "R",
  toml: "TOML",
  yml: "YAML",
  yaml: "YAML",
  md: "Markdown",
  markdown: "Markdown",
  text: "Text",
  txt: "Text",
  plain: "Text",
  plaintext: "Text",
  tree: "Tree",
}

export function getLanguageLabel(language: string) {
  const key = language.trim().toLowerCase()
  return LANGUAGE_LABELS[key] ?? (language.trim() || "Text")
}

function plainTokenLines(code: string): ThemedToken[][] {
  return code
    .split("\n")
    .map((line) => [{ content: line, offset: 0, color: "var(--code-text)", fontStyle: 0 }])
}

/** Highlights code on the server. Unknown languages fall back to plain text. */
export async function highlightCode(code: string, language = "text"): Promise<ThemedToken[][]> {
  const lang = LANGUAGE_ALIASES[language.trim().toLowerCase()]

  if (!lang || lang === "text") {
    return plainTokenLines(code)
  }

  const highlighter = await getHighlighter()

  try {
    const { tokens } = highlighter.codeToTokens(code, { lang, theme: "spindle" })
    return tokens
  } catch {
    return plainTokenLines(code)
  }
}

/**
 * Parses a line-highlight spec such as `2,5-7` or `{2,5-7}` into 1-based
 * line numbers. Invalid ranges are ignored rather than throwing.
 */
export function parseLineHighlights(spec?: string): Set<number> {
  const highlighted = new Set<number>()
  if (!spec) return highlighted

  for (const part of spec.replace(/[{}]/g, "").split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) continue

    const start = Number(match[1])
    const end = Math.min(Number(match[2] ?? match[1]), 10_000)

    for (let line = Math.max(start, 1); line <= end; line += 1) {
      highlighted.add(line)
    }
  }

  return highlighted
}
