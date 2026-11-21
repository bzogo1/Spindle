"use client"

/**
 * Full client-side simulation of the Spindle Lab workspace for
 * /lab-notebook-preview. Four surfaces share one project and one SSH session:
 *
 * - an editor with a clickable file tree and simulated script runs,
 * - a Jupyter notebook with re-runnable cells (hidden static outputs),
 * - an RStudio layout with a console that answers a handful of R commands,
 * - an SSH terminal with a small command interpreter.
 *
 * Nothing here talks to a server. Terminal input is interpreted locally and
 * every "run" is a timer.
 */

import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  Database,
  FileCode2,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  HardDrive,
  KeyRound,
  Lock,
  Loader2,
  LockKeyhole,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  Wifi,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  IDE_FILES,
  NOTEBOOK_CELLS,
  NOTEBOOK_VARIABLES,
  R_ENVIRONMENT,
  R_HISTORY,
  R_PACKAGES,
  R_SESSION_BANNER,
  R_SOURCE,
  SURVEY_SCHEMA,
  type IdeFile,
  type IdeLanguage,
  type NotebookCell,
} from "./lab-data"

/* -------------------------------------------------------------------------- */
/* Syntax highlighting                                                        */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const PYTHON_TOKEN =
  /(#.*$)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(@[A-Za-z_]\w*)|\b(import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|with|try|except|finally|raise|lambda|yield|pass|break|continue|global|assert|async|await)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\()/g

const R_TOKEN =
  /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(TRUE|FALSE|NULL|NA|Inf|NaN|if|else|repeat|while|function|for|in|next|break)\b|(<-|->|\|>|%>%)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_.][\w.]*)(?=\()/g

function tokenizeLine(line: string, pattern: RegExp, classes: string[]) {
  let output = ""
  let lastIndex = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    output += escapeHtml(line.slice(lastIndex, index))
    const raw = match[0]
    const groupIndex = match.findIndex((group, groupPosition) => groupPosition > 0 && group)
    const className = groupIndex > 0 ? classes[groupIndex - 1] : ""
    output += className ? `<span class="${className}">${escapeHtml(raw)}</span>` : escapeHtml(raw)
    lastIndex = index + raw.length
  }
  return output + escapeHtml(line.slice(lastIndex))
}

function highlightLine(line: string, language: IdeLanguage) {
  if (language === "python") {
    return tokenizeLine(line, PYTHON_TOKEN, [
      "tok-com",
      "tok-str",
      "tok-dec",
      "tok-key",
      "tok-num",
      "tok-fn",
    ])
  }
  if (language === "r") {
    return tokenizeLine(line, R_TOKEN, [
      "tok-com",
      "tok-str",
      "tok-key",
      "tok-op",
      "tok-num",
      "tok-fn",
    ])
  }
  if (language === "yaml") {
    let output = escapeHtml(line)
    const comment = output.indexOf("#")
    if (comment >= 0) {
      output = `${output.slice(0, comment)}<span class="tok-com">${output.slice(comment)}</span>`
    }
    output = output.replace(/^(\s*)([\w.-]+)(:)/, '$1<span class="tok-key">$2</span>$3')
    return output
  }
  if (language === "markdown") {
    if (/^#{1,6} /.test(line)) return `<span class="tok-key">${escapeHtml(line)}</span>`
    if (/^\s*[-*] /.test(line))
      return `<span class="tok-op">${escapeHtml(line.slice(0, line.search(/\S/)))}</span>${escapeHtml(line.trimStart())}`
    return escapeHtml(line).replace(/`([^`]+)`/g, '<span class="tok-str">`$1`</span>')
  }
  return escapeHtml(line)
}

function CodeView({ code, language }: { code: string; language: IdeLanguage }) {
  const lines = code.split("\n")
  // A believable "cursor" line: the first body line of the file.
  const caretLine = language === "python" ? 6 : language === "r" ? 8 : 3

  return (
    <div className="lnp-code" role="presentation">
      {lines.map((line, index) => (
        <div key={index} className={`lnp-code-line${index === caretLine - 1 ? "is-current" : ""}`}>
          <span className="lnp-gutter">{index + 1}</span>
          <span
            className="lnp-code-text"
            dangerouslySetInnerHTML={{
              __html:
                highlightLine(line, language) +
                (index === caretLine - 1 ? '<span class="lnp-caret"></span>' : ""),
            }}
          />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shell constants                                                            */
/* -------------------------------------------------------------------------- */

type ToolId = "ide" | "notebook" | "rstudio" | "terminal"

const TOOLS: {
  id: ToolId
  label: string
  app: string
  file: string
  Icon: typeof Code2
}[] = [
  { id: "ide", label: "Editor", app: "VS Code", file: "clean_data.py", Icon: Code2 },
  { id: "notebook", label: "Notebook", app: "JupyterLab", file: "analysis.ipynb", Icon: BookOpen },
  { id: "rstudio", label: "RStudio", app: "RStudio", file: "salinity.R", Icon: FlaskConical },
  { id: "terminal", label: "SSH", app: "Secure shell", file: "sec-01", Icon: Terminal },
]

const PROMPT = "mara@sec-01:~/projects/coastal-resilience$"

function formatSession(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":")
}

function useCleanupTimers() {
  const timers = useRef<number[]>([])
  useEffect(() => {
    const current = timers.current
    return () => {
      for (const timer of current) window.clearTimeout(timer)
    }
  }, [])
  return timers
}

/* -------------------------------------------------------------------------- */
/* Secure connection panel                                                    */
/* -------------------------------------------------------------------------- */

function ConnectionPanel({
  verified,
  verifying,
  onVerify,
  onClose,
}: {
  verified: boolean
  verifying: boolean
  onVerify: () => void
  onClose: () => void
}) {
  return (
    <div className="lnp-dialog-layer">
      <button
        type="button"
        className="lnp-dialog-backdrop"
        aria-label="Close connection details"
        onClick={onClose}
      />
      <section
        className="lnp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lnp-conn-title"
      >
        <header className="lnp-dialog-head">
          <span className="lnp-dialog-icon">
            <ShieldCheck aria-hidden="true" size={16} />
          </span>
          <div>
            <h2 id="lnp-conn-title">Secure connection</h2>
            <p className="lnp-mono">sec-01.fra.spindle.dev:22</p>
          </div>
          <span className={`lnp-conn-state${verified ? "is-ok" : "is-warn"}`}>
            {verified ? (
              <Check aria-hidden="true" size={11} />
            ) : (
              <AlertTriangle aria-hidden="true" size={11} />
            )}
            {verified ? "Verified" : "Unverified"}
          </span>
          <button type="button" className="lnp-icon-btn" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" size={14} />
          </button>
        </header>

        <dl className="lnp-dialog-rows">
          <div>
            <dt>Host key</dt>
            <dd className="lnp-mono">SHA256:q9m2wL7dA4vR1xHc0pNj8sKfT6yQe3f7Kp</dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>ed25519 · mara@field-laptop</dd>
          </div>
          <div>
            <dt>Tunnel</dt>
            <dd>TLS 1.3 · TLS_AES_256_GCM_SHA384</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd className="lnp-mono">0x5f3a21c9 · start 09:14:02 UTC</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>24 ms · fra1 → sec-01 (Frankfurt)</dd>
          </div>
          <div>
            <dt>Forwarded</dt>
            <dd className="lnp-mono">8888 → lab-notebook · 8787 → rstudio · 5432 closed</dd>
          </div>
        </dl>

        <footer className="lnp-dialog-foot">
          <p>
            Host key pinned on first connect. Managed keys live in <code>~/.ssh/config</code>; the
            session is re-keyed every 10 minutes.
          </p>
          <button
            type="button"
            className="lnp-btn lnp-btn--primary"
            onClick={onVerify}
            disabled={verifying}
          >
            {verifying ? (
              <Loader2 aria-hidden="true" size={12} className="lnp-spin" />
            ) : (
              <KeyRound aria-hidden="true" size={12} />
            )}
            {verifying
              ? "Verifying host key…"
              : verified
                ? "Re-verify host key"
                : "Verify host key"}
          </button>
        </footer>
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

const IDE_RUN_OUTPUT: Record<string, string[]> = {
  "scripts/clean_data.py": [
    "$ python scripts/clean_data.py --input data/survey.parquet",
    "2026-11-21 11:41:02 INFO  loading data/survey.parquet",
    "2026-11-21 11:41:02 INFO  loaded 48,102 rows x 14 columns",
    "2026-11-21 11:41:02 INFO  dropped 212 duplicate samples",
    "2026-11-21 11:41:03 INFO  imputed 37 missing turbidity values (median)",
    "2026-11-21 11:41:03 INFO  clipped 4 salinity outliers to [0, 42]",
    "2026-11-21 11:41:03 INFO  wrote outputs/clean.parquet (47,890 rows)",
    "2026-11-21 11:41:03 INFO  validation passed in 1.84s",
    "",
    "Process exited with code 0",
  ],
  "scripts/fit_model.py": [
    "$ python scripts/fit_model.py",
    "loaded 47,890 rows · 6 features · grouped by site",
    "fitting RandomForestRegressor(n_estimators=400, max_depth=12)",
    "train R2  0.931",
    "val R2    0.874",
    "val MAE   2.61 NTU",
    "top driver: rainfall_7d (0.284)",
    "wrote outputs/rf-turbidity.joblib (48.2 MB)",
    "",
    "Process exited with code 0",
  ],
  "scripts/plot_trends.py": [
    "$ python scripts/plot_trends.py",
    "reading outputs/clean.parquet (47,890 rows)",
    "resampling monthly means for 12 stations",
    "matplotlib: using Agg backend",
    "wrote outputs/trends-2026.png (1240 × 760 · 214 KB)",
    "",
    "Process exited with code 0",
  ],
}

function ExplorerFile({
  file,
  active,
  onOpen,
}: {
  file: IdeFile
  active: boolean
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className={`lnp-tree-row${active ? "is-active" : ""}`}
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
      >
        <FileCode2
          aria-hidden="true"
          size={13}
          className={
            file.language === "markdown" ? "is-md" : file.language === "yaml" ? "is-yaml" : ""
          }
        />
        <span className="lnp-tree-name">{file.name}</span>
        {file.status ? (
          <span className={`lnp-git-mark lnp-git-mark--${file.status.toLowerCase()}`}>
            {file.status}
          </span>
        ) : null}
      </button>
    </li>
  )
}

function SurveyPreview() {
  return (
    <div className="lnp-parquet">
      <div className="lnp-parquet-head">
        <span className="lnp-file-badge">
          <Database aria-hidden="true" size={14} /> parquet
        </span>
        <div>
          <strong>data/survey.parquet</strong>
          <p className="lnp-mono">48,102 rows · 14 columns · 6.4 MB · read-only mount</p>
        </div>
      </div>
      <table className="lnp-table">
        <thead>
          <tr>
            <th>column</th>
            <th>type</th>
            <th>nulls</th>
            <th>notes</th>
          </tr>
        </thead>
        <tbody>
          {SURVEY_SCHEMA.map((row) => (
            <tr key={row.column}>
              <td className="lnp-mono">{row.column}</td>
              <td className="lnp-mono is-dim">{row.type}</td>
              <td className={row.nulls === "0.0%" ? "" : "lnp-warn-text"}>{row.nulls}</td>
              <td className="is-dim">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lnp-parquet-note">
        Binary preview rendered from footer metadata. Query it with{" "}
        <code>duckdb.sql("SELECT * FROM 'data/survey.parquet' LIMIT 10")</code> or open{" "}
        <code>scripts/clean_data.py</code>.
      </p>
    </div>
  )
}

function IdePanel() {
  const [activePath, setActivePath] = useState("scripts/clean_data.py")
  const [output, setOutput] = useState<string[]>(["Output cleared. Run a file to see logs."])
  const [running, setRunning] = useState(false)
  const [panelTab, setPanelTab] = useState<"output" | "problems" | "terminal">("output")
  const timers = useCleanupTimers()

  const activeFile = IDE_FILES.find((file) => file.path === activePath) ?? IDE_FILES[0]
  const isTable = activeFile.language === "table"
  const scriptOutput = IDE_RUN_OUTPUT[activeFile.path]
  const canRun = Boolean(scriptOutput)

  const runFile = useCallback(() => {
    if (running || !scriptOutput) return
    setPanelTab("output")
    setRunning(true)
    setOutput([])
    scriptOutput.forEach((line, index) => {
      timers.current.push(
        window.setTimeout(
          () => {
            setOutput((previous) => [...previous, line])
            if (index === scriptOutput.length - 1) setRunning(false)
          },
          180 + index * 150,
        ),
      )
    })
  }, [running, scriptOutput, timers])

  return (
    <div className="lnp-ide">
      <aside className="lnp-explorer" aria-label="Project files">
        <div className="lnp-pane-head">
          <span>Explorer</span>
          <span className="lnp-pane-actions">
            <Plus aria-hidden="true" size={12} />
            <Search aria-hidden="true" size={12} />
          </span>
        </div>
        <div className="lnp-project-row">
          <ChevronDown aria-hidden="true" size={12} />
          <span className="lnp-project-name">COASTAL-RESILIENCE</span>
          <span className="lnp-mono lnp-git-branch">
            <GitBranch aria-hidden="true" size={10} /> main*
          </span>
        </div>

        <ul className="lnp-tree">
          <li className="lnp-tree-folder">
            <ChevronDown aria-hidden="true" size={12} />
            <Folder aria-hidden="true" size={13} />
            data
          </li>
          {IDE_FILES.filter((file) => file.dir === "data").map((file) => (
            <li key={file.path} className="lnp-tree-indent">
              <ExplorerFile
                file={file}
                active={file.path === activePath}
                onOpen={() => setActivePath(file.path)}
              />
            </li>
          ))}
          <li className="lnp-tree-folder">
            <ChevronDown aria-hidden="true" size={12} />
            <Folder aria-hidden="true" size={13} />
            scripts
          </li>
          {IDE_FILES.filter((file) => file.dir === "scripts").map((file) => (
            <li key={file.path} className="lnp-tree-indent">
              <ExplorerFile
                file={file}
                active={file.path === activePath}
                onOpen={() => setActivePath(file.path)}
              />
            </li>
          ))}
          <li className="lnp-tree-folder">
            <ChevronRight aria-hidden="true" size={12} />
            <Folder aria-hidden="true" size={13} />
            notebooks
          </li>
          <li className="lnp-tree-folder">
            <ChevronRight aria-hidden="true" size={12} />
            <Folder aria-hidden="true" size={13} />
            outputs
            <span className="lnp-tree-count">4</span>
          </li>
          <li className="lnp-tree-folder">
            <ChevronRight aria-hidden="true" size={12} />
            <Folder aria-hidden="true" size={13} />
            reports
          </li>
          {IDE_FILES.filter((file) => file.dir === "").map((file) => (
            <li key={file.path}>
              <ExplorerFile
                file={file}
                active={file.path === activePath}
                onOpen={() => setActivePath(file.path)}
              />
            </li>
          ))}
        </ul>

        <div className="lnp-side-section">
          <div className="lnp-side-title">
            <ChevronRight aria-hidden="true" size={11} /> Outline
          </div>
          <div className="lnp-outline">
            <span className="lnp-outline-fn">
              <span className="lnp-outline-glyph">ƒ</span> load_survey
            </span>
            <span className="lnp-outline-fn">
              <span className="lnp-outline-glyph">ƒ</span> clean
            </span>
            <span className="lnp-outline-fn">
              <span className="lnp-outline-glyph">ƒ</span> validate
            </span>
            <span className="lnp-outline-var">
              <span className="lnp-outline-glyph">v</span> KEEP
            </span>
          </div>
        </div>

        <div className="lnp-env-card">
          <span className="lnp-env-title">
            <Cpu aria-hidden="true" size={11} /> Python 3.12.4 ('.venv')
          </span>
          <span className="lnp-env-meta">pandas 2.2.3 · pyarrow 17.0.0</span>
          <span className="lnp-env-meta">scikit-learn 1.5.2 · duckdb 1.1.3</span>
        </div>
      </aside>

      <div className="lnp-editor">
        <div className="lnp-editor-head">
          <div className="lnp-editor-file">
            {activeFile.name}
            {activeFile.status ? (
              <span className="lnp-dirty-dot" aria-label="Unsaved changes" />
            ) : null}
          </div>
          <div className="lnp-editor-actions">
            <button
              type="button"
              className="lnp-btn lnp-btn--primary"
              onClick={runFile}
              disabled={running || !canRun}
              title={
                canRun
                  ? "Run this file in the project environment"
                  : isTable
                    ? "Binary file — query it with duckdb or open clean_data.py"
                    : "Open analysis.ipynb in the Notebook surface to run it"
              }
            >
              {running ? (
                <Loader2 aria-hidden="true" size={11} className="lnp-spin" />
              ) : (
                <Play aria-hidden="true" size={11} />
              )}
              {running ? "Running" : "Run file"}
            </button>
            <button
              type="button"
              className="lnp-icon-btn"
              aria-label="Split editor"
              title="Split editor"
            >
              <Square aria-hidden="true" size={11} />
            </button>
          </div>
        </div>

        <div className="lnp-breadcrumb">
          coastal-resilience <ChevronRight aria-hidden="true" size={9} />
          {activeFile.dir ? (
            <>
              {activeFile.dir} <ChevronRight aria-hidden="true" size={9} />
            </>
          ) : null}
          <span>{activeFile.name}</span>
          <span className="lnp-breadcrumb-right lnp-mono">
            {isTable ? "PARQUET PREVIEW" : "PYTHON 3.12.4"}
          </span>
        </div>

        <div className="lnp-editor-body">
          {isTable ? (
            <SurveyPreview />
          ) : (
            <CodeView code={activeFile.code} language={activeFile.language} />
          )}
        </div>

        <div className="lnp-console-panel">
          <div className="lnp-console-tabs" role="tablist" aria-label="Editor panels">
            {(["problems", "output", "terminal"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={panelTab === tab}
                className={`lnp-console-tab${panelTab === tab ? "is-active" : ""}`}
                onClick={() => setPanelTab(tab)}
              >
                {tab === "problems" ? "Problems 0" : tab === "output" ? "Output" : "Terminal"}
                {tab === "output" && running ? (
                  <span className="lnp-tab-dot lnp-tab-dot--run" />
                ) : null}
              </button>
            ))}
            <span className="lnp-console-tools">
              <X aria-hidden="true" size={11} />
            </span>
          </div>
          {panelTab === "output" ? (
            <pre className="lnp-console-body" aria-live="polite">
              {output.length === 0 ? "Running…" : output.join("\n")}
            </pre>
          ) : panelTab === "problems" ? (
            <div className="lnp-console-body lnp-console-empty">
              <Check aria-hidden="true" size={12} /> No problems have been detected in the
              workspace.
            </div>
          ) : (
            <pre className="lnp-console-body">
              <span className="lnp-term-prompt">{PROMPT}</span> git status --short{"\n"}
              <span className="lnp-git-mark lnp-git-mark--m">M</span> scripts/clean_data.py{"\n"}
              <span className="lnp-git-mark lnp-git-mark--m">M</span> notebooks/analysis.ipynb{"\n"}
              <span className="lnp-git-mark lnp-git-mark--a">A</span> outputs/clean.parquet
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Notebook                                                                   */
/* -------------------------------------------------------------------------- */

function NotebookPlot() {
  return (
    <figure className="lnp-nb-plot">
      <svg
        viewBox="0 0 560 210"
        role="img"
        aria-label="Monthly mean turbidity by station, twelve lines"
      >
        <rect width="560" height="210" fill="#ffffff" />
        {[40, 78, 116, 154, 192].map((y) => (
          <line key={y} x1="42" y1={y} x2="544" y2={y} stroke="#e6e6e6" strokeWidth="1" />
        ))}
        {[42, 142, 242, 342, 442, 542].map((x) => (
          <line key={x} x1={x} y1="18" x2={x} y2="192" stroke="#f1f1f1" strokeWidth="1" />
        ))}
        <line x1="42" y1="18" x2="42" y2="192" stroke="#9a9a9a" />
        <line x1="42" y1="192" x2="544" y2="192" stroke="#9a9a9a" />
        {[
          {
            d: "M42 150 C100 136 150 162 202 118 S300 92 352 108 S462 58 544 64",
            color: "#2f6f5e",
          },
          {
            d: "M42 162 C102 152 152 172 202 136 S300 112 352 128 S462 78 544 88",
            color: "#3f8f79",
          },
          { d: "M42 138 C100 128 150 148 202 106 S300 82 352 96 S462 44 544 52", color: "#54a88e" },
          {
            d: "M42 170 C102 162 152 176 202 148 S300 124 352 138 S462 96 544 104",
            color: "#7bbfa5",
          },
          { d: "M42 128 C100 120 150 138 202 96 S300 72 352 84 S462 32 544 42", color: "#1f5446" },
          {
            d: "M42 158 C102 148 152 166 202 126 S300 102 352 116 S462 66 544 76",
            color: "#6bb89d",
          },
          {
            d: "M42 180 C102 172 152 186 202 158 S300 138 352 150 S462 112 544 120",
            color: "#93cbb4",
          },
          {
            d: "M42 146 C100 140 150 156 202 112 S300 88 352 102 S462 52 544 60",
            color: "#468e77",
          },
        ].map((series) => (
          <path key={series.d} d={series.d} fill="none" stroke={series.color} strokeWidth="1.6" />
        ))}
        <line x1="292" y1="18" x2="292" y2="192" stroke="#d8b48a" strokeDasharray="3 3" />
        <text x="297" y="30" fill="#a07a4a" fontSize="8">
          storm window
        </text>
        <text x="8" y="110" fill="#555" fontSize="9" transform="rotate(-90 12 110)">
          turbidity (NTU)
        </text>
        {["May", "Jun", "Jul"].map((month, index) => (
          <text key={month} x={92 + index * 150} y="206" fill="#555" fontSize="9">
            {month} 2026
          </text>
        ))}
        <text x="470" y="30" fill="#777" fontSize="8">
          A-01 — B-04 …
        </text>
      </svg>
      <figcaption>Figure 1 · monthly mean turbidity by station · 12 series</figcaption>
    </figure>
  )
}

const INITIAL_CELL_RUNS: Record<string, number> = {
  load: 1,
  clean: 2,
  plot: 3,
  model: 4,
}

function MarkdownCell({ source }: { source: string }) {
  return (
    <div className="lnp-md">
      {source.split("\n").map((line, index) => {
        if (line.startsWith("## ")) {
          return <h3 key={index}>{line.slice(3)}</h3>
        }
        if (line.startsWith("# ")) {
          return <h4 key={index}>{line.slice(2)}</h4>
        }
        if (line.startsWith("- ")) {
          return (
            <p key={index} className="lnp-md-li">
              {line.slice(2)}
            </p>
          )
        }
        if (line.trim() === "") return <div key={index} className="lnp-md-gap" />
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

function NotebookCellView({
  cell,
  runCount,
  running,
  onRun,
}: {
  cell: NotebookCell
  runCount: number
  running: boolean
  onRun: () => void
}) {
  if (cell.kind === "markdown") {
    return (
      <div className="lnp-nb-cell lnp-nb-cell--md">
        <MarkdownCell source={cell.source} />
      </div>
    )
  }

  return (
    <div className="lnp-nb-cell">
      <div className="lnp-nb-gutter">
        <button
          type="button"
          className="lnp-nb-run"
          onClick={onRun}
          disabled={running}
          aria-label={`Run cell ${runCount || ""}`}
          title="Run cell"
        >
          {running ? (
            <Loader2 aria-hidden="true" size={11} className="lnp-spin" />
          ) : (
            <Play aria-hidden="true" size={11} />
          )}
        </button>
        <span className={`lnp-nb-in${running ? "is-busy" : ""}`}>
          In&nbsp;[{running ? "*" : runCount || " "}]
        </span>
      </div>
      <div className="lnp-nb-body">
        <CodeView code={cell.source} language="python" />
        <div className={`lnp-nb-output${running ? "is-running" : ""}`}>
          <span className="lnp-nb-out-label">Out[{running ? "*" : runCount || " "}]</span>
          {running ? (
            <p className="lnp-nb-running">
              <Loader2 aria-hidden="true" size={11} className="lnp-spin" /> executing cell…
            </p>
          ) : (
            cell.outputs.map((output, index) => {
              if (output.kind === "text") {
                return (
                  <pre
                    key={index}
                    className={`lnp-nb-text${output.tone && output.tone !== "default" ? ` is-${output.tone}` : ""}`}
                  >
                    {output.content}
                  </pre>
                )
              }
              if (output.kind === "plot") {
                return <NotebookPlot key={index} />
              }
              return (
                <div key={index} className="lnp-nb-table-wrap">
                  <table className="lnp-table lnp-table--nb">
                    <thead>
                      <tr>
                        {output.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {output.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((value, cellIndex) => (
                            <td key={cellIndex}>{value}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="lnp-table-caption">{output.caption}</p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function NotebookPanel() {
  const [runs, setRuns] = useState<Record<string, number>>(INITIAL_CELL_RUNS)
  const [runningCells, setRunningCells] = useState<Record<string, boolean>>({})
  const [runAllActive, setRunAllActive] = useState(false)
  const [kernelNote, setKernelNote] = useState("Kernel idle · Python 3.12.4 · 612 MB")
  const timers = useCleanupTimers()

  const codeCells = NOTEBOOK_CELLS.filter((cell) => cell.kind === "code")
  const busy = Object.keys(runningCells).length > 0

  const runCell = useCallback(
    (cell: NotebookCell) => {
      timers.current.push(
        window.setTimeout(() => {
          setRunningCells((previous) => ({ ...previous, [cell.id]: true }))
          setKernelNote("Kernel busy · executing cell · 74% CPU")
          timers.current.push(
            window.setTimeout(
              () => {
                setRunningCells((previous) => {
                  const next = { ...previous }
                  delete next[cell.id]
                  return next
                })
                setRuns((previous) => ({ ...previous, [cell.id]: (previous[cell.id] ?? 0) + 1 }))
                setKernelNote(
                  cell.id === "model"
                    ? "Kernel idle · last run 4.9s · 612 MB"
                    : `Kernel idle · cell finished in ${cell.runSeconds.toFixed(2)}s`,
                )
              },
              Math.max(420, Math.min(cell.runSeconds * 260, 1600)),
            ),
          )
        }, 180),
      )
    },
    [timers],
  )

  const runAll = useCallback(() => {
    if (runAllActive || busy) return
    setRunAllActive(true)
    codeCells.forEach((cell, index) => {
      timers.current.push(window.setTimeout(() => runCell(cell), index * 700))
    })
    timers.current.push(
      window.setTimeout(
        () => {
          setRunAllActive(false)
          setKernelNote("Kernel idle · 4 cells executed · 0 errors")
        },
        codeCells.length * 700 + 1800,
      ),
    )
  }, [busy, codeCells, runAllActive, runCell, timers])

  const restartKernel = useCallback(() => {
    setRunningCells({})
    setRuns({})
    setKernelNote("Restarting kernel…")
    timers.current.push(
      window.setTimeout(() => setKernelNote("Kernel idle · restarted fresh · 388 MB"), 900),
    )
  }, [timers])

  return (
    <div className="lnp-nb">
      <div className="lnp-nb-main">
        <div className="lnp-nb-toolbar">
          <div className="lnp-nb-toolbar-left">
            <span className="lnp-nb-file">
              <BookOpen aria-hidden="true" size={13} /> analysis.ipynb
            </span>
            <span className={`lnp-kernel-badge${busy || runAllActive ? "is-busy" : ""}`}>
              <span className="lnp-kernel-dot" />
              {busy || runAllActive ? "busy" : "idle"}
            </span>
          </div>
          <div className="lnp-nb-toolbar-right">
            <button
              type="button"
              className="lnp-btn lnp-btn--primary"
              onClick={runAll}
              disabled={runAllActive || busy}
            >
              {runAllActive ? (
                <Loader2 aria-hidden="true" size={11} className="lnp-spin" />
              ) : (
                <Play aria-hidden="true" size={11} />
              )}
              {runAllActive ? "Running all…" : "Run all"}
            </button>
            <button type="button" className="lnp-btn" onClick={restartKernel}>
              <RotateCcw aria-hidden="true" size={11} />
              Restart
            </button>
            <span className="lnp-nb-save">
              <Clock aria-hidden="true" size={10} /> autosaved 12s ago
            </span>
          </div>
        </div>

        <div className="lnp-nb-scroll">
          {NOTEBOOK_CELLS.map((cell) => (
            <NotebookCellView
              key={cell.id}
              cell={cell}
              runCount={runs[cell.id] ?? 0}
              running={Boolean(runningCells[cell.id])}
              onRun={() => runCell(cell)}
            />
          ))}
          <div className="lnp-nb-end">
            <span>
              <Check aria-hidden="true" size={10} /> {Object.keys(runs).length} of{" "}
              {codeCells.length} cells executed · 0 errors
            </span>
            <span className="lnp-mono">{kernelNote}</span>
          </div>
        </div>
      </div>

      <aside className="lnp-nb-side" aria-label="Notebook inspector">
        <div className="lnp-side-title">
          <ChevronDown aria-hidden="true" size={11} /> Variables
        </div>
        <ul className="lnp-var-list">
          {NOTEBOOK_VARIABLES.map((variable) => (
            <li key={variable.name}>
              <span className="lnp-var-name">{variable.name}</span>
              <span className="lnp-var-type">{variable.type}</span>
              <span className="lnp-var-value">{variable.value}</span>
            </li>
          ))}
        </ul>

        <div className="lnp-side-title">
          <ChevronDown aria-hidden="true" size={11} /> Kernel
        </div>
        <dl className="lnp-kernel-stats">
          <div>
            <dt>Runtime</dt>
            <dd>Python 3.12.4</dd>
          </div>
          <div>
            <dt>ipykernel</dt>
            <dd>6.29.5</dd>
          </div>
          <div>
            <dt>Uptime</dt>
            <dd>01:47:22</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>612 MB / 4 GB</dd>
          </div>
        </dl>

        <div className="lnp-kernel-bar">
          <span style={{ width: "62%" }} />
        </div>
        <p className="lnp-side-note">Kernel mounted on sec-01 · no files leave the workspace.</p>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* RStudio                                                                    */
/* -------------------------------------------------------------------------- */

type RSidebarTab = "environment" | "files" | "plots" | "packages" | "help"

const R_SIDEBAR_TABS: { id: RSidebarTab; label: string }[] = [
  { id: "environment", label: "Environment" },
  { id: "files", label: "Files" },
  { id: "plots", label: "Plots" },
  { id: "packages", label: "Packages" },
  { id: "help", label: "Help" },
]

type REntry = { command: string; output: string[] }

function rResponse(command: string): { lines: string[]; plot?: boolean; clear?: boolean } {
  const cmd = command.trim()
  if (!cmd) return { lines: [] }
  if (cmd === "clear" || cmd === 'cat("\\014")') return { lines: [], clear: true }
  if (cmd === "help()" || cmd === "?help") {
    return {
      lines: [
        "These are the simulated commands this session understands:",
        "  nrow(survey)            mean(survey$salinity)",
        "  names(survey)           summary(survey)",
        "  head(survey)            ls()",
        "  library(tidyverse)      ggplot(survey, aes(...))",
        '  filter(survey, site == "B-04")',
        "  clear                   q()",
      ],
    }
  }
  if (cmd === "q()" || cmd === "quit()") {
    return { lines: ["Session terminated. The R kernel is still warm on sec-01."] }
  }
  if (cmd.startsWith("library(") || cmd.startsWith("require(")) {
    const pkg = cmd.replace(/^[a-z]+\(["']?/, "").replace(/["']?\).*$/, "")
    return {
      lines:
        pkg === "tidyverse"
          ? [
              "── Attaching core tidyverse packages ── tidyverse 2.0.0 ──",
              "✔ dplyr 1.1.4  ✔ ggplot2 3.5.1  ✔ readr 2.1.5",
            ]
          : [`Loading required package: ${pkg || "package"}`, `✔ ${pkg || "package"} attached`],
    }
  }
  if (cmd.startsWith("install.packages")) {
    return {
      lines: [
        "Installing package into ‘/spindle/pkgs’ (as ‘lib’ is unspecified)",
        "✓ package already cached, 0.00s",
      ],
    }
  }
  if (cmd.startsWith("nrow(")) {
    return { lines: ["[1] 48102"] }
  }
  if (cmd.startsWith("ncol(")) return { lines: ["[1] 14"] }
  if (cmd.startsWith("names(") || cmd.startsWith("colnames(")) {
    return {
      lines: [
        ' [1] "sample_id"  "site"       "sampled_at" "salinity"   "turbidity" ',
        ' [6] "tide_range" "rainfall_7d" "water_temp" "do_mg_l"   "sensor_id" ',
        '[11] "lab_batch"  "analyst"    "qc_flag"    "notes"',
      ],
    }
  }
  if (cmd === "ls()" || cmd.startsWith("ls(")) {
    return { lines: ['[1] "by_site" "fit" "sal_mean" "sites" "survey" "tidal"'] }
  }
  if (cmd.startsWith("mean(")) {
    return { lines: ["[1] 28.6"] }
  }
  if (cmd.startsWith("sd(")) {
    return { lines: ["[1] 3.14"] }
  }
  if (cmd.startsWith("summary(")) {
    return {
      lines: [
        "   sample_id             site          sampled_at                   ",
        " Length:48102       A-01   : 4077   Min.   :2026-05-03 06:20:00   ",
        " Class :character   A-02   : 3990   1st Qu.:2026-06-02 11:40:00   ",
        " Mode  :character   B-04   : 4021   Median :2026-06-24 04:00:00   ",
        "                    C-02   : 4102   Mean   :2026-06-24 03:51:11   ",
        "                    (Other):40012   Max.   :2026-07-28 23:40:00   ",
        "   salinity         turbidity         tide_range      rainfall_7d    ",
        " Min.   : 8.10    Min.   : 1.20    Min.   :0.210    Min.   : 0.000  ",
        " 1st Qu.:25.20    1st Qu.:10.10    1st Qu.:1.280    1st Qu.: 1.400  ",
        " Median :28.60    Median :14.60    Median :1.810    Median : 4.100  ",
        " Mean   :28.54    Mean   :15.71    Mean   :1.804    Mean   : 6.332  ",
        " 3rd Qu.:31.60    3rd Qu.:20.20    3rd Qu.:2.310    3rd Qu.:10.400  ",
        " Max.   :41.90    Max.   :48.70    Max.   :3.420    Max.   :31.200  ",
        "                                   NA's   :37                        ",
      ],
    }
  }
  if (cmd.startsWith("head(")) {
    return {
      lines: [
        "# A tibble: 6 × 14",
        "  sample_id site  sampled_at          salinity turbidity tide_range rainfall_7d",
        "  <chr>     <fct> <dttm>                 <dbl>     <dbl>      <dbl>       <dbl>",
        "1 8f2a1c    A-01  2026-05-03 06:20:00     27.4      12.8       1.92         4.1",
        "2 8f2a1d    A-01  2026-05-03 06:40:00     27.6      13.1       1.86         4.1",
        "3 8f2a1e    B-04  2026-05-03 07:00:00     31.2      18.4       2.14         3.8",
        "4 8f2a1f    B-04  2026-05-03 07:20:00     31.1      18.1       2.20         3.8",
        "5 8f2a20    C-02  2026-05-03 08:00:00     29.4      16.7       2.02         3.6",
        "6 8f2a21    C-02  2026-05-03 08:20:00     29.6      17.0       1.98         3.6",
        "# ℹ 48,096 more rows",
      ],
    }
  }
  if (cmd.includes("ggplot") || cmd.includes("geom_point") || cmd.includes("geom_sf")) {
    return {
      lines: [
        "`geom_sf()` using `sites$geometry`",
        "`geom_point()` using longitude and latitude",
        "Saving 7 × 5 in image",
        "✔ Plot rendered in 0.42s → Plots pane",
      ],
      plot: true,
    }
  }
  if (cmd.startsWith("filter(") || cmd.includes("|> filter(")) {
    return {
      lines: [
        "# A tibble: 4,021 × 14",
        "  sample_id site  sampled_at          salinity turbidity tide_range",
        "  <chr>     <fct> <dttm>                 <dbl>     <dbl>      <dbl>",
        "1 8f2a1e    B-04  2026-05-03 07:00:00     31.2      18.4       2.14",
        "2 8f2a1f    B-04  2026-05-03 07:20:00     31.1      18.1       2.20",
        "3 8f2a30    B-04  2026-05-03 09:40:00     31.4      19.2       2.08",
        "# ℹ 4,018 more rows",
      ],
    }
  }
  if (cmd.startsWith("arrange(") || cmd.includes("|> arrange(")) {
    return {
      lines: [
        "# A tibble: 12 × 2",
        "   site  salinity",
        "   <fct>    <dbl>",
        " 1 B-04      31.2",
        " 2 B-07      30.8",
        " 3 C-02      29.7",
        " 4 A-01      28.4",
        " 5 A-02      27.9",
        "# ℹ 7 more rows",
      ],
    }
  }
  if (cmd.includes("<-")) {
    return { lines: [] }
  }
  if (cmd.startsWith("print(")) {
    return { lines: ["[1] 28.6"] }
  }
  if (cmd.startsWith("sessionInfo")) {
    return {
      lines: [
        "R version 4.4.2 (2026-10-31)",
        "Platform: x86_64-pc-linux-gnu (64-bit)",
        "Running under: Ubuntu 24.04.1 LTS",
        "",
        "Matrix products: default · BLAS: /usr/lib/x86_64-linux-gnu/openblas",
        "locale: en_US.UTF-8",
        "attached base packages: stats, graphics, grDevices, utils, datasets, methods, base",
        "other attached packages: tidyverse_2.0.0, arrow_17.0.0, sf_1.0-17",
      ],
    }
  }
  return {
    lines: [`Error: object '${cmd.split(/[(:, ]/)[0]}' not found`],
  }
}

function RGplot({ revision }: { revision: number }) {
  return (
    <figure className="lnp-r-plot">
      <div className="lnp-r-plot-frame">
        <svg
          viewBox="0 0 420 300"
          role="img"
          aria-label="Salinity by station plotted over a coastline map"
        >
          <rect width="420" height="300" fill="#ffffff" />
          <path
            d="M24 250 C76 236 122 248 158 210 S220 168 270 178 S338 132 396 142 L396 276 L24 276 Z"
            fill="#d8e6dc"
            stroke="#8aa595"
            strokeWidth="1"
          />
          <path
            d="M300 300 C312 250 352 226 420 218"
            fill="#cfe2d6"
            stroke="#8aa595"
            strokeWidth="1"
          />
          {[60, 100, 140, 180, 220].map((y) => (
            <line key={y} x1="34" y1={y} x2="396" y2={y} stroke="#ececec" />
          ))}
          {[80, 152, 224, 296, 368].map((x) => (
            <line key={x} x1={x} y1="26" x2={x} y2="276" stroke="#f3f3f3" />
          ))}
          {[
            { x: 72, y: 206, r: 9, color: "#2b6f77", label: "A-01" },
            { x: 106, y: 218, r: 8, color: "#337f85", label: "A-02" },
            { x: 148, y: 190, r: 10, color: "#255f68", label: "B-04" },
            { x: 176, y: 176, r: 8, color: "#3b8b8e", label: "B-07" },
            { x: 214, y: 194, r: 9, color: "#2f747c", label: "C-02" },
            { x: 246, y: 160, r: 7, color: "#4b9b98", label: "C-05" },
            { x: 271, y: 168, r: 8, color: "#408b90", label: "D-01" },
            { x: 292, y: 186, r: 7, color: "#59a5a2", label: "D-02" },
            { x: 118, y: 236, r: 7, color: "#64aaa5", label: "A-05" },
            { x: 168, y: 214, r: 7, color: "#78b4ad", label: "B-02" },
          ].map((point) => (
            <g key={point.label}>
              <circle cx={point.x} cy={point.y} r={point.r} fill={point.color} fillOpacity="0.85" />
              <text x={point.x + point.r + 3} y={point.y + 3} fill="#5d6b63" fontSize="7">
                {point.label}
              </text>
            </g>
          ))}
          <text x="34" y="20" fill="#333" fontSize="10" fontWeight="600">
            Surface salinity by station
          </text>
          <text x="34" y="33" fill="#777" fontSize="7.5">
            Coastal resilience survey · May–Jul 2026
          </text>
          <text x="182" y="292" fill="#777" fontSize="7.5">
            longitude
          </text>
          <text x="6" y="160" fill="#777" fontSize="7.5" transform="rotate(-90 10 160)">
            latitude
          </text>
          <g transform="translate(320 56)">
            <text x="0" y="-6" fill="#777" fontSize="7">
              psu
            </text>
            {[0, 1, 2, 3].map((index) => (
              <rect
                key={index}
                x={index * 14}
                y="0"
                width="14"
                height="6"
                fill={["#78b4ad", "#4b9b98", "#2f747c", "#1d4f59"][index]}
              />
            ))}
            <text x="0" y="18" fill="#999" fontSize="6.5">
              24
            </text>
            <text x="42" y="18" fill="#999" fontSize="6.5">
              32
            </text>
          </g>
        </svg>
        {revision > 0 ? <span className="lnp-r-plot-rev">re-rendered ×{revision}</span> : null}
      </div>
      <figcaption>
        <span>Rendered 1240 × 760 · 0.42s</span>
        <span className="lnp-mono">ggplot2 3.5.1</span>
      </figcaption>
    </figure>
  )
}

function RStudioPanel() {
  const [entries, setEntries] = useState<REntry[]>(R_HISTORY)
  const [input, setInput] = useState("")
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tab, setTab] = useState<RSidebarTab>("environment")
  const [plotRevision, setPlotRevision] = useState(0)
  const [showBanner, setShowBanner] = useState(true)
  const consoleEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ block: "nearest" })
  }, [entries])

  const submit = () => {
    const command = input.trim()
    if (!command) return
    const response = rResponse(command)
    if (response.clear) {
      setEntries([])
      setShowBanner(false)
    } else {
      setEntries((previous) => [...previous, { command, output: response.lines }])
      if (response.plot) {
        setPlotRevision((previous) => previous + 1)
        setTab("plots")
      }
    }
    setInput("")
    setHistoryIndex(-1)
  }

  const sourceScript = () => {
    setEntries((previous) => [
      ...previous,
      {
        command: 'source("salinity.R")',
        output: [
          "── Attaching packages ── tidyverse 2.0.0 · arrow 17.0.0 · sf 1.0-17",
          "Reading data/survey.parquet ... 48,102 rows",
          "Joining 12 station polygons ... ok",
          "`geom_sf()` using `sites$geometry`",
          "`geom_point()` using longitude and latitude",
          "✔ Rendered plot in 0.42s → Plots pane",
        ],
      },
    ])
    setPlotRevision((previous) => previous + 1)
    setTab("plots")
  }

  const recall = (direction: -1 | 1) => {
    const commands = entries.map((entry) => entry.command)
    if (commands.length === 0) return
    const next =
      direction === -1
        ? historyIndex === -1
          ? commands.length - 1
          : Math.max(0, historyIndex - 1)
        : Math.min(commands.length - 1, historyIndex + 1)
    setHistoryIndex(next)
    setInput(commands[next] ?? "")
  }

  return (
    <div className="lnp-r">
      <div className="lnp-r-left">
        <div className="lnp-r-source">
          <div className="lnp-r-source-head">
            <span className="lnp-r-source-tab">
              <FileCode2 aria-hidden="true" size={12} /> salinity.R
              <span className="lnp-dirty-dot" />
            </span>
            <div className="lnp-r-source-actions">
              <button type="button" className="lnp-btn lnp-btn--r" onClick={sourceScript}>
                <Play aria-hidden="true" size={10} /> Source
              </button>
              <span className="lnp-mono">UTF-8 · Ln 12</span>
            </div>
          </div>
          <div className="lnp-r-editor">
            <CodeView code={R_SOURCE} language="r" />
          </div>
        </div>

        <div className="lnp-r-console-panel">
          <div className="lnp-r-console-head">
            <span>Console</span>
            <span className="lnp-mono">R 4.4.2 · session active</span>
          </div>
          <div className="lnp-r-console" aria-live="polite">
            {showBanner ? (
              <>
                {R_SESSION_BANNER.map((line) => (
                  <p key={line} className="lnp-r-banner">
                    {line}
                  </p>
                ))}
                {entries.map((entry, index) => (
                  <div key={`${entry.command}-${index}`}>
                    <p className="lnp-r-command">
                      <span className="lnp-r-prompt">&gt;</span> {entry.command}
                    </p>
                    {entry.output.map((line, lineIndex) => (
                      <p key={lineIndex} className="lnp-r-output">
                        {line || "\u00a0"}
                      </p>
                    ))}
                  </div>
                ))}
              </>
            ) : null}
            <div className="lnp-r-input-row">
              <span className="lnp-r-prompt">&gt;</span>
              <input
                className="lnp-r-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    submit()
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    recall(-1)
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault()
                    recall(1)
                  }
                }}
                aria-label="R console input"
                placeholder=""
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div ref={consoleEnd} />
          </div>
          <div className="lnp-r-console-foot">
            <span>Working directory: ~/projects/coastal-resilience</span>
            <span className="lnp-mono">renv 1.0.11 · synced</span>
          </div>
        </div>
      </div>

      <aside className="lnp-r-side">
        <div className="lnp-r-tabs" role="tablist" aria-label="RStudio panes">
          {R_SIDEBAR_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`lnp-r-tab${tab === entry.id ? "is-active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="lnp-r-side-body">
          {tab === "environment" ? (
            <>
              <div className="lnp-r-side-head">
                <span>Environment</span>
                <span className="lnp-mono">Global</span>
              </div>
              <ul className="lnp-r-env">
                {R_ENVIRONMENT.map((item) => (
                  <li key={item.name}>
                    <span className="lnp-var-name">{item.name}</span>
                    <span className="lnp-r-type">{item.type}</span>
                    <span className="lnp-r-detail">{item.detail}</span>
                  </li>
                ))}
              </ul>
              <div className="lnp-r-files">
                <div className="lnp-r-side-head">
                  <span>Files</span>
                  <span className="lnp-mono">~/coastal-resilience</span>
                </div>
                <ul>
                  <li>
                    <Folder aria-hidden="true" size={11} /> data
                  </li>
                  <li>
                    <Folder aria-hidden="true" size={11} /> outputs
                  </li>
                  <li>
                    <FileText aria-hidden="true" size={11} /> README.md
                  </li>
                  <li>
                    <FileCode2 aria-hidden="true" size={11} /> salinity.R
                  </li>
                </ul>
              </div>
            </>
          ) : null}

          {tab === "files" ? (
            <ul className="lnp-r-browser">
              <li className="is-up">..</li>
              <li>
                <Folder aria-hidden="true" size={11} /> data <span>2.1 GB</span>
              </li>
              <li>
                <Folder aria-hidden="true" size={11} /> outputs <span>184 MB</span>
              </li>
              <li>
                <Folder aria-hidden="true" size={11} /> scripts <span>12 KB</span>
              </li>
              <li>
                <FileText aria-hidden="true" size={11} /> README.md <span>2.4 KB</span>
              </li>
              <li>
                <FileCode2 aria-hidden="true" size={11} /> salinity.R <span>1.8 KB</span>
              </li>
            </ul>
          ) : null}

          {tab === "plots" ? <RGplot revision={plotRevision} /> : null}

          {tab === "packages" ? (
            <ul className="lnp-r-packages">
              {R_PACKAGES.map((item) => (
                <li key={item.name}>
                  <Check aria-hidden="true" size={10} />
                  <span className="lnp-var-name">{item.name}</span>
                  <span className="lnp-mono">{item.version}</span>
                  <span className="lnp-r-detail">{item.source}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {tab === "help" ? (
            <div className="lnp-r-help">
              <h3>mean</h3>
              <p>Arithmetic Mean</p>
              <pre>{`mean(x, trim = 0, na.rm = FALSE, ...)`}</pre>
              <p>
                Generic function for the arithmetic mean of a numeric vector. In this project,
                missing turbidity readings are handled with <code>na.rm = TRUE</code>.
              </p>
              <p className="lnp-mono">Help fetched from R 4.4.2 · local docs</p>
            </div>
          ) : null}
        </div>

        <div className="lnp-r-side-foot">
          <span>
            <Database aria-hidden="true" size={10} /> 12 packages attached
          </span>
          <span className="lnp-mono">4.4.2</span>
        </div>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* SSH terminal                                                               */
/* -------------------------------------------------------------------------- */

type TermLineKind = "out" | "ok" | "err" | "dim" | "cmd"

type TermLine = { kind: TermLineKind; text: string }

const INITIAL_TERMINAL: TermLine[] = [
  { kind: "dim", text: "Spindle Lab · secure remote session · sec-01.fra.spindle.dev" },
  { kind: "out", text: "Last login: Sat Nov 21 09:14:02 2026 from 10.24.0.17" },
  { kind: "out", text: "Mounted project: ~/projects/coastal-resilience (5.0 GB free)" },
  { kind: "out", text: "Python 3.12.4 · R 4.4.2 · duckdb 1.1.3 · git 2.47.1" },
  { kind: "cmd", text: "git status" },
  { kind: "out", text: "On branch main" },
  { kind: "out", text: "Your branch is up to date with 'origin/main'." },
  { kind: "out", text: "" },
  { kind: "out", text: "Changes not staged for commit:" },
  { kind: "dim", text: '  (use "git add <file>..." to update what will be committed)' },
  { kind: "dim", text: "        modified:   notebooks/analysis.ipynb" },
  { kind: "dim", text: "        modified:   scripts/clean_data.py" },
  { kind: "out", text: "" },
  { kind: "out", text: "Untracked files:" },
  { kind: "dim", text: "        outputs/clean.parquet" },
  { kind: "dim", text: "        outputs/trends-2026.png" },
  { kind: "out", text: "" },
  { kind: "ok", text: 'no changes added to commit (use "git add" and/or "git commit -a")' },
]

const TERMINAL_HINTS = [
  "ls",
  "head data/survey.csv",
  "cat README.md",
  "git log --oneline -5",
  "python scripts/clean_data.py",
  "duckdb",
  "ssh-keygen -lf ~/.ssh/id_ed25519.pub",
]

function runTerminalCommand(raw: string): TermLine[] {
  const command = raw.trim()
  if (!command) return []

  if (command === "clear") return []
  if (command === "help" || command === "--help") {
    return [
      { kind: "dim", text: "Simulated shell — local commands only. Try:" },
      { kind: "out", text: "  ls · pwd · whoami · hostname · uptime · df -h · free -h" },
      { kind: "out", text: "  head data/survey.csv · cat README.md · pip list" },
      { kind: "out", text: "  git status · git log --oneline -5" },
      { kind: "out", text: "  python scripts/clean_data.py · python scripts/fit_model.py" },
      { kind: "out", text: "  Rscript scripts/tides_sync.R · duckdb" },
      { kind: "out", text: "  ssh-keygen -lf ~/.ssh/id_ed25519.pub · ssh -T git@github.com" },
      { kind: "dim", text: "  clear · exit" },
    ]
  }

  if (command === "ls" || command === "ll" || command === "ls -la" || command === "ls -l") {
    return [
      { kind: "ok", text: "total 48" },
      { kind: "out", text: "drwxr-xr-x  6 mara research  4096 Nov 21 09:14 ." },
      { kind: "out", text: "drwxr-xr-x  3 mara research  4096 Nov 19 16:02 .." },
      { kind: "out", text: "drwxr-xr-x  3 mara research  4096 Nov 20 11:38 .git" },
      { kind: "out", text: "drwxr-xr-x  2 mara research  4096 Nov 21 08:51 data" },
      { kind: "out", text: "drwxr-xr-x  2 mara research  4096 Nov 21 09:02 outputs" },
      { kind: "out", text: "drwxr-xr-x  2 mara research  4096 Nov 20 18:24 scripts" },
      { kind: "out", text: "drwxr-xr-x  2 mara research  4096 Nov 20 18:24 notebooks" },
      { kind: "out", text: "drwxr-xr-x  2 mara research  4096 Nov 19 16:04 reports" },
      { kind: "out", text: "-rw-r--r--  1 mara research  2481 Nov 20 18:24 README.md" },
      { kind: "out", text: "-rw-r--r--  1 mara research   402 Nov 19 16:04 environment.yml" },
    ]
  }
  if (command === "pwd") {
    return [{ kind: "out", text: "/home/mara/projects/coastal-resilience" }]
  }
  if (command === "whoami") return [{ kind: "out", text: "mara" }]
  if (command === "hostname") return [{ kind: "out", text: "sec-01" }]
  if (command === "uptime") {
    return [
      {
        kind: "out",
        text: " 09:41:17 up 18 days,  3:22,  1 user,  load average: 0.42, 0.37, 0.31",
      },
    ]
  }
  if (command.startsWith("df")) {
    return [
      { kind: "out", text: "Filesystem      Size  Used Avail Use% Mounted on" },
      { kind: "out", text: "overlay         100G   21G   79G  22% /" },
      { kind: "out", text: "spindle-proj    5.0G  184M  4.8G   4% /home/mara/projects" },
      { kind: "out", text: "tmpfs            16G     0   16G   0% /dev/shm" },
    ]
  }
  if (command.startsWith("free")) {
    return [
      {
        kind: "out",
        text: "               total        used        free      shared  buff/cache   available",
      },
      {
        kind: "out",
        text: "Mem:            16Gi       3.8Gi       9.2Gi       128Mi       3.0Gi        11Gi",
      },
      { kind: "out", text: "Swap:             0B          0B          0B" },
    ]
  }
  if (command === "pip list" || command === "pip3 list") {
    return [
      { kind: "out", text: "Package         Version" },
      { kind: "out", text: "--------------- ---------" },
      { kind: "out", text: "duckdb          1.1.3" },
      { kind: "out", text: "jupyterlab      4.2.5" },
      { kind: "out", text: "matplotlib      3.9.2" },
      { kind: "out", text: "numpy           2.1.1" },
      { kind: "out", text: "pandas          2.2.3" },
      { kind: "out", text: "pyarrow         17.0.0" },
      { kind: "out", text: "scikit-learn    1.5.2" },
    ]
  }
  if (command === "git status" || command === "git status -s") {
    return [
      { kind: "out", text: "On branch main" },
      { kind: "out", text: "Your branch is up to date with 'origin/main'." },
      { kind: "out", text: "" },
      { kind: "out", text: "Changes not staged for commit:" },
      { kind: "dim", text: "        modified:   notebooks/analysis.ipynb" },
      { kind: "dim", text: "        modified:   scripts/clean_data.py" },
      { kind: "out", text: "" },
      { kind: "out", text: "Untracked files:" },
      { kind: "dim", text: "        outputs/clean.parquet" },
      { kind: "dim", text: "        outputs/trends-2026.png" },
      { kind: "out", text: "" },
      { kind: "ok", text: "no changes added to commit" },
    ]
  }
  if (command.startsWith("git log")) {
    return [
      { kind: "ok", text: "3f2a91c  feather the empty-tide turbidity window (2h)" },
      { kind: "ok", text: "b8d04e1  add grouped validation split to fit_model.py" },
      { kind: "ok", text: "a71c6f9  notebook: rerun figures with clean.parquet" },
      { kind: "ok", text: "e42b8d3  clean_data: clip salinity to [0, 42]" },
      { kind: "ok", text: "d90c1a7  mount 2026 survey · initial import" },
    ]
  }
  if (command === "cat README.md") {
    const readme = IDE_FILES.find((file) => file.path === "README.md")
    return (readme?.code ?? "")
      .split("\n")
      .slice(0, 18)
      .map((line) => ({
        kind: line.startsWith("#") ? "ok" : "out",
        text: line,
      }))
  }
  if (command.startsWith("cat ") || command.startsWith("head ")) {
    return [
      { kind: "out", text: "sample_id,site,sampled_at,salinity,turbidity,tide_range,rainfall_7d" },
      { kind: "out", text: "8f2a1c,A-01,2026-05-03T06:20:00Z,27.4,12.8,1.92,4.1" },
      { kind: "out", text: "8f2a1d,A-01,2026-05-03T06:40:00Z,27.6,13.1,1.86,4.1" },
      { kind: "out", text: "8f2a1e,B-04,2026-05-03T07:00:00Z,31.2,18.4,2.14,3.8" },
      { kind: "out", text: "8f2a1f,B-04,2026-05-03T07:20:00Z,31.1,18.1,2.20,3.8" },
      { kind: "dim", text: "… 48,098 more rows (use duckdb for a full scan)" },
    ]
  }
  if (
    command === "python scripts/clean_data.py" ||
    command === "python scripts/clean_data.py --input data/survey.parquet"
  ) {
    return [
      { kind: "dim", text: "$ python scripts/clean_data.py" },
      { kind: "out", text: "loaded 48,102 rows x 14 columns" },
      { kind: "out", text: "dropped 212 duplicate samples" },
      { kind: "out", text: "kept 47,890 rows · 12 sites" },
      { kind: "ok", text: "validation passed" },
      { kind: "ok", text: "wrote /home/mara/projects/coastal-resilience/outputs/clean.parquet" },
      { kind: "dim", text: "real 1.84s · user 1.31s · sys 0.19s" },
    ]
  }
  if (command === "python scripts/fit_model.py") {
    return [
      { kind: "dim", text: "$ python scripts/fit_model.py" },
      { kind: "out", text: "train R2  0.931" },
      { kind: "out", text: "val R2    0.874" },
      { kind: "out", text: "val MAE   2.61 NTU" },
      { kind: "ok", text: "model artifact: outputs/rf-turbidity.joblib (48.2 MB)" },
    ]
  }
  if (command === "Rscript scripts/tides_sync.R") {
    return [
      { kind: "dim", text: "$ Rscript scripts/tides_sync.R" },
      { kind: "out", text: "Reading data/survey.parquet ... 48,102 rows" },
      { kind: "out", text: "Joining 12 station polygons ... ok" },
      { kind: "ok", text: "sessionInfo() written to outputs/r-session.txt" },
      { kind: "dim", text: "elapsed 2.31s" },
    ]
  }
  if (command === "duckdb" || command.startsWith("duckdb ")) {
    return [
      { kind: "out", text: "┌─────────┬──────────┬───────────┬───────────┐" },
      { kind: "out", text: "│ site    │ samples  │ salinity  │ turbidity │" },
      { kind: "out", text: "│ varchar │  int64   │  double   │  double   │" },
      { kind: "out", text: "├─────────┼──────────┼───────────┼───────────┤" },
      { kind: "out", text: "│ B-04    │     4021 │     31.24 │     21.38 │" },
      { kind: "out", text: "│ B-07    │     3988 │     30.81 │     19.92 │" },
      { kind: "out", text: "│ C-02    │     4102 │     29.74 │     17.21 │" },
      { kind: "out", text: "│ A-01    │     4077 │     28.42 │     14.63 │" },
      { kind: "out", text: "│ A-02    │     3990 │     27.91 │     13.87 │" },
      { kind: "out", text: "└─────────┴──────────┴───────────┴───────────┘" },
      { kind: "dim", text: "12 rows · 84 ms · read_parquet('outputs/clean.parquet')" },
    ]
  }
  if (command.startsWith("ssh-keygen")) {
    return [
      {
        kind: "ok",
        text: "256 SHA256:q9m2wL7dA4vR1xHc0pNj8sKfT6yQe3f7Kp mara@field-laptop (ED25519)",
      },
    ]
  }
  if (command.startsWith("ssh -T")) {
    return [
      {
        kind: "out",
        text: "Hi mara-okafor! You've successfully authenticated, but GitHub does not provide shell access.",
      },
      { kind: "dim", text: "Connection to github.com closed. Host key pinned (ED25519)." },
    ]
  }
  if (command === "exit" || command === "logout") {
    return [
      { kind: "dim", text: "logout" },
      { kind: "out", text: "Connection to sec-01 closed. Session keys destroyed." },
      { kind: "ok", text: "Reconnect from the connection badge — your files are untouched." },
    ]
  }

  const base = command.split(/\s+/)[0]
  return [
    {
      kind: "err",
      text: `bash: ${base}: command not found`,
    },
    { kind: "dim", text: "Type 'help' to see the commands this simulated shell understands." },
  ]
}

function TerminalPanel({ onOpenConnection }: { onOpenConnection: () => void }) {
  const [lines, setLines] = useState<TermLine[]>(INITIAL_TERMINAL)
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" })
  }, [lines])

  const submit = () => {
    const command = input.trim()
    if (!command) return
    setHistory((previous) => [...previous, command])
    setHistoryIndex(-1)
    setInput("")

    if (command === "clear") {
      setLines([])
      return
    }

    const result = runTerminalCommand(command)
    setLines((previous) => [...previous, { kind: "cmd", text: command }, ...result])
  }

  const recall = (direction: -1 | 1) => {
    if (history.length === 0) return
    const next =
      direction === -1
        ? historyIndex === -1
          ? history.length - 1
          : Math.max(0, historyIndex - 1)
        : Math.min(history.length - 1, historyIndex + 1)
    setHistoryIndex(next)
    setInput(history[next] ?? "")
  }

  const useHint = (hint: string) => {
    setInput(hint)
    inputRef.current?.focus()
  }

  return (
    <div className="lnp-term">
      <div className="lnp-term-head">
        <div className="lnp-term-tabs">
          <span className="lnp-term-tab is-active">
            <Terminal aria-hidden="true" size={12} /> mara@sec-01
          </span>
          <span className="lnp-term-tab">local</span>
          <span className="lnp-term-tab lnp-term-tab--add">
            <Plus aria-hidden="true" size={11} />
          </span>
        </div>
        <div className="lnp-term-head-right">
          <span className="lnp-term-lock">
            <Lock aria-hidden="true" size={10} /> encrypted
          </span>
          <button type="button" className="lnp-btn lnp-btn--sm" onClick={onOpenConnection}>
            <ShieldCheck aria-hidden="true" size={11} />
            Connection
          </button>
        </div>
      </div>

      <div
        className="lnp-term-body"
        role="log"
        aria-live="polite"
        aria-label="SSH terminal output"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((line, index) => (
          <div key={index} className={`lnp-term-line lnp-term-line--${line.kind}`}>
            {line.kind === "cmd" ? (
              <>
                <span className="lnp-term-prompt">{PROMPT}</span> {line.text}
              </>
            ) : (
              line.text || "\u00a0"
            )}
          </div>
        ))}
        <div className="lnp-term-input-row">
          <span className="lnp-term-prompt">{PROMPT}</span>
          <input
            ref={inputRef}
            className="lnp-term-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                recall(-1)
              } else if (event.key === "ArrowDown") {
                event.preventDefault()
                recall(1)
              }
            }}
            aria-label="Terminal command"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="lnp-term-cursor" aria-hidden="true" />
          <div ref={endRef} />
        </div>
      </div>

      <div className="lnp-term-hints">
        <span className="lnp-term-hints-label">Try</span>
        {TERMINAL_HINTS.map((hint) => (
          <button key={hint} type="button" className="lnp-term-chip" onClick={() => useHint(hint)}>
            {hint}
          </button>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function LabNotebookPreview() {
  const [tool, setTool] = useState<ToolId>("ide")
  const [showConnection, setShowConnection] = useState(false)
  const [verified, setVerified] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [latency, setLatency] = useState(24)
  const [sessionSeconds, setSessionSeconds] = useState(27 * 60 + 3)
  const timers = useCleanupTimers()

  useEffect(() => {
    const sessionTimer = window.setInterval(() => setSessionSeconds((value) => value + 1), 1000)
    const latencyTimer = window.setInterval(
      () => setLatency(19 + Math.floor(Math.random() * 14)),
      4200,
    )
    return () => {
      window.clearInterval(sessionTimer)
      window.clearInterval(latencyTimer)
    }
  }, [])

  useEffect(() => {
    if (!showConnection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowConnection(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [showConnection])

  const verify = () => {
    setVerifying(true)
    timers.current.push(
      window.setTimeout(() => {
        setVerified(true)
        setVerifying(false)
      }, 1100),
    )
  }

  const statusContent =
    tool === "ide" ? (
      <>
        <span>
          <GitBranch aria-hidden="true" size={10} /> main*
        </span>
        <span>0 errors · 0 warnings</span>
        <span className="lnp-status-right">
          <span>Ln 6, Col 1</span>
          <span>Spaces: 4</span>
          <span>UTF-8</span>
          <span>Python 3.12.4</span>
        </span>
      </>
    ) : tool === "notebook" ? (
      <>
        <span>
          <Activity aria-hidden="true" size={10} /> Python 3.12.4 (ipykernel)
        </span>
        <span>48,102 rows loaded</span>
        <span className="lnp-status-right">
          <span>Kernel idle</span>
          <span>612 MB</span>
          <span>Autosaved</span>
        </span>
      </>
    ) : tool === "rstudio" ? (
      <>
        <span>
          <Activity aria-hidden="true" size={10} /> R 4.4.2
        </span>
        <span>renv 1.0.11 · 12 packages</span>
        <span className="lnp-status-right">
          <span>Session active</span>
          <span className="lnp-status-ok">● synced</span>
        </span>
      </>
    ) : (
      <>
        <span>
          <Wifi aria-hidden="true" size={10} /> sec-01.fra.spindle.dev
        </span>
        <span>bash 5.2 · tmux 3.5a</span>
        <span className="lnp-status-right">
          <span>{latency} ms</span>
          <span className="lnp-status-ok">TLS 1.3</span>
        </span>
      </>
    )

  return (
    <div className="lnp-shell">
      <div className="lnp-titlebar">
        <span className="lnp-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="lnp-title">
          <FlaskConical aria-hidden="true" size={12} />
          <span className="lnp-title-project">coastal-resilience</span>
          <span className="lnp-title-sep">/</span>
          <span className="lnp-title-muted">Spindle Lab</span>
          <span className="lnp-title-badge">remote</span>
        </div>
        <div className="lnp-titlebar-right">
          <button
            type="button"
            className={`lnp-conn${verified ? "is-verified" : ""}`}
            onClick={() => setShowConnection(true)}
            aria-haspopup="dialog"
            aria-expanded={showConnection}
          >
            <ShieldCheck aria-hidden="true" size={12} />
            <span className="lnp-conn-text">TLS 1.3</span>
            <span className="lnp-conn-latency">{latency} ms</span>
          </button>
          <span className="lnp-presence" aria-label="3 collaborators online">
            <i className="lnp-avatar lnp-avatar--mara">MO</i>
            <i className="lnp-avatar lnp-avatar--theo">TL</i>
            <i className="lnp-avatar lnp-avatar--priya">PR</i>
            <span className="lnp-avatar-more">+2</span>
          </span>
          <span className="lnp-session" title="Secure session uptime">
            <Clock aria-hidden="true" size={11} /> {formatSession(sessionSeconds)}
          </span>
        </div>
      </div>

      <div className="lnp-body">
        <nav className="lnp-rail" aria-label="Lab tools">
          {TOOLS.map(({ id, label, app, file, Icon }) => (
            <button
              key={id}
              type="button"
              className={`lnp-rail-btn${tool === id ? "is-active" : ""}`}
              onClick={() => setTool(id)}
              aria-pressed={tool === id}
              title={`${app} · ${file}`}
            >
              <span className="lnp-rail-icon">
                <Icon aria-hidden="true" size={19} strokeWidth={1.6} />
              </span>
              <span className="lnp-rail-label">{label}</span>
            </button>
          ))}
          <span className="lnp-rail-spacer" />
          <button
            type="button"
            className="lnp-rail-btn"
            title="Project search"
            aria-label="Project search"
          >
            <span className="lnp-rail-icon">
              <Search aria-hidden="true" size={18} strokeWidth={1.6} />
            </span>
            <span className="lnp-rail-label">Search</span>
          </button>
          <button type="button" className="lnp-rail-btn" title="Storage" aria-label="Storage usage">
            <span className="lnp-rail-icon">
              <HardDrive aria-hidden="true" size={18} strokeWidth={1.6} />
            </span>
            <span className="lnp-rail-label">Storage</span>
          </button>
        </nav>

        <div className="lnp-main">
          <div className="lnp-tabbar" role="tablist" aria-label="Open lab windows">
            {TOOLS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tool === entry.id}
                className={`lnp-tab${tool === entry.id ? "is-active" : ""}`}
                onClick={() => setTool(entry.id)}
              >
                <entry.Icon aria-hidden="true" size={12} />
                <span>{entry.file}</span>
                {entry.id === "notebook" ? <span className="lnp-tab-dot" /> : null}
              </button>
            ))}
            <span className="lnp-tabbar-note">
              <LockKeyhole aria-hidden="true" size={10} /> workspace mount · read/write
            </span>
          </div>

          <div className="lnp-content">
            {tool === "ide" ? <IdePanel /> : null}
            {tool === "notebook" ? <NotebookPanel /> : null}
            {tool === "rstudio" ? <RStudioPanel /> : null}
            {tool === "terminal" ? (
              <TerminalPanel onOpenConnection={() => setShowConnection(true)} />
            ) : null}
          </div>

          <footer className="lnp-statusbar">
            <span className="lnp-status-left">
              <span className="lnp-status-remote">
                <span className="lnp-status-dot" /> sec-01
              </span>
              {statusContent}
            </span>
            <span className="lnp-status-end">
              <ShieldCheck aria-hidden="true" size={10} /> end-to-end encrypted
            </span>
          </footer>
        </div>
      </div>

      {showConnection ? (
        <ConnectionPanel
          verified={verified}
          verifying={verifying}
          onVerify={verify}
          onClose={() => setShowConnection(false)}
        />
      ) : null}
    </div>
  )
}
