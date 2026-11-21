"use client"

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import type { ThemedToken } from "shiki/types"
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileUp,
  FolderPlus,
  Link2,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Printer,
  Share2,
  X,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { recordFeatureView } from "@/lib/recently-viewed"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  CRON_LANGUAGES,
  CRON_SCHEDULES,
  type CronCodeLines,
  type CronLanguageKey,
  type CronScheduleKey,
} from "@/lib/home-cron-snippets"
import { cn } from "@/lib/utils"

/* Homepage islands, ported from the Vite entry point's mount() calls. */

export function HeroBadge() {
  return (
    <Badge asChild variant="outline" className="ui-hero-badge">
      <Link href="/sign-up">
        <i className="ui-live-dot" aria-hidden="true" />
        Early access is open
        <ArrowRight className="size-3" />
      </Link>
    </Badge>
  )
}

export function HeroStatus() {
  // Timestamp of the last "sync"; bumps every 30s so the badge looks live.
  const [lastSynced, setLastSynced] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setLastSynced(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const syncedTime = new Date(lastSynced).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="ui-status-badge">
          <i className="ui-status-dot" aria-hidden="true" />
          All systems synced
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="ui-tooltip">Last synced at {syncedTime}</TooltipContent>
    </Tooltip>
  )
}

const SLUG_COPY_RESET_DELAY = 2000

/**
 * Copy-to-clipboard button rendered inside the hero window title. Copies the
 * project slug (e.g. "coastal-resilience") and briefly swaps the icon for a
 * check while the tooltip confirms the copy.
 */
export function WindowSlugCopy({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const copy = async () => {
    let didCopy = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(slug)
        didCopy = true
      } catch {
        didCopy = false
      }
    }
    setCopied(didCopy)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopied(false), SLUG_COPY_RESET_DELAY)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="window-slug-copy"
          aria-label={`Copy project slug ${slug}`}
          onClick={() => void copy()}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href={copied ? "#i-check" : "#i-copy"} />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent className="ui-tooltip">
        {copied ? "Slug copied" : "Copy project slug"}
      </TooltipContent>
    </Tooltip>
  )
}

const PROMPT_COPY_RESET_DELAY = 2000

/** The example automation prompt shown on the homepage prompt card. */
export const AUTOMATION_EXAMPLE_PROMPT =
  "When a new CSV lands in /data, clean it and add a short summary to the project log."

/**
 * "Copy automation prompt" button for the prompt card in the homepage
 * Automations section. Copies the example prompt to the clipboard (with an
 * execCommand fallback) and swaps the icon for a check while the tooltip
 * confirms the copy.
 */
export function CopyPromptButton() {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const copy = async () => {
    let didCopy = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(AUTOMATION_EXAMPLE_PROMPT)
        didCopy = true
      } catch {
        didCopy = false
      }
    }
    if (!didCopy) {
      // Fallback for non-secure contexts or denied clipboard permission.
      const input = document.createElement("textarea")
      input.value = AUTOMATION_EXAMPLE_PROMPT
      input.setAttribute("readonly", "")
      input.style.position = "fixed"
      input.style.opacity = "0"
      document.body.appendChild(input)
      input.select()
      try {
        didCopy = document.execCommand("copy")
      } catch {
        didCopy = false
      } finally {
        document.body.removeChild(input)
      }
    }
    if (didCopy) {
      setCopied(true)
      toast.success("Automation prompt copied", {
        description: AUTOMATION_EXAMPLE_PROMPT,
        duration: 3000,
      })
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), PROMPT_COPY_RESET_DELAY)
    } else {
      toast.error("Couldn't copy the prompt", { duration: 4000 })
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="prompt-copy"
          aria-label="Copy automation prompt"
          onClick={() => void copy()}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href={copied ? "#i-check" : "#i-copy"} />
          </svg>
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </TooltipTrigger>
      <TooltipContent className="ui-tooltip">
        {copied ? "Prompt copied" : "Copy automation prompt"}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * "Share this page" button for the hero actions. Copies the current URL to the
 * clipboard (with an execCommand fallback) and confirms with a success toast.
 */
export function SharePageButton() {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const share = async () => {
    const url = window.location.href
    let didCopy = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        didCopy = true
      } catch {
        didCopy = false
      }
    }
    if (!didCopy) {
      // Fallback for non-secure contexts or denied clipboard permission.
      const input = document.createElement("textarea")
      input.value = url
      input.setAttribute("readonly", "")
      input.style.position = "fixed"
      input.style.opacity = "0"
      document.body.appendChild(input)
      input.select()
      try {
        didCopy = document.execCommand("copy")
      } catch {
        didCopy = false
      } finally {
        document.body.removeChild(input)
      }
    }
    if (didCopy) {
      setCopied(true)
      toast.success("Link copied to clipboard", {
        description: url,
        duration: 3000,
      })
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), SLUG_COPY_RESET_DELAY)
    } else {
      toast.error("Couldn't copy the link", {
        description: url,
        duration: 5000,
      })
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      className="ui-btn-quiet"
      onClick={() => void share()}
      aria-label="Share this page"
    >
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
      {copied ? "Link copied" : "Share this page"}
    </Button>
  )
}

export function HeroActions() {
  return (
    <div className="ui-hero-actions">
      <Button asChild size="lg" className="ui-btn-primary">
        <Link href="/sign-up" aria-keyshortcuts="Enter">
          Start free — 5 GB included <ArrowRight className="size-4" />
        </Link>
      </Button>
      <Button asChild variant="ghost" size="lg" className="ui-btn-quiet">
        <Link href="/#platform">
          Explore the platform <ArrowUpRight className="size-4" />
        </Link>
      </Button>
      <SharePageButton />
    </div>
  )
}

/**
 * Topic categories for the platform feature grid filter. Each card maps to
 * exactly one topic; "all" is the unfiltered default chip.
 */
type FeatureTopic = "files" | "lab" | "search" | "chat" | "automations"

const FEATURE_TOPICS: ReadonlyArray<{ id: FeatureTopic | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "lab", label: "Lab" },
  { id: "search", label: "Search" },
  { id: "chat", label: "Chat" },
  { id: "automations", label: "Automations" },
]

/**
 * Launch date of the Automations feature (Spindle 1.0, see
 * `changelogReleases` in `@/lib/changelog`). The "New" badge shows for the
 * first 7 days after launch and is hidden afterwards.
 */
const AUTOMATIONS_LAUNCH_DATE = "2026-11-19T00:00:00Z"
const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function isAutomationsNew() {
  const elapsed = Date.now() - Date.parse(AUTOMATIONS_LAUNCH_DATE)
  return elapsed >= 0 && elapsed < NEW_BADGE_WINDOW_MS
}

const features: ReadonlyArray<{
  slug: string
  iconSrc: string
  title: string
  body: string
  href: string
  category: FeatureTopic
  /** Shared capability labels used by "compare features" mode to find common ground. */
  tags: string[]
  /** Accessible name for the card link, e.g. "Learn more about Files". */
  ariaLabel: string
}> = [
  {
    slug: "one-home-per-project",
    iconSrc: "/icons/features/one-home-per-project.svg",
    title: "One home per project",
    body: "Data, notes, notebooks, results, and conversations stay together in one workspace.",
    href: "/#files",
    category: "files",
    tags: ["Project files", "Notes & notebooks", "Team chat"],
    ariaLabel: "Learn more about Files",
  },
  {
    slug: "automations",
    iconSrc: "/icons/features/automations.svg",
    title: "Automations",
    body: "Describe a workflow in plain language, or write a cron job yourself. Both live in the project.",
    href: "/automations",
    category: "automations",
    tags: ["Automations", "Project files", "Scheduled runs"],
    ariaLabel: "Learn more about Automations",
  },
  {
    slug: "lab",
    iconSrc: "/icons/features/lab.svg",
    title: "A lab that boots with it",
    body: "RStudio, JupyterLab, VS Code, and a terminal, already connected to your project files.",
    href: "/#lab",
    category: "lab",
    tags: ["Notebooks", "Project files", "R & Python"],
    ariaLabel: "Learn more about Lab",
  },
  {
    slug: "local-search",
    iconSrc: "/icons/features/local-search.svg",
    title: "Local search",
    body: "Academic and Basic modes run through a SearXNG instance hosted alongside Spindle.",
    href: "/#search",
    category: "search",
    tags: ["Local search", "Project files", "Privacy first"],
    ariaLabel: "Learn more about Search",
  },
  {
    slug: "files",
    iconSrc: "/icons/features/files.svg",
    title: "Files, viewed in place",
    body: "5 GB free, a clean file manager, and inline previews for more than 100 formats.",
    href: "/#files",
    category: "files",
    tags: ["Project files", "5 GB free", "Inline previews"],
    ariaLabel: "Learn more about Files",
  },
  {
    slug: "team-chat",
    iconSrc: "/icons/features/team-chat.svg",
    title: "Team chat",
    body: "Channels live inside each project, with an optional Anonymous mode (Nym Mixnet routing planned).",
    href: "/#chat",
    category: "chat",
    tags: ["Team chat", "Project files", "Privacy first"],
    ariaLabel: "Learn more about Team chat",
  },
]

/** Feature catalog shared with the "recently viewed" section below the grid. */
export const FEATURES = features

/**
 * Platform feature cards with an optional "compare features" mode. When the
 * compare checkbox is on, each card shows a selection checkbox instead of a
 * link; selecting two or more cards highlights the capability tags they all
 * share and lists them in the toolbar. Selection state lives here so both
 * the standalone grid and the topic-filtered `FeatureGrid` get it for free.
 */
export function FeatureCards({ topic = "all" }: { topic?: FeatureTopic | "all" }) {
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [announcement, setAnnouncement] = useState("")

  const visible = topic === "all" ? features : features.filter((f) => f.category === topic)

  const toggleSelected = (slug: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  // Intersection is computed over the full catalog so a topic filter change
  // can't silently drop a hidden-but-selected card from the comparison.
  const selectedFeatures = features.filter((f) => selected.has(f.slug))
  const commonTags =
    selectedFeatures.length >= 2
      ? selectedFeatures[0].tags.filter((tag) =>
          selectedFeatures.every((f) => f.tags.includes(tag)),
        )
      : []
  const commonTagSet = new Set(commonTags)

  const renderCard = (
    feature: (typeof features)[number],
    isCommon: (tag: string) => boolean,
  ) => (
    <Card className="ui-feature-card">
      <CardHeader className="ui-feature-header">
        <span className="card-icon">
          <Image src={feature.iconSrc} alt="" width={24} height={24} className="size-4" />
        </span>
        <CardTitle className="ui-feature-title">
          {feature.title}
          {feature.slug === "automations" && isAutomationsNew() && (
            <Badge variant="secondary" className="ui-feature-new-badge">
              New
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="ui-feature-content">
        <CardDescription className="ui-feature-desc">{feature.body}</CardDescription>
        {compareMode && (
          <ul className="ui-feature-tags" aria-label={`Features of ${feature.title}`}>
            {feature.tags.map((tag) => (
              <li
                key={tag}
                className={cn("ui-feature-tag", isCommon(tag) && "ui-feature-tag--common")}
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="ui-feature-compare-bar">
        <label className="ui-feature-compare-toggle">
          <Checkbox
            checked={compareMode}
            onCheckedChange={(checked) => {
              setCompareMode(checked === true)
              if (checked !== true) setSelected(new Set())
            }}
            aria-label="Compare features"
          />
          <span>Compare features</span>
        </label>
        {compareMode && (
          <>
            <span className="ui-feature-compare-status" aria-live="polite">
              {selected.size === 0
                ? "Select two or more cards"
                : `${selected.size} selected`}
            </span>
            {commonTags.length > 0 && (
              <span className="ui-feature-compare-common">
                Common to all: {commonTags.join(" · ")}
              </span>
            )}
            {selected.size > 0 && (
              <button
                type="button"
                className="ui-feature-compare-clear"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>
      {visible.map((feature) => {
        if (!compareMode) {
          const descId = `feature-${feature.slug}-desc`
          const featureName = feature.ariaLabel.replace(/^Learn more about /, "")
          return (
            <Link
              key={feature.slug}
              href={feature.href}
              className="ui-card-link"
              aria-label={feature.ariaLabel}
              aria-describedby={descId}
              data-analytics="feature-card"
              data-feature={feature.slug}
              data-page="home"
              onFocus={() => setAnnouncement(`${featureName} feature selected`)}
              onClick={() => recordFeatureView(feature.slug)}
            >
              {renderCard(feature, () => false)}
              <p id={descId} className="sr-only">
                {feature.body}
              </p>
            </Link>
          )
        }
        const isSelected = selected.has(feature.slug)
        return (
          <div
            key={feature.slug}
            className={cn(
              "ui-feature-compare-item",
              isSelected && "ui-feature-compare-item--selected",
              !isSelected && selected.size > 0 && "ui-feature-compare-item--dim",
            )}
          >
            <Checkbox
              className="ui-feature-compare-box"
              checked={isSelected}
              onCheckedChange={() => toggleSelected(feature.slug)}
              aria-label={`Compare ${feature.title}`}
            />
            <div
              className="ui-feature-compare-hit"
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${isSelected ? "Unselect" : "Select"} ${feature.title} for comparison`}
              onClick={() => toggleSelected(feature.slug)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  toggleSelected(feature.slug)
                }
              }}
            >
              {renderCard(feature, (tag) => commonTagSet.has(tag))}
            </div>
          </div>
        )
      })}
    </>
  )
}

const FEATURE_TOPIC_PARAM = "topic"
const FEATURE_GRID_ANCHOR = "#platform"
const SHARE_STATUS_RESET_MS = 2000

type FeatureShareStatus = "idle" | "copied" | "error"

/** `?topic=` values are validated against the chip ids; anything else is "all". */
function parseFeatureTopic(raw: string | null): FeatureTopic | "all" {
  return FEATURE_TOPICS.some((entry) => entry.id === raw)
    ? (raw as FeatureTopic | "all")
    : "all"
}

/**
 * Absolute URL that reopens the homepage feature grid with the same topic
 * filter applied. The default "all" filter is omitted to keep links short.
 */
function featureListShareUrl(topic: FeatureTopic | "all"): string {
  const params = new URLSearchParams()
  if (topic !== "all") params.set(FEATURE_TOPIC_PARAM, topic)
  const query = params.toString()
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}/${query ? `?${query}` : ""}${FEATURE_GRID_ANCHOR}`
}

/** execCommand fallback for browsers without the async clipboard API. */
function legacyCopyText(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)

  try {
    textarea.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

/**
 * Platform feature grid with a "filter by topic" chip bar, a "Share list"
 * button that copies a URL carrying the active filter in `?topic=`, and a
 * keyboard-accessible 2/3-column view toggle. All controls are plain buttons
 * in a `role="group"` using `aria-pressed`, matching the keyboard and
 * assistive-tech pattern used elsewhere on the homepage.
 */
export function FeatureGrid() {
  // `?topic=` seeds the filter so shared links reopen the same view;
  // `useSearchParams` suspends to the route's Suspense boundary during prerender.
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState<FeatureTopic | "all">(() =>
    parseFeatureTopic(searchParams.get(FEATURE_TOPIC_PARAM)),
  )
  const [columns, setColumns] = useState<FeatureGridColumns>(3)
  const [shareStatus, setShareStatus] = useState<FeatureShareStatus>("idle")
  const shareResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (shareResetTimer.current) clearTimeout(shareResetTimer.current)
    },
    [],
  )

  async function shareFeatureList() {
    const url = featureListShareUrl(topic)
    let copied = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        copied = true
      } catch {
        copied = false
      }
    }
    if (!copied) copied = legacyCopyText(url)

    setShareStatus(copied ? "copied" : "error")
    if (shareResetTimer.current) clearTimeout(shareResetTimer.current)
    shareResetTimer.current = setTimeout(() => setShareStatus("idle"), SHARE_STATUS_RESET_MS)
  }

  const shareLabel =
    shareStatus === "copied"
      ? "Link copied"
      : shareStatus === "error"
        ? "Copy failed"
        : "Share list"

  return (
    <div className="feature-grid-block">
      <div className="feature-grid-controls">
        <div className="feature-filter" role="group" aria-label="Filter features by topic">
          {FEATURE_TOPICS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="feature-filter__chip"
              aria-pressed={topic === id}
              onClick={() => setTopic(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="feature-grid-controls-actions">
          <button
            type="button"
            className="feature-share-btn"
            data-status={shareStatus}
            onClick={shareFeatureList}
          >
            <Share2 className="size-3.5" aria-hidden="true" />
            {shareLabel}
          </button>
          <div className="feature-grid-toggle" role="group" aria-label="Feature grid columns">
            {([2, 3] as const).map((count) => (
              <button
                key={count}
                type="button"
                className="feature-grid-toggle__option"
                aria-pressed={columns === count}
                onClick={() => setColumns(count)}
              >
                {count} columns
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        id={PRINT_WINDOW_ID}
        className={columns === 2 ? "feature-grid feature-grid--two" : "feature-grid"}
      >
        <FeatureCards topic={topic} />
      </div>
    </div>
  )
}

type FeatureGridColumns = 2 | 3

const PRINT_WINDOW_ID = "platform-feature-grid"

/* ------------------------------------------------------------------------ */
/* Homepage automations — cron command builder                               */
/* ------------------------------------------------------------------------ */

function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style: CSSProperties = {}

  if (token.color) style.color = token.color
  if (token.fontStyle) {
    if (token.fontStyle & 1) style.fontStyle = "italic"
    if (token.fontStyle & 2) style.fontWeight = 600
    if (token.fontStyle & 4) style.textDecoration = "underline"
  }

  return Object.keys(style).length > 0 ? style : undefined
}

const CRON_SPLIT_MIN = 0.2
const CRON_SPLIT_MAX = 0.8
const CRON_SPLIT_STEP = 0.05
const CRON_SPLIT_DEFAULT = 0.55

function clampCronSplit(value: number) {
  return Math.min(CRON_SPLIT_MAX, Math.max(CRON_SPLIT_MIN, value))
}

/**
 * Interactive cron job card for the homepage Automations section. The crontab
 * command line is built from the selected schedule preset and runtime
 * language instead of being hardcoded, so the demo command always matches the
 * options shown above it. `codeLines` carries server-highlighted Shiki tokens
 * for every schedule × runtime combination (see `home-cron-snippets.ts`).
 *
 * The code and run-output panes are separated by a draggable divider: pointer
 * events (mouse and touch, via pointer capture) resize it, and the separator
 * is keyboard-focusable (ArrowUp/ArrowDown/Home/End) for keyboard and
 * assistive-tech users.
 */
export function CronCommandBuilder({
  footer,
  codeLines,
}: {
  footer?: ReactNode
  codeLines: CronCodeLines
}) {
  const [scheduleKey, setScheduleKey] = useState<CronScheduleKey>("weekdays")
  const [languageKey, setLanguageKey] = useState<CronLanguageKey>("python")
  const [split, setSplit] = useState(CRON_SPLIT_DEFAULT)
  const splitRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startSplit: number
  } | null>(null)
  const schedule = CRON_SCHEDULES[scheduleKey]
  const language = CRON_LANGUAGES[languageKey]
  const lines = codeLines[languageKey][scheduleKey]

  function onSplitPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startSplit: split,
    }
  }

  function onSplitPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const container = splitRef.current
    if (!drag || !container || drag.pointerId !== event.pointerId) return
    const height = container.getBoundingClientRect().height
    if (height <= 0) return
    setSplit(clampCronSplit(drag.startSplit + (event.clientY - drag.startY) / height))
  }

  function onSplitPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onSplitKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    let next: number | null = null
    if (event.key === "ArrowUp") next = split - CRON_SPLIT_STEP
    else if (event.key === "ArrowDown") next = split + CRON_SPLIT_STEP
    else if (event.key === "Home") next = CRON_SPLIT_MIN
    else if (event.key === "End") next = CRON_SPLIT_MAX
    if (next === null) return
    event.preventDefault()
    setSplit(clampCronSplit(next))
  }

  const codePercent = Math.round(split * 100)

  return (
    <div className="code-card code-block-card">
      <div className="code-card-head">
        <span>{language.file}</span>
        <span className="mono">UTC</span>
      </div>
      <div className="cron-builder-controls">
        <label className="cron-builder-field">
          <span>Schedule</span>
          <select
            value={scheduleKey}
            onChange={(event) => setScheduleKey(event.target.value as CronScheduleKey)}
            aria-label="Cron schedule preset"
          >
            {(Object.keys(CRON_SCHEDULES) as CronScheduleKey[]).map((key) => (
              <option key={key} value={key}>
                {CRON_SCHEDULES[key].label}
              </option>
            ))}
          </select>
        </label>
        <label className="cron-builder-field">
          <span>Runtime</span>
          <select
            value={languageKey}
            onChange={(event) => setLanguageKey(event.target.value as CronLanguageKey)}
            aria-label="Script runtime language"
          >
            {(Object.keys(CRON_LANGUAGES) as CronLanguageKey[]).map((key) => (
              <option key={key} value={key}>
                {CRON_LANGUAGES[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="code-split" ref={splitRef}>
        <div
          className="code-split-pane code-split-pane--code"
          style={{ flexBasis: `${split * 100}%` }}
        >
          <pre aria-label={`${language.file} cron job`}>
            {lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? "\n" : null}
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </Fragment>
            ))}
          </pre>
        </div>
        <div
          className="code-split-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize code and output panes"
          aria-valuemin={Math.round(CRON_SPLIT_MIN * 100)}
          aria-valuemax={Math.round(CRON_SPLIT_MAX * 100)}
          aria-valuenow={codePercent}
          aria-valuetext={`${codePercent}% code, ${100 - codePercent}% output`}
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={onSplitPointerEnd}
          onPointerCancel={onSplitPointerEnd}
          onLostPointerCapture={onSplitPointerEnd}
          onKeyDown={onSplitKeyDown}
        >
          <span className="code-split-grip" aria-hidden="true" />
        </div>
        <div className="code-split-pane code-split-pane--output">
          <div className="cron-output-head mono">output · last run</div>
          <div className="cron-output" aria-label="Cron job output">
            <div className="cron-output-line">
              <span className="cron-output-time">{"06:00"}</span>
              <span>{schedule.comment}</span>
            </div>
            <div className="cron-output-line">
              <span className="cron-output-time">{"06:00:01"}</span>
              <span>{`$ ${language.command}`}</span>
            </div>
            <div className="cron-output-line">
              <span className="cron-output-time">{"06:00:02"}</span>
              <span>fetching noaa-tides · station 8454000</span>
            </div>
            <div className="cron-output-line">
              <span className="cron-output-time">{"06:00:04"}</span>
              <span>1,204 rows → data/tides.csv</span>
            </div>
            <div className="cron-output-line cron-output-line--ok">
              <span className="cron-output-time">{"06:00:42"}</span>
              <span>✓ exited 0 · synced in 42s</span>
            </div>
          </div>
        </div>
      </div>
      <div className="code-card-foot">{footer}</div>
    </div>
  )
}

const PRINT_WINDOW_CSS = `
  body.print-feature-page { margin: 0; background: var(--bg); color: var(--text); }
  .print-feature-toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 32px; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted);
    position: sticky; top: 0; background: var(--bg);
  }
  .print-feature-toolbar-actions { display: flex; gap: 8px; }
  .print-feature-toolbar button {
    font: inherit; color: var(--text); background: var(--surface);
    border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px;
    cursor: pointer;
  }
  .print-feature-toolbar button:hover { border-color: var(--border-strong); }
  .print-feature-main { padding: 48px 32px 64px; }
  .print-feature-title {
    font-family: var(--font-display); font-size: 28px; font-weight: 600;
    letter-spacing: -0.02em; margin: 0 0 8px;
  }
  .print-feature-sub { color: var(--text-muted); margin: 0 0 32px; font-size: 15px; }
  .print-feature-page .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .print-feature-page .ui-card-link,
  .print-feature-page .ui-feature-card { break-inside: avoid; }
  @media print {
    .print-feature-toolbar { display: none; }
    .print-feature-main { padding: 0; }
    .print-feature-page .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .print-feature-page .ui-feature-card { border-color: #999; }
  }
`

/**
 * Opens a popup window containing only the platform feature grid, styled
 * with the same stylesheets as the site, ready to print or save as PDF.
 */
export function FeatureListPrintButton() {
  const openPrintWindow = () => {
    const grid = document.getElementById(PRINT_WINDOW_ID)
    if (!grid) return

    const win = window.open("", "_blank", "width=960,height=720")
    if (!win) return

    const doc = document.documentElement
    const resources = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]'),
    )
      .map((node) => node.outerHTML)
      .join("\n")

    const html = [
      "<!doctype html>",
      `<html lang="${doc.lang || "en"}" class="${doc.className}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>Spindle — Feature list</title>",
      resources,
      `<style>${PRINT_WINDOW_CSS}</style>`,
      "</head>",
      '<body class="print-feature-page">',
      '<div class="print-feature-toolbar">',
      "<span>Spindle · Feature list</span>",
      '<span class="print-feature-toolbar-actions">',
      '<button type="button" onclick="window.print()">Print</button>',
      '<button type="button" onclick="window.close()">Close</button>',
      "</span>",
      "</div>",
      '<main class="container print-feature-main">',
      '<h1 class="print-feature-title">A home for every project</h1>',
      '<p class="print-feature-sub">Files, notebooks, results, conversations, and automations stay together, even when a project runs for years.</p>',
      grid.outerHTML,
      "</main>",
      "</body>",
      "</html>",
    ].join("")

    win.document.write(html)
    win.document.close()
    win.focus()
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="print-feature-btn"
      onClick={openPrintWindow}
    >
      <Printer className="size-3.5" />
      Print feature list
    </Button>
  )
}

const LOCAL_SEARCH_NOTE_STORAGE_KEY = "spindle.local-search-note-dismissed"

/** BibTeX entry for the demo project shown in the search section. */
export const PROJECT_BIBTEX_ENTRY = `@misc{coastal-resilience,
  title        = {Coastal resilience},
  author       = {Spindle Lab},
  howpublished = {Spindle project},
  note         = {Salt marsh restoration and blue carbon},
  year         = {2026},
}`

const CITATION_COPY_RESET_DELAY = 2000

export function LocalSearchNote() {
  const [visible, setVisible] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [citationCopied, setCitationCopied] = useState(false)
  const citationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(LOCAL_SEARCH_NOTE_STORAGE_KEY) !== "true")
    } catch {
      setVisible(true)
    }
  }, [])

  useEffect(
    () => () => {
      if (citationTimer.current) clearTimeout(citationTimer.current)
    },
    [],
  )

  if (!visible) return null

  const dismiss = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(LOCAL_SEARCH_NOTE_STORAGE_KEY, "true")
      } catch {
        // Storage unavailable (private mode, quota) — just hide for this visit.
      }
    }
    setVisible(false)
  }

  const copyCitation = async () => {
    let didCopy = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(PROJECT_BIBTEX_ENTRY)
        didCopy = true
      } catch {
        didCopy = false
      }
    }
    if (!didCopy) {
      // Fallback for non-secure contexts or denied clipboard permission.
      const input = document.createElement("textarea")
      input.value = PROJECT_BIBTEX_ENTRY
      input.setAttribute("readonly", "")
      input.style.position = "fixed"
      input.style.opacity = "0"
      document.body.appendChild(input)
      input.select()
      try {
        didCopy = document.execCommand("copy")
      } catch {
        didCopy = false
      } finally {
        document.body.removeChild(input)
      }
    }
    if (didCopy) {
      setCitationCopied(true)
      toast.success("Citation copied to clipboard", {
        description: PROJECT_BIBTEX_ENTRY,
        duration: 3000,
      })
      if (citationTimer.current) clearTimeout(citationTimer.current)
      citationTimer.current = setTimeout(() => setCitationCopied(false), CITATION_COPY_RESET_DELAY)
    } else {
      toast.error("Couldn't copy the citation", { duration: 4000 })
    }
  }

  return (
    <Alert className="ui-alert">
      <svg className="icon icon--xs" aria-hidden="true">
        <use href="#i-lock" />
      </svg>
      <AlertDescription className="ui-alert-desc">
        Searches don&apos;t leave Spindle to build an advertising profile.
        <Button
          variant="link"
          className="h-auto p-0 text-base underline"
          onClick={() => setPrivacyOpen(true)}
        >
          Learn More
        </Button>
        <Button
          variant="link"
          className="h-auto p-0 text-base underline"
          aria-label={citationCopied ? "Citation copied" : "Copy project citation"}
          onClick={() => void copyCitation()}
        >
          <svg className="icon icon--xs" aria-hidden="true">
            <use href={citationCopied ? "#i-check" : "#i-copy"} />
          </svg>
          {citationCopied ? "Citation copied" : "Copy citation"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={dontShowAgain}
            onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            aria-label="Don't show this note again"
          />
          Don&apos;t show again
        </label>
      </AlertDescription>
      <Badge
        variant="secondary"
        className="ui-privacy-score"
        aria-label="Privacy score: no tracking"
      >
        <svg className="icon icon--xs" aria-hidden="true">
          <use href="#i-lock" />
        </svg>
        No tracking
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Dismiss note"
        onClick={dismiss}
      >
        <X className="size-4" />
      </Button>
      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Search privacy</DialogTitle>
            <DialogDescription>
              What happens to a query when you search in Spindle.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Queries go to a SearXNG instance we host alongside Spindle — not a third-party,
              ad-supported search engine.
            </li>
            <li>
              We don&apos;t sell your data or use searches to build advertising profiles.
            </li>
            <li>
              Queries aren&apos;t stored unless you save them to a project. Saved results stay
              with the project and follow its access rules.
            </li>
            <li>Search fields are masked in session replays and error monitoring.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" asChild>
              <a href="/privacy">Privacy Policy</a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/security">Security</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Alert>
  )
}

export function FileActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="fm-btn ui-fm-btn">
          <Plus className="size-3" /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="ui-menu">
        <DropdownMenuLabel className="ui-menu-label">Create in /data</DropdownMenuLabel>
        <DropdownMenuSeparator className="ui-menu-separator" />
        <DropdownMenuItem className="ui-menu-item" data-fm-action="folder">
          <FolderPlus className="size-3.5" /> New folder
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="upload">
          <FileUp className="size-3.5" /> Upload file
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-menu-item" data-fm-action="notebook">
          <NotebookPen className="size-3.5" /> New notebook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StorageProgress() {
  return <Progress value={36} className="ui-progress" aria-label="1.8 of 5 GB used" />
}

const STORAGE_TOTAL_GB = 5
const STORAGE_MIN_GB = 1.5
const STORAGE_MAX_GB = 2.1
const STORAGE_TICK_MS = 4000
const STORAGE_STEP_GB = 0.08

/**
 * Live storage-usage widget for the hero window sidebar. Simulates usage
 * drifting up/down around the 1.8 GB baseline and animates the track width
 * via a CSS transition. The track exposes progressbar semantics so assistive
 * tech announces the used/total values.
 */
export function SidebarStorageUsage() {
  const [usedGb, setUsedGb] = useState(1.8)
  const trackRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      setUsedGb((current) => {
        const drift = (Math.random() - 0.5) * 2 * STORAGE_STEP_GB
        const next = current + drift
        if (next <= STORAGE_MIN_GB) return STORAGE_MIN_GB + Math.random() * STORAGE_STEP_GB
        if (next >= STORAGE_MAX_GB) return STORAGE_MAX_GB - Math.random() * STORAGE_STEP_GB
        return next
      })
    }, STORAGE_TICK_MS)
    return () => clearInterval(interval)
  }, [])

  const percent = Math.min(100, Math.max(0, (usedGb / STORAGE_TOTAL_GB) * 100))
  const usedLabel = usedGb.toFixed(1)

  // Width is applied via CSSOM (el.style.width) instead of a React `style`
  // prop: CSP `style-src` nonces/hashes only cover <style> elements and the
  // style *attribute*, so an SSR'd inline style would need 'unsafe-inline'.
  // The static 36% baseline and the transition live in styles.css
  // (.usage-track span); CSSOM property sets are not blocked by style-src.
  useEffect(() => {
    const track = trackRef.current
    if (track) track.style.width = `${percent}%`
  }, [percent])

  return (
    <div className="sidebar-usage">
      <div className="usage-label">
        <span>Storage</span>
        <span aria-live="polite">
          {usedLabel} / {STORAGE_TOTAL_GB} GB
        </span>
      </div>
      <div
        className="usage-track"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={STORAGE_TOTAL_GB}
        aria-valuenow={Math.round(usedGb * 100) / 100}
        aria-valuetext={`${usedLabel} of ${STORAGE_TOTAL_GB} GB used`}
      >
        <span ref={trackRef} aria-hidden="true" />
      </div>
    </div>
  )
}

export function AnonymousSwitch() {
  const [checked, setChecked] = useState(false)

  function toggle(value: boolean) {
    setChecked(value)
    document.getElementById("anonToggle")?.click()
  }

  return (
    // No aria-pressed here: the wrapper is a plain div (aria-pressed is only
    // valid on certain roles), and the Switch inside already exposes the
    // toggle state to assistive tech.
    <div className="anon-toggle ui-anon-toggle">
      <Switch
        checked={checked}
        onCheckedChange={toggle}
        className="ui-switch"
        aria-label="Anonymous mode"
      />
      <div>
        <strong>Anonymous mode</strong>
        <small>{checked ? "On · pseudonymous display" : "Off · normal project chat"}</small>
      </div>
    </div>
  )
}

export function PresenceAvatar() {
  return (
    <Avatar className="ui-avatar">
      <AvatarFallback className="ui-avatar-fallback">MR</AvatarFallback>
    </Avatar>
  )
}

const plans = [
  {
    name: "Hobby",
    price: "$0",
    tag: null,
    description: "For a single researcher or a project that's just getting started.",
    features: [
      "5 GB storage",
      "Lab, Search, Files, Agent, and Chat",
      "Automations and cron jobs",
      "20 agent requests per day",
    ],
    cta: "Create your workspace",
    href: "/sign-up",
    featured: true,
  },
  {
    name: "Enterprise",
    price: null,
    tag: "TALK TO US",
    description: "Custom features, dedicated support, and anything your organization needs.",
    features: [
      "Custom integrations and workflows",
      "Dedicated infrastructure and SLA",
      "Onboarding and training for your team",
    ],
    cta: "Contact us",
    href: "/about#contact",
    featured: false,
  },
]

export function PlanCards() {
  return (
    <>
      {plans.map((plan) => (
        <Card
          key={plan.name}
          className={`ui-plan-card${plan.featured ? "ui-plan-card--featured" : ""}`}
        >
          <CardHeader className="ui-plan-header">
            <CardTitle className="ui-plan-name">{plan.name}</CardTitle>
            {plan.price ? (
              <span className="ui-plan-price">{plan.price}</span>
            ) : (
              <span className="ui-plan-tag">{plan.tag}</span>
            )}
          </CardHeader>
          <CardContent className="ui-plan-content">
            <CardDescription className="ui-plan-desc">{plan.description}</CardDescription>
            <ul className="ui-plan-list">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="ui-plan-footer">
            <Button asChild className="ui-btn-primary ui-btn-full">
              <Link href={plan.href}>{plan.cta}</Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </>
  )
}

export function NetworkDiagram({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false)
  return (
    <div className={`network-scroll${paused ? " network-scroll--paused" : ""}`}>
      {children}
      <button
        type="button"
        className="network-pause"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {paused ? "Resume animations" : "Pause animations"}
      </button>
    </div>
  )
}
