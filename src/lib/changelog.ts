import { siteUrl } from "@/lib/site-url"

export { siteUrl }

export type ChangelogBlock =
  { type: "paragraph"; text: string } | { type: "list"; items: { label: string; text: string }[] }

export type ChangelogMedia = {
  kind: "image" | "video"
  src: string
  alt: string
  width: number
  height: number
  poster?: string
}

export type ChangelogRelease = {
  /** Stable anchor and feed identifier. */
  slug: string
  version: string
  /** Publication date in YYYY-MM-DD. */
  date: string
  title: string
  /** Plain text used for the feed description and metadata. */
  summary: string
  tags: string[]
  body: ChangelogBlock[]
  media?: ChangelogMedia
}

// Add new releases at the top. Dates must be the real release date — do not
// backfill entries for features that were not announced separately.
export const changelogReleases: ChangelogRelease[] = [
  {
    slug: "1-0",
    version: "1.0",
    date: "2026-11-19",
    title: "Spindle 1.0 — a home for the whole project",
    summary:
      "The first Spindle release brings a project's files, lab, search, automations, agent, and team chat into one workspace.",
    tags: ["Release", "Workspace", "Lab", "Collaboration"],
    body: [
      {
        type: "paragraph",
        text: "Spindle is open. Every research project now gets its own home: files with inline previews, a lab on the same data, search that stays inside the workspace, automations that keep results current, an agent that works the project, and channels for the people doing the work.",
      },
      {
        type: "list",
        items: [
          {
            label: "Files",
            text: "5 GB free, a project file tree, and inline previews for more than 100 formats.",
          },
          {
            label: "Lab",
            text: "Notebooks, R, SQL, graphs, and a terminal, opened against the project's own files.",
          },
          {
            label: "Search",
            text: "Academic and Basic modes, run locally and saved back to the project with their citations.",
          },
          {
            label: "Automations",
            text: "Describe a routine in plain language, build it visually, or write the cron.",
          },
          {
            label: "Agent",
            text: "20 requests a day on the free plan, with every change delivered as a diff to review before it applies.",
          },
          {
            label: "Team chat",
            text: "Project channels, roles, shared documents with live cursors, and an optional anonymous mode.",
          },
        ],
      },
      {
        type: "paragraph",
        text: "There is no earlier changelog history to import, so this entry marks the first release. Future entries will be added here as work ships.",
      },
    ],
  },
]

export function getRelease(slug: string) {
  return changelogReleases.find((release) => release.slug === slug)
}

export function getReleaseAnchor(release: ChangelogRelease) {
  return `release-${release.slug}`
}

/** In-app path of the dedicated per-release page. */
export function getReleasePath(release: ChangelogRelease) {
  return `/changelog/${release.slug}`
}

/** Absolute permalink used by the feed and share metadata. */
export function getReleaseUrl(release: ChangelogRelease) {
  return `${siteUrl}${getReleasePath(release)}`
}

export function formatReleaseDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  })
}
