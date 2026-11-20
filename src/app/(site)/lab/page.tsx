import type { CSSProperties } from "react"
import "../../styles/lab.css"
import { LabCtaField, LabHeroField } from "@/components/lab-islands"
import { PageInteractions } from "@/components/site/page-interactions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "The Lab — Spindle",
  description:
    "Spindle's Lab brings Python notebooks, R, script runs, duckdb-wasm SQL, Excalidraw canvas, Desmos graphing, and a symbolic math engine into one green, local-first workspace.",
  path: "/lab",
})

export default function LabPage() {
  return (
    <PageTransition>
      <div className="lab-page">
        <main id="top" tabIndex={-1}>
          <section className="lab-hero" aria-labelledby="lab-hero-title">
            <div className="lab-dither-host" aria-hidden="true">
              <LabHeroField />
            </div>
            <div className="lab-hero-wash" aria-hidden="true"></div>
            <div className="lab-grid-lines" aria-hidden="true"></div>
            <div className="lab-hero-inner container">
              <div className="lab-hero-copy" data-reveal>
                <div className="lab-kicker">
                  <span className="lab-kicker-dot"></span> THE LAB{" "}
                  <span className="lab-kicker-sep">/</span> 8 LIVE TOOLS
                </div>
                <h1 id="lab-hero-title">
                  Think in code, math, and pictures.
                  <br />
                  <span className="lab-gradient-text">Stay in one place.</span>
                </h1>
                <p className="lab-hero-sub">
                  Notebooks, consoles, queries, canvases, and graphs — already running next to your
                  project files. No installs, no context switching, no waiting on a server.
                </p>
                <div className="lab-hero-actions">
                  <a href="#python" className="btn btn--primary btn--lg">
                    Explore the lab{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="/" className="btn btn--ghost btn--lg">
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>{" "}
                    Back to platform
                  </a>
                </div>
                <div className="lab-hero-meta">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-lock" />
                    </svg>{" "}
                    Runs in your browser
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-sparkle" />
                    </svg>{" "}
                    Files mounted by default
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Snapshots on every run
                  </span>
                </div>
              </div>
              <div
                className="lab-hero-stage"
                data-reveal
                data-reveal-delay="120"
                aria-label="Preview of the Spindle Lab workspace"
              >
                <div className="stage-orbit stage-orbit--one" aria-hidden="true"></div>
                <div className="stage-orbit stage-orbit--two" aria-hidden="true"></div>
                <div className="stage-orbit stage-orbit--three" aria-hidden="true"></div>
                <div className="stage-halo" aria-hidden="true"></div>
                <div className="stage-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">
                      <svg className="icon icon--xs">
                        <use href="#i-flask" />
                      </svg>{" "}
                      coastal-resilience / lab
                    </span>
                    <span className="window-bar-status">
                      <i></i> 8 tools ready
                    </span>
                  </div>
                  <div className="stage-window-body">
                    <div className="stage-rail" aria-hidden="true">
                      <span className="stage-rail-item is-active">PY</span>
                      <span className="stage-rail-item">R</span>
                      <span className="stage-rail-item">SQL</span>
                      <span className="stage-rail-item">ƒx</span>
                      <span className="stage-rail-item">◌</span>
                    </div>
                    <div className="stage-code">
                      <div className="stage-code-head">
                        <span>analysis.ipynb</span>
                        <span className="mono">PYTHON 3.12</span>
                      </div>
                      <pre aria-hidden="true">
                        <code>
                          <span className="tok-com">{"# everything is already mounted"}</span>
                          {"\n"}
                          <span className="tok-key">{"import"}</span>
                          {" spindle "}
                          <span className="tok-key">{"as"}</span>
                          {" sp\ndf = sp.data.load("}
                          <span className="tok-str">{"'tidal-2026.csv'"}</span>
                          {")\n\nresult = ("}
                          <span className="tok-fn">{"duckdb"}</span>
                          {".query("}
                          <span className="tok-str">{'"SELECT * FROM df"'}</span>
                          {")\n          .filter(salinity > "}
                          <span className="tok-num">{"28"}</span>
                          {"))\nresult.plot(kind="}
                          <span className="tok-str">{"'line'"}</span>
                          {")"}
                        </code>
                      </pre>
                      <div className="stage-code-foot">
                        <span className="stage-caret"></span>
                        <span className="mono">KERNEL IDLE · 12ms</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="stage-float stage-float--top" aria-hidden="true">
                  <span className="float-dot"></span>
                  <span>
                    Kernel warm
                    <br />
                    <strong>0.4s startup</strong>
                  </span>
                </div>
                <div className="stage-float stage-float--right" aria-hidden="true">
                  <svg className="icon icon--xs">
                    <use href="#i-chart" />
                  </svg>
                  <span>
                    24,819 rows
                    <br />
                    <strong>in-browser query</strong>
                  </span>
                </div>
                <div className="stage-float stage-float--bottom" aria-hidden="true">
                  <span className="float-wave">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <span>
                    live sync
                    <br />
                    <strong>project files</strong>
                  </span>
                </div>
              </div>
            </div>
            <div className="lab-toolbar-wrap">
              <nav className="lab-toolbar" aria-label="Lab tools">
                <div className="lab-toolbar-inner container">
                  <a href="#python" className="lab-tool-link is-active">
                    <span>01</span> Python Notebook
                  </a>
                  <a href="#r-console" className="lab-tool-link">
                    <span>02</span> R Console
                  </a>
                  <a href="#script-runner" className="lab-tool-link">
                    <span>03</span> Script Runner
                  </a>
                  <a href="#sql" className="lab-tool-link">
                    <span>04</span> SQL Explorer
                  </a>
                  <a href="#canvas" className="lab-tool-link">
                    <span>05</span> Canvas
                  </a>
                  <a href="#desmos" className="lab-tool-link">
                    <span>06</span> Desmos
                  </a>
                  <a href="#math" className="lab-tool-link">
                    <span>07</span> Math Engine
                  </a>
                  <a href="#visualizer" className="lab-tool-link">
                    <span>08</span> Visualizer
                  </a>
                </div>
              </nav>
            </div>
          </section>
          <section className="lab-section section" id="python" aria-labelledby="python-title">
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>01</span>
                  <i></i> NOTEBOOKS
                </div>
                <h2 id="python-title" className="section-title">
                  A Python notebook that starts where your files are.
                </h2>
                <p className="section-desc">
                  Open a Jupyter-style notebook with the project already mounted. Run cells, inspect
                  outputs, and keep every result attached to the research it came from.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Python 3.12 + the scientific stack</strong>
                      <small>pandas, NumPy, SciPy, matplotlib, scikit-learn</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Shared kernels</strong>
                      <small>Pair on the same notebook, see the same output</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Snapshots per run</strong>
                      <small>Roll back any cell, any time</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>Jupyter</span>
                  <span>pandas</span>
                  <span>matplotlib</span>
                  <span>IPYNB</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">analysis.ipynb</span>
                    <span className="window-bar-status">
                      <i></i> Python 3.12 ready
                    </span>
                  </div>
                  <div className="lab-demo-toolbar">
                    <button type="button" className="lab-run-btn" data-py-run>
                      <svg className="icon icon--xs">
                        <use href="#i-play" />
                      </svg>{" "}
                      Run all
                    </button>
                    <span className="lab-toolbar-note">Kernel: coastal-resilience</span>
                    <span className="mono lab-toolbar-right">CELLS 04</span>
                  </div>
                  <div className="notebook lab-notebook">
                    <div className="notebook-cell py-cell">
                      <span className="cell-in">[1]</span>
                      <code>
                        <span className="tok-key">import</span> pandas{" "}
                        <span className="tok-key">as</span> pd
                        <br />
                        df = pd.read_parquet(<span className="tok-str">'survey.parquet'</span>)
                      </code>
                    </div>
                    <div className="notebook-out">
                      <span className="cell-out">out</span>
                      <span id="pyOut">Loaded 48,102 rows × 14 columns</span>
                    </div>
                    <div className="notebook-cell py-cell">
                      <span className="cell-in">[2]</span>
                      <code>
                        df.groupby(<span className="tok-str">'site'</span>).salinity.mean().round(
                        <span className="tok-num">1</span>)
                      </code>
                    </div>
                    <div className="notebook-out">
                      <span className="cell-out">out</span>
                      <span>
                        site
                        <br />
                        A-01   28.4
                        <br />
                        A-02   27.9
                        <br />
                        B-04   31.2
                      </span>
                    </div>
                    <div className="notebook-cell py-cell">
                      <span className="cell-in">[3]</span>
                      <code>
                        <span className="tok-fn">plot</span>(df.date, df.turbidity, kind=
                        <span className="tok-str">'line'</span>)
                      </code>
                    </div>
                    <div className="py-plot" aria-label="Turbidity over time preview">
                      <svg viewBox="0 0 320 72" preserveAspectRatio="none">
                        <path
                          className="py-plot-line"
                          d="M0 58 C22 52 30 62 50 48 S82 30 100 40 S132 56 150 34 S182 22 200 30 S232 44 250 20 S282 26 320 8"
                        />
                      </svg>
                      <span className="mono">FIG. 01 · TURBIDITY / DATE</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="r-console"
            aria-labelledby="r-title"
          >
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">R 4.4 · coastal-resilience</span>
                    <span className="window-bar-status">
                      <i></i> Session live
                    </span>
                  </div>
                  <div className="r-layout">
                    <div className="r-console" id="rConsole" aria-label="R console preview">
                      <div className="r-line" style={{ "--i": "0" } as CSSProperties}>
                        <span className="r-prompt">{">"}</span> install.packages(
                        <span className="tok-str">"tidyverse"</span>){" "}
                        <span className="r-dim"># cached</span>
                      </div>
                      <div className="r-line r-line--muted" style={{ "--i": "1" } as CSSProperties}>
                        ✓ Using library <span className="tok-str">/spindle/pkgs</span>
                      </div>
                      <div className="r-line" style={{ "--i": "2" } as CSSProperties}>
                        <span className="r-prompt">{">"}</span> survey {"<"}- read_parquet(
                        <span className="tok-str">"data/survey.parquet"</span>)
                      </div>
                      <div className="r-line" style={{ "--i": "3" } as CSSProperties}>
                        <span className="r-prompt">{">"}</span>{" "}
                        <span className="tok-fn">ggplot</span>
                        (survey, <span className="tok-fn">aes</span>(salinity, turbidity)) +
                      </div>
                      <div className="r-line" style={{ "--i": "4" } as CSSProperties}>
                          <span className="tok-fn">geom_point</span>(alpha ={" "}
                        <span className="tok-num">0.7</span>) +{" "}
                        <span className="tok-fn">theme_minimal</span>()
                      </div>
                      <div className="r-line r-line--muted" style={{ "--i": "5" } as CSSProperties}>
                        ✓ Rendered plot in 0.6s
                      </div>
                      <div className="r-line r-line--input" style={{ "--i": "6" } as CSSProperties}>
                        <span className="r-prompt">{">"}</span> <span className="r-caret"></span>
                      </div>
                    </div>
                    <div className="r-plot">
                      <div className="r-plot-head">
                        <span>salinity vs. turbidity</span>
                        <span className="mono">GGPLOT2</span>
                      </div>
                      <svg
                        className="r-plot-svg"
                        viewBox="0 0 260 150"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path className="r-grid" d="M10 20H250M10 55H250M10 90H250M10 125H250" />
                        <path
                          className="r-trend"
                          d="M18 118 C70 102 110 84 150 62 S210 36 244 22"
                        />
                        <g className="r-dots" fill="#bfe389">
                          <circle cx="32" cy="106" r="3" style={{ "--d": "0" } as CSSProperties} />
                          <circle cx="58" cy="96" r="3" style={{ "--d": "1" } as CSSProperties} />
                          <circle cx="76" cy="101" r="3" style={{ "--d": "2" } as CSSProperties} />
                          <circle cx="98" cy="80" r="3" style={{ "--d": "3" } as CSSProperties} />
                          <circle cx="118" cy="86" r="3" style={{ "--d": "4" } as CSSProperties} />
                          <circle cx="142" cy="60" r="3" style={{ "--d": "5" } as CSSProperties} />
                          <circle cx="166" cy="66" r="3" style={{ "--d": "6" } as CSSProperties} />
                          <circle cx="190" cy="44" r="3" style={{ "--d": "7" } as CSSProperties} />
                          <circle cx="218" cy="36" r="3" style={{ "--d": "8" } as CSSProperties} />
                          <circle cx="236" cy="24" r="3" style={{ "--d": "9" } as CSSProperties} />
                        </g>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>02</span>
                  <i></i> CONSOLE
                </div>
                <h2 id="r-title" className="section-title">
                  R, with the packages already waiting.
                </h2>
                <p className="section-desc">
                  Drop into an R session with your data mounted and your libraries pinned. Plot
                  inline, keep the console history, and share the session with a teammate.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Pinned package snapshots</strong>
                      <small>The same environment every time you reopen a project</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Inline plots</strong>
                      <small>ggplot2 output rendered beside the console</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>No local setup</strong>
                      <small>RStudio-style workflow without installing R</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>R 4.4</span>
                  <span>ggplot2</span>
                  <span>tidyverse</span>
                  <span>renv</span>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section"
            id="script-runner"
            aria-labelledby="runner-title"
          >
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>03</span>
                  <i></i> AUTOMATION
                </div>
                <h2 id="runner-title" className="section-title">
                  Run a script. Watch every step.
                </h2>
                <p className="section-desc">
                  Execute Python, R, or shell scripts against project files with dependencies
                  resolved and secrets already in place. Stream the logs, inspect the diff, keep the
                  run history.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Any runtime</strong>
                      <small>Python, R, Node, or bash in the same runner</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Live logs</strong>
                      <small>Stdout, stderr, and timing as the script runs</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Repeatable</strong>
                      <small>One click now, or on a cron later</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>Python</span>
                  <span>R</span>
                  <span>Bash</span>
                  <span>Cron</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window runner-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Script Runner</span>
                    <span className="window-bar-status">
                      <i></i> Runtime ready
                    </span>
                  </div>
                  <div className="runner-body">
                    <div className="runner-list" role="group" aria-label="Available scripts">
                      <button
                        type="button"
                        className="runner-item is-active"
                        data-script="clean_data.py"
                        data-runtime="Python 3.12"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-code" />
                        </svg>
                        <span>
                          <strong>clean_data.py</strong>
                          <small>Python 3.12</small>
                        </span>
                        <i></i>
                      </button>
                      <button
                        type="button"
                        className="runner-item"
                        data-script="tides_sync.R"
                        data-runtime="R 4.4"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-code" />
                        </svg>
                        <span>
                          <strong>tides_sync.R</strong>
                          <small>R 4.4</small>
                        </span>
                        <i></i>
                      </button>
                      <button
                        type="button"
                        className="runner-item"
                        data-script="export.sh"
                        data-runtime="Bash"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-terminal" />
                        </svg>
                        <span>
                          <strong>export.sh</strong>
                          <small>Bash</small>
                        </span>
                        <i></i>
                      </button>
                    </div>
                    <div className="runner-main">
                      <div className="runner-head">
                        <span className="runner-file" id="runnerFile">
                          clean_data.py
                        </span>
                        <button
                          type="button"
                          className="lab-run-btn lab-run-btn--sm"
                          data-runner-run
                        >
                          <svg className="icon icon--xs">
                            <use href="#i-play" />
                          </svg>{" "}
                          Run
                        </button>
                      </div>
                      <div className="runner-progress">
                        <span id="runnerProgress"></span>
                      </div>
                      <div className="runner-meta">
                        <span id="runnerStatus">Ready to run</span>
                        <span className="mono" id="runnerTime">
                          0.0s
                        </span>
                      </div>
                      <div className="runner-logs" id="runnerLogs" aria-live="polite">
                        <div>
                          <span className="log-time">00:00</span>
                          <span>Local environment mounted</span>
                        </div>
                        <div>
                          <span className="log-time">00:01</span>
                          <span>
                            Reading <strong>data/tidal-2026.csv</strong>
                          </span>
                        </div>
                        <div>
                          <span className="log-time">00:02</span>
                          <span className="log-ok">✓ 48,102 rows validated</span>
                        </div>
                        <div>
                          <span className="log-time">00:03</span>
                          <span className="log-ok">
                            ✓ Wrote <strong>output/clean.csv</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="sql"
            aria-labelledby="sql-title"
          >
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window sql-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">SQL Explorer · duckdb-wasm</span>
                    <span className="window-bar-status">
                      <i></i> In-browser engine
                    </span>
                  </div>
                  <div className="sql-toolbar">
                    <span className="sql-source">
                      <svg className="icon icon--xs">
                        <use href="#i-grid" />
                      </svg>{" "}
                      data/2026/*.parquet
                    </span>
                    <button type="button" className="lab-run-btn lab-run-btn--sm" data-sql-run>
                      <svg className="icon icon--xs">
                        <use href="#i-play" />
                      </svg>{" "}
                      Run query
                    </button>
                  </div>
                  <div className="sql-editor" aria-label="SQL query preview">
                    <div>
                      <span className="sql-num">1</span>
                      <span className="tok-key">SELECT</span> site,{" "}
                      <span className="tok-fn">AVG</span>(salinity){" "}
                      <span className="tok-key">AS</span> avg_salt
                    </div>
                    <div>
                      <span className="sql-num">2</span>
                      <span className="tok-key">FROM</span> read_parquet(
                      <span className="tok-str">'data/survey.parquet'</span>)
                    </div>
                    <div>
                      <span className="sql-num">3</span>
                      <span className="tok-key">WHERE</span> sampled_at {">"}{" "}
                      <span className="tok-str">'2026-01-01'</span>
                    </div>
                    <div>
                      <span className="sql-num">4</span>
                      <span className="tok-key">GROUP BY</span> site{" "}
                      <span className="tok-key">ORDER BY</span> avg_salt{" "}
                      <span className="tok-key">DESC</span>
                      <span className="sql-caret"></span>
                    </div>
                  </div>
                  <div className="sql-result">
                    <div className="sql-result-head">
                      <span>Results</span>
                      <span className="mono" id="sqlStatus">
                        12 ROWS · 12 MS · LOCAL
                      </span>
                    </div>
                    <div className="sql-table">
                      <span>site</span>
                      <span>avg_salt</span>
                      <span>delta</span>
                      <span>B-04</span>
                      <span>31.2</span>
                      <span className="up">+2.4</span>
                      <span>A-01</span>
                      <span>28.4</span>
                      <span className="up">+1.1</span>
                      <span>A-02</span>
                      <span>27.9</span>
                      <span className="up">+0.6</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>04</span>
                  <i></i> QUERIES
                </div>
                <h2 id="sql-title" className="section-title">
                  SQL over your files. No server required.
                </h2>
                <p className="section-desc">
                  The SQL Explorer is powered by <strong>duckdb-wasm</strong> — DuckDB compiled to
                  WebAssembly and running right in your browser. Query CSV, Parquet, and in-memory
                  tables with full SQL, and the data never has to leave your machine.
                </p>
                <div className="lab-tech-note">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-shield" />
                    </svg>{" "}
                    WHY DUCKDB-WASM
                  </div>
                  <p>
                    Columnar scans, joins, and aggregations happen locally at near-native speed.
                    There is no database to provision, no upload step, and no wait — point a query
                    at a project file and get results instantly.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>duckdb-wasm</span>
                  <span>CSV</span>
                  <span>Parquet</span>
                  <span>Full SQL</span>
                </div>
              </div>
            </div>
          </section>
          <section className="lab-section section" id="canvas" aria-labelledby="canvas-title">
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>05</span>
                  <i></i> WHITEBOARD
                </div>
                <h2 id="canvas-title" className="section-title">
                  Sketch the idea before you build it.
                </h2>
                <p className="section-desc">
                  Canvas is built on Excalidraw, so every diagram feels hand-drawn and every tool is
                  familiar. Map a pipeline, circle a result, or leave a note for a teammate — right
                  beside the data.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Infinite canvas</strong>
                      <small>Zoom and pan without losing the thread</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Live collaboration</strong>
                      <small>Draw together with cursors visible</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Exportable diagrams</strong>
                      <small>Drop a sketch into a notebook or a report</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>Excalidraw</span>
                  <span>Diagrams</span>
                  <span>Sticky notes</span>
                  <span>SVG export</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window canvas-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">field-notes.canvas</span>
                    <span className="window-bar-status">
                      <i></i> 2 editing
                    </span>
                  </div>
                  <div className="canvas-toolbar" aria-hidden="true">
                    <span className="canvas-tool is-active">
                      <svg className="icon icon--xs">
                        <use href="#i-pen" />
                      </svg>
                    </span>
                    <span className="canvas-tool">▭</span>
                    <span className="canvas-tool">○</span>
                    <span className="canvas-tool">→</span>
                    <span className="canvas-tool">▤</span>
                    <span className="canvas-tool">T</span>
                    <span className="canvas-tool-sep"></span>
                    <span className="canvas-tool">↶</span>
                    <span className="canvas-tool">↷</span>
                  </div>
                  <div className="canvas-board">
                    <svg
                      className="canvas-lines"
                      viewBox="0 0 560 300"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d="M96 128 C158 70 244 72 304 116 S414 190 468 132" />
                      <path d="M470 126l-14-3 8 12" />
                      <ellipse cx="200" cy="196" rx="84" ry="46" />
                    </svg>
                    <div className="canvas-note canvas-note--a" data-drag tabIndex={0}>
                      <span className="note-pin"></span>
                      <strong>Hypothesis</strong>
                      <span>Wetland recovery tracks salinity more than tide height.</span>
                    </div>
                    <div className="canvas-note canvas-note--b" data-drag tabIndex={0}>
                      <span className="note-pin"></span>
                      <strong>Next step</strong>
                      <span>Plot salinity × turbidity by site.</span>
                    </div>
                    <div className="canvas-note canvas-note--c" data-drag tabIndex={0}>
                      <span className="note-pin"></span>
                      <span className="note-sketch">~30% of sites</span>
                    </div>
                    <div className="canvas-shape" aria-hidden="true">
                      <span>data</span>
                      <span>→</span>
                      <span>clean</span>
                      <span>→</span>
                      <span>model</span>
                    </div>
                    <div className="canvas-cursor canvas-cursor--one" aria-hidden="true">
                      <span>Mara</span>
                    </div>
                    <div className="canvas-cursor canvas-cursor--two" aria-hidden="true">
                      <span>Theo</span>
                    </div>
                  </div>
                  <div className="canvas-foot">
                    <span className="mono">DRAG A NOTE TO MOVE IT</span>
                    <span>Excalidraw engine · autosaved</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="desmos"
            aria-labelledby="desmos-title"
          >
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window graph-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Desmos · coastal-resilience</span>
                    <span className="window-bar-status">
                      <i></i> Graphing live
                    </span>
                  </div>
                  <div className="graph-body">
                    <div className="graph-expressions">
                      <div className="graph-expr is-active">
                        <span className="expr-index">1</span>
                        <span className="expr-swatch expr-swatch--a"></span>
                        <span>
                          y = <b id="exprCoeff">1.4</b> sin(x)
                        </span>
                      </div>
                      <div className="graph-expr">
                        <span className="expr-index">2</span>
                        <span className="expr-swatch expr-swatch--b"></span>
                        <span>y = cos(2x) / 2</span>
                      </div>
                      <div className="graph-expr">
                        <span className="expr-index">3</span>
                        <span className="expr-swatch expr-swatch--c"></span>
                        <span>y = x² / 18 − 2</span>
                      </div>
                      <div className="graph-slider">
                        <label htmlFor="desmosA">
                          a = <output id="desmosAOut">1.4</output>
                        </label>
                        <input
                          type="range"
                          id="desmosA"
                          data-desmos-a
                          min="0.4"
                          max="2.6"
                          step="0.1"
                          defaultValue="1.4"
                        />
                      </div>
                    </div>
                    <div className="graph-plot">
                      <svg
                        id="desmosGraph"
                        viewBox="0 0 400 300"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Graph of three functions with an adjustable sine amplitude"
                      >
                        <g className="graph-grid">
                          <path d="M0 50H400M0 100H400M0 150H400M0 200H400M0 250H400" />
                          <path d="M50 0V300M100 0V300M150 0V300M200 0V300M250 0V300M300 0V300M350 0V300" />
                        </g>
                        <path className="graph-axis" d="M0 150H400M200 0V300" />
                        <path
                          className="graph-curve graph-curve--b"
                          d="M0 136 Q25 120 50 150 T100 150 T150 150 T200 150 T250 150 T300 150 T350 150 T400 150"
                        />
                        <path
                          className="graph-curve graph-curve--c"
                          d="M0 122 Q100 244 200 56 Q300 -112 400 6"
                        />
                        <path className="graph-curve graph-curve--a" id="desmosCurve" d="" />
                        <circle className="graph-marker" id="desmosMarker" r="4" cx="0" cy="150" />
                      </svg>
                      <span className="mono graph-axis-label">x ∈ [−10, 10]</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>06</span>
                  <i></i> GRAPHING
                </div>
                <h2 id="desmos-title" className="section-title">
                  Desmos, right next to the numbers.
                </h2>
                <p className="section-desc">
                  Open Desmos inside the Lab to explore a function visually. Drag a slider, trace a
                  curve, and keep the graph linked to the notebook or dataset that produced it.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Sliders that feel instant</strong>
                      <small>Watch a parameter change the whole curve</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Graphs as project files</strong>
                      <small>Saved, shared, and versioned with everything else</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>From data to function</strong>
                      <small>Plot a fit, then hand the equation to the math engine</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>Desmos</span>
                  <span>Sliders</span>
                  <span>Tracing</span>
                  <span>Export SVG</span>
                </div>
              </div>
            </div>
          </section>
          <section className="lab-section section" id="math" aria-labelledby="math-title">
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>07</span>
                  <i></i> SYMBOLIC MATH
                </div>
                <h2 id="math-title" className="section-title">
                  Type the equation. Get the reasoning.
                </h2>
                <p className="section-desc">
                  The Mathematical Engine pairs MathLive for a real typeset equation editor with
                  nerdamer for symbolic algebra and SymbolicCAS for the deeper computer-algebra
                  layer. Simplify, differentiate, integrate, and solve — with steps you can follow.
                </p>
                <div className="lab-tech-note lab-tech-note--bright">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-sigma" />
                    </svg>{" "}
                    UNDER THE HOOD
                  </div>
                  <p>
                    <strong>mathlive</strong> renders and edits the notation,{" "}
                    <strong>nerdamer</strong> handles symbolic manipulation in JavaScript, and{" "}
                    <strong>symbolicCAS</strong> adds structured solving and step generation. It all
                    runs in the Lab tab.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>mathlive</span>
                  <span>nerdamer</span>
                  <span>symbolicCAS</span>
                  <span>LaTeX</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window math-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Mathematical Engine</span>
                    <span className="window-bar-status">
                      <i></i> CAS ready
                    </span>
                  </div>
                  <div className="math-body">
                    <div className="math-input-wrap">
                      <span className="mono">EXPRESSION</span>
                      <div className="math-input">
                        <span id="mathExpression">x² − 5x + 6 = 0</span>
                        <span className="math-caret"></span>
                      </div>
                    </div>
                    <div className="math-examples" role="group" aria-label="Example expressions">
                      <button
                        type="button"
                        className="math-example is-active"
                        data-math-example="quadratic"
                      >
                        Quadratic
                      </button>
                      <button type="button" className="math-example" data-math-example="derivative">
                        Derivative
                      </button>
                      <button type="button" className="math-example" data-math-example="integral">
                        Integral
                      </button>
                    </div>
                    <button type="button" className="math-solve" data-math-solve>
                      <svg className="icon icon--xs">
                        <use href="#i-sparkle" />
                      </svg>{" "}
                      Solve symbolically
                    </button>
                    <div className="math-result" id="mathResult" aria-live="polite">
                      <div className="math-result-head">
                        <span>Solution</span>
                        <span className="mono">STEP-BY-STEP</span>
                      </div>
                      <div className="math-steps">
                        <div>
                          <span>01</span>
                          <span>Factor the expression</span>
                          <strong>(x − 2)(x − 3) = 0</strong>
                        </div>
                        <div>
                          <span>02</span>
                          <span>Apply the zero-product rule</span>
                          <strong>x − 2 = 0 or x − 3 = 0</strong>
                        </div>
                        <div>
                          <span>03</span>
                          <span>Solve for x</span>
                          <strong className="math-answer">x = 2, x = 3</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="visualizer"
            aria-labelledby="visualizer-title"
          >
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window viz-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Visualizer · new view</span>
                    <span className="window-bar-status" id="vizStatus">
                      <i></i> Waiting for a file
                    </span>
                  </div>
                  <div className="viz-body">
                    <label className="viz-drop" id="vizDrop" htmlFor="vizFile" tabIndex={0}>
                      <input type="file" id="vizFile" accept=".csv,.sql,.txt" hidden />
                      <span className="viz-drop-icon">
                        <svg className="icon">
                          <use href="#i-upload" />
                        </svg>
                      </span>
                      <strong>Drop a CSV or SQL file here</strong>
                      <span>or click to browse — the view builds itself, right here</span>
                      <span className="viz-scan" aria-hidden="true"></span>
                    </label>
                    <div className="viz-samples" role="group" aria-label="Try a sample file">
                      <button type="button" data-viz-sample="csv">
                        Try sample CSV
                      </button>
                      <button type="button" data-viz-sample="sql">
                        Try sample SQL
                      </button>
                    </div>
                    <div className="viz-preview" id="vizPreview" hidden>
                      <div className="viz-preview-head">
                        <span id="vizTitle">tidal-2026.csv</span>
                        <span className="mono" id="vizMeta">
                          CSV · 8 columns
                        </span>
                      </div>
                      <div className="viz-table-wrap" id="vizTable"></div>
                      <div className="viz-chart" id="vizChart" aria-hidden="true"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>08</span>
                  <i></i> DATA VIEWS
                </div>
                <h2 id="visualizer-title" className="section-title">
                  A file goes in. A view comes out.
                </h2>
                <p className="section-desc">
                  Upload a CSV or SQL file and the Visualizer lays it out for you — columns, rows,
                  patterns, and a quick chart. It is the fastest way to understand a file before you
                  decide what to do with it.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>CSV, understood instantly</strong>
                      <small>Headers, types, and a sortable-looking preview in one step</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>SQL, made readable</strong>
                      <small>Syntax-highlighted and ready to open in the SQL Explorer</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Views that stay with the project</strong>
                      <small>Save the view next to the file it came from</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-chips">
                  <span>CSV</span>
                  <span>SQL</span>
                  <span>Drag & drop</span>
                  <span>Live preview</span>
                </div>
              </div>
            </div>
          </section>
          <section className="lab-cta section" id="lab-start" aria-labelledby="lab-cta-title">
            <div className="lab-dither-host lab-dither-host--cta" aria-hidden="true">
              <LabCtaField />
            </div>
            <div className="container">
              <div className="lab-cta-box" data-reveal>
                <div className="lab-kicker">
                  <span className="lab-kicker-dot"></span> EVERYTHING, ALREADY RUNNING
                </div>
                <h2 id="lab-cta-title">Bring your tools. Leave the setup.</h2>
                <p>
                  Notebooks, R, scripts, SQL on duckdb-wasm, Excalidraw, Desmos, symbolic math, and
                  file views — one Lab tab in every project.
                </p>
                <div className="lab-hero-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Create free workspace{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="/" className="btn btn--ghost btn--lg">
                    See the platform
                  </a>
                </div>
                <p className="lab-legal-note">
                  Lab compute is shared. Mining crypto, escaping a sandbox, or running workloads
                  unrelated to the project is prohibited by the{" "}
                  <a href="/acceptable-use">Acceptable Use Policy</a>.
                </p>
              </div>
            </div>
          </section>
        </main>

        <PageInteractions page="lab" />
      </div>
    </PageTransition>
  )
}
