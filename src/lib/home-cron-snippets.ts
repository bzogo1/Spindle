import type { ThemedToken } from "shiki/types"

/**
 * Data for the homepage Automations "Cron jobs" card. Kept in a plain module
 * (no "use client", no server-only imports) so both the client-side
 * `CronCommandBuilder` and the server page can share the same schedule and
 * runtime definitions without drifting apart.
 */

export type CronScheduleKey = "weekdays" | "daily" | "weekly"
export type CronLanguageKey = "python" | "r" | "julia"

export type CronSchedule = {
  label: string
  comment: string
  fields: string[]
}

export type CronLanguage = {
  label: string
  file: string
  command: string
  /** Script body shown under the crontab line. */
  script: string
  /** Shiki language used to highlight `script` on the server. */
  highlight: string
}

export const CRON_SCHEDULES: Record<CronScheduleKey, CronSchedule> = {
  weekdays: {
    label: "Weekdays · 06:00",
    comment: "every weekday at 06:00",
    fields: ["0", "6", "*", "*", "1-5"],
  },
  daily: {
    label: "Daily · 09:00",
    comment: "every day at 09:00",
    fields: ["0", "9", "*", "*", "*"],
  },
  weekly: {
    label: "Mondays · 08:30",
    comment: "every monday at 08:30",
    fields: ["30", "8", "*", "*", "1"],
  },
}

export const CRON_LANGUAGES: Record<CronLanguageKey, CronLanguage> = {
  python: {
    label: "Python",
    file: "tide-sync.py",
    command: "python tide-sync.py",
    script: "from spindle import project\nproject.files.sync('data/tides')",
    highlight: "python",
  },
  r: {
    label: "R",
    file: "tide-sync.R",
    command: "Rscript tide-sync.R",
    script:
      '# same tide sync, R runtime\ntide_data <- spindle::external$fetch("noaa-tides", station = "8454000")\nspindle::data$save(tide_data, "data/tides.csv")',
    highlight: "r",
  },
  // Shiki has no Julia grammar; the Python grammar still colours strings,
  // numbers, and comments correctly for this snippet.
  julia: {
    label: "Julia",
    file: "tide-sync.jl",
    command: "julia tide-sync.jl",
    script:
      '# same tide sync, Julia runtime\ntide_data = spindle.external.fetch("noaa-tides"; station="8454000")\nspindle.data.save(tide_data, "data/tides.csv")',
    highlight: "python",
  },
}

/** Full plain-text snippet for a schedule + runtime combination. */
export function cronSnippetSource(
  scheduleKey: CronScheduleKey,
  languageKey: CronLanguageKey,
): string {
  const schedule = CRON_SCHEDULES[scheduleKey]
  const language = CRON_LANGUAGES[languageKey]
  return `# ${schedule.comment}\n${schedule.fields.join(" ")} ${language.command}\n\n${language.script}`
}

/**
 * Pre-highlighted token lines for every schedule × runtime combination,
 * computed on the server and passed to the client card. Serializable plain
 * data, so it crosses the RSC boundary without shipping a highlighter.
 */
export type CronCodeLines = Record<
  CronLanguageKey,
  Record<CronScheduleKey, ThemedToken[][]>
>
