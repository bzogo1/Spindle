"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"

import { DitherField } from "@/components/ui/dither-field"

/* Animated demos for the /workspace overview page. Each island loops on its
   own; under prefers-reduced-motion they render their final state statically. */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return reduced
}

/* ------------------------------------------------------------------ */
/* Hero dither field                                                   */
/* ------------------------------------------------------------------ */

const workspaceRamp = ["rgba(30, 52, 30, 0.4)", "#8ab661", "#e2f5c8"] as const

export function WorkspaceHeroField() {
  return (
    <DitherField
      className="ws-dither"
      pattern="aurora"
      color={workspaceRamp}
      dotSize={1.3}
      intensity={0.85}
      speed={0.55}
      fps={30}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Workspace tour — a mock of the app window cycling through tools     */
/* ------------------------------------------------------------------ */

const TOUR_PANELS = ["files", "lab", "search", "agent", "automations", "chat"] as const
type TourPanel = (typeof TOUR_PANELS)[number]

const TOUR_NAV: { id: TourPanel; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "#i-folder" },
  { id: "lab", label: "Lab", icon: "#i-flask" },
  { id: "search", label: "Search", icon: "#i-search" },
  { id: "agent", label: "Agent", icon: "#i-sparkle" },
  { id: "automations", label: "Automations", icon: "#i-bolt" },
  { id: "chat", label: "Chat", icon: "#i-message" },
]

function PanelShell({ children }: { children: React.ReactNode }) {
  return <div className="ws-panel">{children}</div>
}

function FilesPanel() {
  return (
    <PanelShell>
      <div className="ws-files-head">
        <span className="mono">coastal-resilience / files</span>
        <span className="ws-pill">5.0 GB free</span>
      </div>
      <ul className="ws-file-list">
        <li style={{ "--d": "0ms" } as CSSProperties}>
          <svg className="icon icon--xs">
            <use href="#i-folder" />
          </svg>{" "}
          data/
          <span className="ws-file-meta">2.1 GB</span>
        </li>
        <li style={{ "--d": "90ms" } as CSSProperties}>
          <svg className="icon icon--xs">
            <use href="#i-folder" />
          </svg>{" "}
          results/
          <span className="ws-file-meta">84 MB</span>
        </li>
        <li className="is-uploading" style={{ "--d": "180ms" } as CSSProperties}>
          <svg className="icon icon--xs">
            <use href="#i-upload" />
          </svg>{" "}
          survey-2026.parquet
          <span className="ws-file-bar">
            <i />
          </span>
        </li>
        <li style={{ "--d": "270ms" } as CSSProperties}>
          <svg className="icon icon--xs">
            <use href="#i-pen" />
          </svg>{" "}
          notes/lit-review.md
          <span className="ws-file-meta">12 KB</span>
        </li>
      </ul>
      <p className="ws-panel-note">100+ formats preview inline — no download needed.</p>
    </PanelShell>
  )
}

function LabPanel() {
  return (
    <PanelShell>
      <div className="ws-files-head">
        <span className="mono">lab / analysis.ipynb</span>
        <span className="ws-pill ws-pill--live">
          <i /> kernel warm
        </span>
      </div>
      <div className="ws-notebook">
        <div className="ws-cell" style={{ "--d": "0ms" } as CSSProperties}>
          <code>
            <span className="tok-key">import</span> pandas <span className="tok-key">as</span> pd
          </code>
        </div>
        <div className="ws-cell-out" style={{ "--d": "160ms" } as CSSProperties}>
          48,102 rows × 14 cols
        </div>
        <div className="ws-cell" style={{ "--d": "320ms" } as CSSProperties}>
          <code>
            df.groupby(<span className="tok-str">'site'</span>).salinity.mean()
          </code>
        </div>
        <svg className="ws-mini-plot" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true">
          <path
            className="ws-mini-plot-line"
            d="M0 44 C30 40 44 46 70 34 S116 18 140 26 S180 12 200 6"
          />
        </svg>
      </div>
      <p className="ws-panel-note">R, Python, SQL, canvas, and math — files already mounted.</p>
    </PanelShell>
  )
}

function SearchPanel() {
  const results = [
    { title: "survey-2026.parquet", meta: "Files · data/", d: "200ms" },
    { title: "salinity-by-site.ipynb", meta: "Lab · coastal-resilience", d: "380ms" },
    { title: "12 web sources", meta: "SearXNG · local", d: "560ms" },
  ]
  return (
    <PanelShell>
      <div className="ws-searchbar">
        <svg className="icon icon--xs">
          <use href="#i-search" />
        </svg>
        <span>tidal salinity by site</span>
        <kbd>⏎</kbd>
      </div>
      <ul className="ws-result-list">
        {results.map((r) => (
          <li key={r.title} style={{ "--d": r.d } as CSSProperties}>
            <strong>{r.title}</strong>
            <span>{r.meta}</span>
          </li>
        ))}
      </ul>
      <p className="ws-panel-note">Academic + Basic modes, hosted next to your workspace.</p>
    </PanelShell>
  )
}

function AgentPanel() {
  const steps = [
    { text: "read data/survey.parquet", d: "0ms" },
    { text: "move raw/tides-2026.csv → data/", d: "320ms" },
    { text: "write results/summary.md", d: "640ms" },
    { text: "fold 3 new sources into notes/", d: "960ms" },
  ]
  return (
    <PanelShell>
      <div className="ws-files-head">
        <span className="mono">agent · coastal-resilience</span>
        <span className="ws-pill ws-pill--live">
          <i /> working
        </span>
      </div>
      <ul className="ws-agent-log">
        {steps.map((s) => (
          <li key={s.text} style={{ "--d": s.d } as CSSProperties}>
            <span className="ws-agent-check">
              <svg className="icon icon--xs">
                <use href="#i-check" />
              </svg>
            </span>
            {s.text}
          </li>
        ))}
      </ul>
      <p className="ws-panel-note">Edits files, moves folders, runs on its own — 20/day free.</p>
    </PanelShell>
  )
}

function AutomationsPanel() {
  const jobs = [
    { cron: "0 9 * * 1", label: "Weekly digest → chat", d: "0ms" },
    { cron: "*/15 * * * *", label: "Sync lab snapshots", d: "140ms" },
    { cron: "0 0 1 * *", label: "Archive month → files", d: "280ms" },
  ]
  return (
    <PanelShell>
      <div className="ws-files-head">
        <span className="mono">automations</span>
        <span className="ws-pill">3 active</span>
      </div>
      <ul className="ws-cron-list">
        {jobs.map((j) => (
          <li key={j.label} style={{ "--d": j.d } as CSSProperties}>
            <code>{j.cron}</code>
            <span>{j.label}</span>
            <i className="ws-toggle is-on" />
          </li>
        ))}
      </ul>
      <p className="ws-panel-note">Text it, build it visually, or write the cron yourself.</p>
    </PanelShell>
  )
}

function ChatPanel() {
  return (
    <PanelShell>
      <div className="ws-files-head">
        <span className="mono">#coastal-resilience</span>
        <span className="ws-pill ws-pill--live">
          <i /> 3 online
        </span>
      </div>
      <ul className="ws-chat-list">
        <li style={{ "--d": "0ms" } as CSSProperties}>
          <b>mara</b> pushed survey-2026.parquet — salinity column renamed
        </li>
        <li style={{ "--d": "260ms" } as CSSProperties}>
          <b>you</b> ran the site breakdown in the Lab
        </li>
        <li style={{ "--d": "520ms" } as CSSProperties}>
          <b>okafor</b> left 2 comments on results/fig-01.png
        </li>
      </ul>
      <div className="ws-cursors" aria-hidden="true">
        <span className="ws-cursor ws-cursor--a">mara</span>
        <span className="ws-cursor ws-cursor--b">okafor</span>
      </div>
      <p className="ws-panel-note">Channels per project, live cursors, optional anonymity.</p>
    </PanelShell>
  )
}

const PANEL_RENDER: Record<TourPanel, () => React.ReactElement> = {
  files: FilesPanel,
  lab: LabPanel,
  search: SearchPanel,
  agent: AgentPanel,
  automations: AutomationsPanel,
  chat: ChatPanel,
}

const PANEL_TITLES: Record<TourPanel, string> = {
  files: "Files",
  lab: "The Lab",
  search: "Local search",
  agent: "Agent",
  automations: "Automations",
  chat: "Team chat",
}

const PANEL_BLURBS: Record<TourPanel, string> = {
  files: "One file tree for the whole project — 5 GB free, 100+ inline previews.",
  lab: "Notebooks, R, SQL, canvas, and math running next to your files.",
  search: "Academic and Basic modes through SearXNG, hosted with your workspace.",
  agent: "Ask it to refactor a pipeline, move a folder, or summarize new sources.",
  automations: "Scheduled jobs and agent triggers — text it, build it, or cron it.",
  chat: "Project channels with live cursors and an optional anonymous mode.",
}

export function WorkspaceTour() {
  const [active, setActive] = useState<TourPanel>("lab")
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) return
    const t = window.setInterval(() => {
      setActive((a) => TOUR_PANELS[(TOUR_PANELS.indexOf(a) + 1) % TOUR_PANELS.length])
    }, 4600)
    return () => window.clearInterval(t)
  }, [reduced])

  const Panel = PANEL_RENDER[active]
  const activeIndex = TOUR_PANELS.indexOf(active)

  return (
    <div className="ws-tour">
      <div className="ws-tour-bar">
        <span className="ws-tour-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mono ws-tour-title">spindle / coastal-resilience</span>
        <span className="ws-pill ws-pill--live">
          <i /> synced
        </span>
      </div>
      <div className="ws-tour-body">
        <nav className="ws-tour-nav" aria-label="Workspace sections">
          {TOUR_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === active ? "is-active" : undefined}
              onClick={() => setActive(item.id)}
              aria-pressed={item.id === active}
            >
              <svg className="icon icon--xs" aria-hidden="true">
                <use href={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ws-tour-main">
          <div className="ws-tour-pane" key={active}>
            <Panel />
          </div>
          <div className="ws-tour-caption">
            <strong>{PANEL_TITLES[active]}</strong>
            <span>{PANEL_BLURBS[active]}</span>
          </div>
        </div>
      </div>
      <div className="ws-tour-progress" aria-hidden="true">
        <div className="ws-tour-progress-track">
          <i
            key={activeIndex}
            className="ws-tour-progress-fill"
            style={{ animationDuration: reduced ? "0s" : "4.6s" }}
          />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lab — animated SSH session into the project host                    */
/* ------------------------------------------------------------------ */

type TermKind = "cmd" | "out" | "ok" | "dim" | "sys"

type TermLine = { kind: TermKind; text: string }

const SSH_SCRIPT: TermLine[] = [
  { kind: "cmd", text: "ssh coastal-resilience@spindle.sh" },
  { kind: "dim", text: "authenticating with ed25519 key \"bogdan-mbp\" …" },
  { kind: "ok", text: "✓ key accepted · signed challenge verified" },
  { kind: "dim", text: "negotiating cipher … aes256-gcm, umac-128" },
  { kind: "ok", text: "✓ encrypted channel · forward secrecy on" },
  { kind: "sys", text: "── connected to lab.coastal-resilience.spindle.internal ──" },
  { kind: "cmd", text: "rstudio --project coastal-resilience" },
  { kind: "out", text: "R 4.4.1 ready · kernel warm in 0.4s" },
  { kind: "dim", text: "> survey <- read_parquet(\"data/survey.parquet\")" },
  { kind: "out", text: "48,102 rows × 14 cols · mounted from /workspace" },
  { kind: "ok", text: "✓ snapshot s-1042 recorded" },
  { kind: "cmd", text: "python3 analysis/run.py" },
  { kind: "out", text: "pandas 2.3 · matplotlib 3.10 · duckdb-wasm ready" },
  { kind: "out", text: "fig.01 written → results/turbidity-by-site.png" },
  { kind: "ok", text: "✓ session synced back to your workspace" },
]

export function LabSshDemo() {
  const reduced = usePrefersReducedMotion()
  const [lines, setLines] = useState<TermLine[]>([])
  const [current, setCurrent] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, current])

  useEffect(() => {
    if (reduced) {
      setLines(SSH_SCRIPT)
      return
    }
    let cancelled = false
    let timer: number | undefined
    let li = 0
    let ci = 0

    const step = () => {
      if (cancelled) return
      if (li >= SSH_SCRIPT.length) {
        timer = window.setTimeout(() => {
          if (cancelled) return
          setLines([])
          setCurrent("")
          li = 0
          ci = 0
          step()
        }, 4600)
        return
      }
      const line = SSH_SCRIPT[li]
      if (ci < line.text.length) {
        setCurrent(line.text.slice(0, ci + 1))
        ci += 1
        timer = window.setTimeout(step, line.kind === "cmd" ? 34 : 13)
      } else {
        setLines((prev) => [...prev, line])
        setCurrent("")
        li += 1
        ci = 0
        timer = window.setTimeout(
          step,
          line.kind === "cmd" ? 620 : line.kind === "ok" ? 720 : line.kind === "dim" ? 200 : 320,
        )
      }
    }

    timer = window.setTimeout(step, 700)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [reduced])

  return (
    <div className="ws-demo-window">
      <div className="ws-demo-bar">
        <span className="ws-demo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mono">you → spindle edge → lab host</span>
        <span className="ws-pill ws-pill--live">
          <i /> ssh-2
        </span>
      </div>
      <div className="ws-tunnel" aria-hidden="true">
        <span className="ws-tunnel-node">you</span>
        <span className="ws-tunnel-track">
          <i className="ws-tunnel-packet ws-tunnel-packet--a" />
          <i className="ws-tunnel-packet ws-tunnel-packet--b" />
        </span>
        <span className="ws-tunnel-node">edge</span>
        <span className="ws-tunnel-track">
          <i className="ws-tunnel-packet ws-tunnel-packet--c" />
          <i className="ws-tunnel-packet ws-tunnel-packet--d" />
        </span>
        <span className="ws-tunnel-node">lab</span>
      </div>
      <div className="ws-term" ref={scrollRef} aria-label="Animated SSH session preview">
        {lines.map((line, i) => (
          <div key={i} className={`ws-term-line ws-term-line--${line.kind}`}>
            {line.kind === "cmd" && <span className="ws-term-prompt">$</span>}
            {line.text}
          </div>
        ))}
        {current !== "" && (
          <div className="ws-term-line ws-term-line--cmd">
            <span className="ws-term-prompt">$</span>
            {current}
            <span className="ws-caret" />
          </div>
        )}
        {current === "" && lines.length > 0 && lines.length < SSH_SCRIPT.length && (
          <span className="ws-caret" />
        )}
      </div>
      <div className="ws-demo-foot mono">aes256-gcm · forward secrecy · session synced</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Local search demo                                                    */
/* ------------------------------------------------------------------ */

const SEARCH_QUERY = "tidal salinity by site 2026"

const SEARCH_RESULTS = [
  { title: "survey-2026.parquet", meta: "Files · data/ · 2.1 GB", d: "0ms" },
  { title: "salinity-by-site.ipynb", meta: "Lab · coastal-resilience", d: "220ms" },
  { title: "Tidal gauge network — 14 sources", meta: "Web · SearXNG (local)", d: "440ms" },
]

export function SearchDemo() {
  const reduced = usePrefersReducedMotion()
  const [cycle, setCycle] = useState(0)
  const [query, setQuery] = useState("")
  const [visible, setVisible] = useState(0)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (reduced) {
      setQuery(SEARCH_QUERY)
      setVisible(SEARCH_RESULTS.length)
      setSaved(true)
      return
    }
    let cancelled = false
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(() => !cancelled && fn(), ms))
    }

    setQuery("")
    setVisible(0)
    setSaved(false)

    // Type the query.
    for (let i = 1; i <= SEARCH_QUERY.length; i++) {
      later(() => setQuery(SEARCH_QUERY.slice(0, i)), 500 + i * 42)
    }
    const resultsStart = 500 + SEARCH_QUERY.length * 42 + 500
    // Reveal results one by one, then the "saved" chip, then loop.
    SEARCH_RESULTS.forEach((_, i) => {
      later(() => setVisible(i + 1), resultsStart + i * 420)
    })
    later(() => setSaved(true), resultsStart + SEARCH_RESULTS.length * 420 + 300)
    later(() => setCycle((c) => c + 1), resultsStart + SEARCH_RESULTS.length * 420 + 3400)

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [reduced, cycle])

  return (
    <div className="ws-demo-window">
      <div className="ws-demo-bar">
        <span className="ws-demo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mono">search · coastal-resilience</span>
        <span className="ws-pill">local</span>
      </div>
      <div className="ws-searchdemo">
        <div className="ws-searchbar ws-searchbar--big">
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <span className={query ? undefined : "is-placeholder"}>
            {query || "Search files, lab, and the web…"}
          </span>
          {query && <span className="ws-caret" />}
        </div>
        <ul className="ws-result-list ws-result-list--big">
          {SEARCH_RESULTS.slice(0, visible).map((r) => (
            <li key={r.title} className="is-shown">
              <strong>{r.title}</strong>
              <span>{r.meta}</span>
            </li>
          ))}
        </ul>
        <div className={`ws-saved-chip ${saved ? "is-on" : ""}`}>
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-check" />
          </svg>{" "}
          Saved to notes/lit-review.md
        </div>
      </div>
      <div className="ws-demo-foot mono">SearXNG · no ads · no tracking profile</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Agent demo — scripted file operations                               */
/* ------------------------------------------------------------------ */

const AGENT_TREE: { id: string; label: string; kind: "folder" | "file"; indent?: boolean }[] = [
  { id: "data", label: "data/", kind: "folder" },
  { id: "survey", label: "survey.parquet", kind: "file", indent: true },
  { id: "tides", label: "tides-2026.csv", kind: "file", indent: true },
  { id: "raw", label: "raw/", kind: "folder" },
  { id: "results", label: "results/", kind: "folder" },
  { id: "summary", label: "summary.md", kind: "file", indent: true },
  { id: "notes", label: "notes/", kind: "folder" },
  { id: "lit", label: "lit-review.md", kind: "file", indent: true },
] as const

const AGENT_STEPS = [
  { path: "data/survey.parquet", log: "read data/survey.parquet — 14 cols" },
  { path: "data/tides-2026.csv", log: "move raw/tides-2026.csv → data/" },
  { path: "results/summary.md", log: "write results/summary.md — salinity −4.1% YoY" },
  { path: "notes/lit-review.md", log: "fold 3 new sources into lit-review" },
] as const

const STEP_HIGHLIGHT: Record<number, string[]> = {
  0: ["survey"],
  1: ["tides", "data"],
  2: ["summary", "results"],
  3: ["lit", "notes"],
}

export function AgentDemo() {
  const reduced = usePrefersReducedMotion()
  const [step, setStep] = useState(0)
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    if (reduced) {
      setStep(AGENT_STEPS.length - 1)
      setLog(AGENT_STEPS.map((s) => s.log))
      return
    }
    let cancelled = false
    let timer: number | undefined
    let i = 0

    const run = () => {
      if (cancelled) return
      if (i >= AGENT_STEPS.length) {
        timer = window.setTimeout(() => {
          if (cancelled) return
          setLog([])
          setStep(0)
          i = 0
          run()
        }, 3600)
        return
      }
      setStep(i)
      setLog((prev) => [...prev, AGENT_STEPS[i].log].slice(-4))
      i += 1
      timer = window.setTimeout(run, 1700)
    }

    timer = window.setTimeout(run, 500)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [reduced])

  const highlight = STEP_HIGHLIGHT[step] ?? []

  return (
    <div className="ws-demo-window">
      <div className="ws-demo-bar">
        <span className="ws-demo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mono">agent · coastal-resilience</span>
        <span className="ws-pill ws-pill--live">
          <i /> {step >= AGENT_STEPS.length ? "idle" : "working"}
        </span>
      </div>
      <div className="ws-agent">
        <ul className="ws-tree" aria-label="Project file tree preview">
          {AGENT_TREE.map((row) => (
            <li
              key={row.id}
              className={
                highlight.includes(row.id)
                  ? `is-active${row.indent ? " is-indent" : ""}`
                  : row.indent
                    ? "is-indent"
                    : undefined
              }
            >
              <svg className="icon icon--xs" aria-hidden="true">
                <use href={row.kind === "folder" ? "#i-folder" : "#i-pen"} />
              </svg>
              {row.label}
            </li>
          ))}
        </ul>
        <div className="ws-agent-feed">
          <p className="ws-agent-status mono">
            {step >= AGENT_STEPS.length
              ? "done · 4 changes · undo available"
              : `step ${step + 1}/4 · ${AGENT_STEPS[step]?.path ?? ""}`}
          </p>
          <ul className="ws-agent-log">
            {log.map((entry, i) => (
              <li
                key={`${i}-${entry}`}
                className={`is-in${i === log.length - 1 ? " is-latest" : ""}`}
              >
                <span className="ws-agent-check">
                  <svg className="icon icon--xs">
                    <use href="#i-check" />
                  </svg>
                </span>
                {entry}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="ws-demo-foot mono">every change is a snapshot you can roll back</div>
    </div>
  )
}
