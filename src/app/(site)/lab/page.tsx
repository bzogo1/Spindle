import type { CSSProperties } from "react"
import "../../styles/lab.css"
import { LabCtaField, LabHeroField } from "@/components/lab-islands"
import { LiveRowCount } from "@/components/site/live-row-count"
import { PageInteractions } from "@/components/site/page-interactions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "The Lab — Spindle",
  description:
    "Spindle's Lab brings Python notebooks, R, script runs, duckdb-wasm SQL, Excalidraw canvas, Desmos graphing, a symbolic math engine, four full environments, reproducible tool runs, and cross-browser snapshot baselines into one green, local-first workspace.",
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
            
            {/* New header section above dither */}
            <div className="lab-pre-hero container" data-reveal>
              <div className="lab-pre-hero-content">
                <span className="lab-pre-hero-label">Unified Workspace</span>
                <h2 className="lab-pre-hero-title">The Lab</h2>
                <p className="lab-pre-hero-tagline">
                  Where experimentation thrives and breakthroughs happen at the speed of thought
                </p>
              </div>
            </div>
            
            <div className="lab-hero-inner container">
              <div className="lab-hero-copy" data-reveal>
                <div className="lab-kicker">
                  <span className="lab-kicker-dot"></span> THE LAB{" "}
                  <span className="lab-kicker-sep">/</span> 8 TOOLS · 4 ENVIRONMENTS
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
                  <a href="#workflows" className="lab-tool-link">
                    <span>09</span> Workflows
                  </a>
                  <a href="#live-sync" className="lab-tool-link">
                    <span>10</span> Live sync
                  </a>
                  <a href="#local-first" className="lab-tool-link">
                    <span>11</span> Local-first
                  </a>
                  <a href="#environments" className="lab-tool-link">
                    <span>12</span> Environments
                  </a>
                  <a href="#workbench" className="lab-tool-link">
                    <span>13</span> Workbench
                  </a>
                  <a href="#snapshots" className="lab-tool-link">
                    <span>14</span> Snapshots
                  </a>
                  <a href="#benchmarks" className="lab-tool-link">
                    <span>15</span> Benchmarks
                  </a>
                  <a href="#faq" className="lab-tool-link">
                    <span>16</span> FAQ
                  </a>
                  <a href="#quick-start" className="lab-tool-link">
                    <span>17</span> Quick start
                  </a>
                </div>
              </nav>
            </div>
          </section>
          
          {/* Creative capabilities showcase section */}
          <section className="lab-capabilities section" aria-labelledby="capabilities-title">
            <div className="container">
              <div className="lab-capabilities-header" data-reveal>
                <div className="lab-index">
                  <span>∞</span>
                  <i></i> POSSIBILITIES
                </div>
                <h2 id="capabilities-title" className="section-title">
                  Your imagination is the only limit
                </h2>
                <p className="section-desc">
                  From rapid prototyping to production analysis, the Lab adapts to your workflow.
                  Code, compute, visualize, and iterate—all without leaving your workspace.
                </p>
              </div>
              
              <div className="lab-capabilities-grid">
                <article className="capability-card" data-reveal data-reveal-delay="0">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-lightning" />
                    </svg>
                  </div>
                  <h3>Lightning-fast iteration</h3>
                  <p>Hot kernels, live data binding, and instant feedback mean you spend less time waiting and more time discovering.</p>
                </article>
                
                <article className="capability-card" data-reveal data-reveal-delay="50">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-git-branch" />
                    </svg>
                  </div>
                  <h3>Snapshot-driven exploration</h3>
                  <p>Every run creates an immutable snapshot. Branch your thinking, compare approaches, and never lose a hypothesis.</p>
                </article>
                
                <article className="capability-card" data-reveal data-reveal-delay="100">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-users" />
                    </svg>
                  </div>
                  <h3>Collaborate in real-time</h3>
                  <p>Share kernels, pair on notebooks, and sync your thinking without endless Slack threads or email chains.</p>
                </article>
                
                <article className="capability-card" data-reveal data-reveal-delay="150">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-shield-check" />
                    </svg>
                  </div>
                  <h3>Reproducible by design</h3>
                  <p>Pinned environments, versioned packages, and deterministic runs mean your analysis holds up under scrutiny.</p>
                </article>
                
                <article className="capability-card" data-reveal data-reveal-delay="200">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-zap" />
                    </svg>
                  </div>
                  <h3>No setup required</h3>
                  <p>Python, R, SQL, and more are ready to go. No Docker, no conda nonsense, no installation friction.</p>
                </article>
                
                <article className="capability-card" data-reveal data-reveal-delay="250">
                  <div className="capability-icon">
                    <svg className="icon icon--lg" aria-hidden="true">
                      <use href="#i-globe" />
                    </svg>
                  </div>
                  <h3>Works offline too</h3>
                  <p>Canvas, Desmos, math engine, and visualizer continue working without a connection. Your work never stops.</p>
                </article>
              </div>
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
                      <LiveRowCount id="pyOut" />
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
          <section className="lab-section section" id="workflows" aria-labelledby="workflows-title">
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>09</span>
                  <i></i> WORKFLOWS
                </div>
                <h2 id="workflows-title" className="section-title">
                  One tool feeds the next. No copy-paste.
                </h2>
                <p className="section-desc">
                  The Lab tools share the same file system, so you can run a SQL query in
                  duckdb-wasm, pass the results straight into a Python notebook cell, visualize the
                  output, and sketch a diagram over it — all without leaving the tab.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>SQL to notebook</strong>
                      <small>Query results become a pandas DataFrame in one line</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Notebook to graph</strong>
                      <small>Export a calculation to Desmos for visual exploration</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Canvas as a buffer</strong>
                      <small>Sketch a pipeline diagram, link it to the notebook that ran it</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-tech-note">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-flask" />
                    </svg>{" "}
                    REAL EXAMPLE
                  </div>
                  <p>
                    <code>result = duckdb.query("SELECT * FROM data").to_df()</code> loads SQL
                    output directly into pandas. From there, plot with matplotlib or send to the
                    visualizer.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>duckdb</span>
                  <span>pandas</span>
                  <span>Chain</span>
                  <span>Zero export</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window workflow-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">coastal-resilience / workflow</span>
                    <span className="window-bar-status">
                      <i></i> 3 tools linked
                    </span>
                  </div>
                  <div className="workflow-body">
                    <div className="workflow-steps" aria-label="Workflow steps">
                      <div className="workflow-step">
                        <span className="workflow-num">01</span>
                        <span className="workflow-tool">
                          <svg className="icon icon--xs">
                            <use href="#i-database" />
                          </svg>{" "}
                          SQL
                        </span>
                        <code>SELECT site, AVG(salinity) FROM data GROUP BY site</code>
                        <span className="workflow-arrow" aria-hidden="true">
                          →
                        </span>
                      </div>
                      <div className="workflow-step">
                        <span className="workflow-num">02</span>
                        <span className="workflow-tool">
                          <svg className="icon icon--xs">
                            <use href="#i-code" />
                          </svg>{" "}
                          Python
                        </span>
                        <code>df.plot(kind='bar', x='site')</code>
                        <span className="workflow-arrow" aria-hidden="true">
                          →
                        </span>
                      </div>
                      <div className="workflow-step">
                        <span className="workflow-num">03</span>
                        <span className="workflow-tool">
                          <svg className="icon icon--xs">
                            <use href="#i-chart" />
                          </svg>{" "}
                          Visualizer
                        </span>
                        <span className="workflow-result">8 sites × avg_salinity</span>
                      </div>
                    </div>
                    <div className="workflow-diagram">
                      <svg viewBox="0 0 400 120" aria-hidden="true">
                        <rect
                          x="10"
                          y="40"
                          width="100"
                          height="40"
                          rx="4"
                          className="workflow-box"
                        />
                        <text x="60" y="65" textAnchor="middle">
                          SQL Query
                        </text>
                        <path d="M110 60 L140 60" className="workflow-line" />
                        <polygon points="140,60 130,55 130,65" className="workflow-arrow-head" />
                        <rect
                          x="140"
                          y="40"
                          width="100"
                          height="40"
                          rx="4"
                          className="workflow-box"
                        />
                        <text x="190" y="65" textAnchor="middle">
                          Python
                        </text>
                        <path d="M240 60 L270 60" className="workflow-line" />
                        <polygon points="270,60 260,55 260,65" className="workflow-arrow-head" />
                        <rect
                          x="270"
                          y="40"
                          width="100"
                          height="40"
                          rx="4"
                          className="workflow-box"
                        />
                        <text x="320" y="65" textAnchor="middle">
                          Visualizer
                        </text>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="live-sync"
            aria-labelledby="collab-title"
          >
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window collab-lab-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">analysis.ipynb</span>
                    <span className="window-bar-status">
                      <i></i> 3 collaborators
                    </span>
                  </div>
                  <div className="collab-lab-body">
                    <div className="collab-lab-presence">
                      <div className="presence-avatar presence-avatar--lime">MR</div>
                      <div className="presence-avatar presence-avatar--mint">TJ</div>
                      <div className="presence-avatar presence-avatar--teal">JL</div>
                      <span className="presence-label">Mara, Theo, Jules editing</span>
                    </div>
                    <div className="notebook lab-notebook">
                      <div className="notebook-cell py-cell">
                        <span className="cell-in">[7]</span>
                        <code>
                          <span className="tok-key">import</span> spindle{" "}
                          <span className="tok-key">as</span> sp
                          <br />
                          df = sp.data.load(<span className="tok-str">'tidal-2026.csv'</span>)
                        </code>
                        <span
                          className="remote-cursor-label remote-cursor-label--mara"
                          aria-hidden="true"
                        >
                          Mara
                        </span>
                      </div>
                      <div className="notebook-out">
                        <span className="cell-out">out</span>
                        <span>Loaded 48,102 rows × 14 columns</span>
                      </div>
                      <div className="notebook-cell py-cell notebook-cell--active">
                        <span className="cell-in">[8]</span>
                        <code>
                          grouped = df.groupby(<span className="tok-str">'site'</span>).mean()
                          <br />
                          grouped.plot()
                        </code>
                        <span
                          className="remote-cursor-label remote-cursor-label--theo"
                          aria-hidden="true"
                        >
                          Theo
                        </span>
                      </div>
                      <div className="notebook-out">
                        <span className="cell-out">out</span>
                        <span className="mini-plot">
                          <svg viewBox="0 0 200 40" preserveAspectRatio="none">
                            <path d="M0 30 Q30 25 50 20 T100 15 T150 10 T200 5" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <div className="collab-lab-chat">
                      <span className="chat-indicator">
                        <svg className="icon icon--xs">
                          <use href="#i-message" />
                        </svg>{" "}
                        2 new in #analysis
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>10</span>
                  <i></i> COLLABORATION
                </div>
                <h2 id="collab-title" className="section-title">
                  Run together. See together.
                </h2>
                <p className="section-desc">
                  Open the same notebook and you see each other's cursors, selections, and cell
                  outputs in real time. The R console, SQL explorer, and canvas all sync the same
                  way — using the same CRDT engine that powers the rest of Spindle.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Shared kernels</strong>
                      <small>
                        One Python or R process, multiple browsers viewing the same state
                      </small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Cursor presence</strong>
                      <small>See who is typing, where, and what they have selected</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Linked to chat</strong>
                      <small>Discuss a result in the project channel without switching tabs</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-tech-note lab-tech-note--bright">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-bolt" />
                    </svg>{" "}
                    UNDER THE HOOD
                  </div>
                  <p>
                    The same Yjs CRDT that powers document editing runs under the Lab tools.
                    Keystrokes and cell outputs arrive in under 40ms — fast enough to feel
                    simultaneous.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>Yjs</span>
                  <span>WebSocket</span>
                  <span>CRDT</span>
                  <span>Shared kernel</span>
                </div>
              </div>
            </div>
          </section>
          <section className="lab-section section" id="local-first" aria-labelledby="local-title">
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>11</span>
                  <i></i> LOCAL ARCHITECTURE
                </div>
                <h2 id="local-title" className="section-title">
                  Your data never leaves your machine.
                </h2>
                <p className="section-desc">
                  Every Lab tool runs in your browser or on Spindle's shared compute infrastructure
                  — never on a remote server you do not control. Your project files stay on your
                  disk or in your cloud storage, and the compute runs alongside them.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>WASM-powered tools</strong>
                      <small>duckdb-wasm, Pyodide, and WebR run entirely in the browser</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Zero data upload</strong>
                      <small>Query a 2GB Parquet file without sending a single byte remotely</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Optional cloud compute</strong>
                      <small>Python and R run on shared infrastructure only when you choose</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-tech-note">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-shield" />
                    </svg>{" "}
                    WHY IT MATTERS
                  </div>
                  <p>
                    Research data often contains sensitive information — clinical records, field
                    site locations, or proprietary measurements. With local-first compute, you
                    control where the data lives, not a platform policy.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>duckdb-wasm</span>
                  <span>Pyodide</span>
                  <span>WebR</span>
                  <span>Local-first</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window local-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Compute architecture</span>
                    <span className="window-bar-status">
                      <i></i> 100% local
                    </span>
                  </div>
                  <div className="local-body">
                    <div className="local-diagram">
                      <svg viewBox="0 0 380 200" aria-hidden="true">
                        <rect
                          x="10"
                          y="70"
                          width="80"
                          height="60"
                          rx="8"
                          className="local-box local-box--browser"
                        />
                        <text x="50" y="105" textAnchor="middle" className="local-label">
                          Browser
                        </text>
                        <rect
                          x="120"
                          y="10"
                          width="60"
                          height="50"
                          rx="4"
                          className="local-box local-box--wasm"
                        />
                        <text
                          x="150"
                          y="40"
                          textAnchor="middle"
                          className="local-label local-label--sm"
                        >
                          duckdb
                        </text>
                        <rect
                          x="120"
                          y="80"
                          width="60"
                          height="50"
                          rx="4"
                          className="local-box local-box--wasm"
                        />
                        <text
                          x="150"
                          y="110"
                          textAnchor="middle"
                          className="local-label local-label--sm"
                        >
                          Pyodide
                        </text>
                        <rect
                          x="120"
                          y="150"
                          width="60"
                          height="40"
                          rx="4"
                          className="local-box local-box--wasm"
                        />
                        <text
                          x="150"
                          y="175"
                          textAnchor="middle"
                          className="local-label local-label--sm"
                        >
                          WebR
                        </text>
                        <rect
                          x="220"
                          y="80"
                          width="80"
                          height="60"
                          rx="8"
                          className="local-box local-box--remote"
                        />
                        <text x="260" y="105" textAnchor="middle" className="local-label">
                          Remote
                        </text>
                        <text
                          x="260"
                          y="125"
                          textAnchor="middle"
                          className="local-label local-label--sm"
                        >
                          (on demand)
                        </text>
                        <path d="M90 100 L120 35" className="local-line local-line--local" />
                        <path d="M90 100 L120 105" className="local-line local-line--local" />
                        <path d="M90 100 L120 170" className="local-line local-line--local" />
                        <path d="M180 35 L220 110" className="local-line local-line--opt" />
                        <path d="M180 105 L220 110" className="local-line local-line--opt" />
                        <path d="M180 170 L220 110" className="local-line local-line--opt" />
                        <rect
                          x="310"
                          y="85"
                          width="60"
                          height="50"
                          rx="4"
                          className="local-box local-box--disk"
                        />
                        <text
                          x="340"
                          y="115"
                          textAnchor="middle"
                          className="local-label local-label--sm"
                        >
                          Your files
                        </text>
                        <path d="M300 110 L310 110" className="local-line" />
                      </svg>
                    </div>
                    <div className="local-legend">
                      <div className="local-legend-item">
                        <span className="local-legend-color local-legend-color--browser"></span>
                        <span>Client</span>
                      </div>
                      <div className="local-legend-item">
                        <span className="local-legend-color local-legend-color--wasm"></span>
                        <span>WebAssembly (in-browser)</span>
                      </div>
                      <div className="local-legend-item">
                        <span className="local-legend-color local-legend-color--remote"></span>
                        <span>Shared compute (optional)</span>
                      </div>
                      <div className="local-legend-item">
                        <span className="local-legend-color local-legend-color--disk"></span>
                        <span>Local storage</span>
                      </div>
                    </div>
                    <div className="local-stats">
                      <div className="local-stat">
                        <strong>0 bytes</strong>
                        <span>uploaded to query</span>
                      </div>
                      <div className="local-stat">
                        <strong>2GB</strong>
                        <span>Parquet in-browser</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="environments"
            aria-labelledby="environments-title"
          >
            <div className="lab-split container">
              <div className="lab-copy" data-reveal>
                <div className="lab-index">
                  <span>12</span>
                  <i></i> SURFACES
                </div>
                <h2 id="environments-title" className="section-title">
                  Four environments. One project underneath.
                </h2>
                <p className="section-desc">
                  The Lab opens <strong>JupyterLab</strong>, <strong>RStudio</strong>,{" "}
                  <strong>VS Code</strong>, and a <strong>terminal</strong> against the same mounted
                  project. Switch when the task changes; files, environment variables, and package
                  snapshots follow you. Nothing is installed on your machine.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>One volume, every surface</strong>
                      <small>A notebook, an R session, and a terminal see the same files</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Package snapshots per project</strong>
                      <small>pip and install.packages resolve against a pinned lockfile</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Warm sessions</strong>
                      <small>Resume where you left off after a short idle window</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-env-note">
                  <span className="mono">SESSION</span>
                  <p>
                    2 vCPU · 4 GB RAM · warm for 10 minutes after the last edit, then snapshotted
                    automatically.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>JupyterLab</span>
                  <span>RStudio</span>
                  <span>VS Code</span>
                  <span>Terminal</span>
                </div>
              </div>
              <div className="lab-demo" data-reveal data-reveal-delay="100">
                <div className="product-window lab-window env-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Environments · coastal-resilience</span>
                    <span className="window-bar-status">
                      <i></i> 4 surfaces ready
                    </span>
                  </div>
                  <div className="env-tabs" role="tablist" aria-label="Lab environments">
                    <button
                      type="button"
                      role="tab"
                      id="env-tab-jupyter"
                      aria-controls="env-panel-jupyter"
                      aria-selected="true"
                      tabIndex={0}
                      className="env-tab is-active"
                      data-env-tab="jupyter"
                    >
                      <svg className="icon icon--xs">
                        <use href="#i-code" />
                      </svg>
                      <span>
                        <strong>JupyterLab</strong>
                        <small>analysis.ipynb</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="env-tab-rstudio"
                      aria-controls="env-panel-rstudio"
                      aria-selected="false"
                      tabIndex={-1}
                      className="env-tab"
                      data-env-tab="rstudio"
                    >
                      <svg className="icon icon--xs">
                        <use href="#i-chart" />
                      </svg>
                      <span>
                        <strong>RStudio</strong>
                        <small>analysis.R</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="env-tab-vscode"
                      aria-controls="env-panel-vscode"
                      aria-selected="false"
                      tabIndex={-1}
                      className="env-tab"
                      data-env-tab="vscode"
                    >
                      <svg className="icon icon--xs">
                        <use href="#i-grid" />
                      </svg>
                      <span>
                        <strong>VS Code</strong>
                        <small>clean_data.py</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="env-tab-terminal"
                      aria-controls="env-panel-terminal"
                      aria-selected="false"
                      tabIndex={-1}
                      className="env-tab"
                      data-env-tab="terminal"
                    >
                      <svg className="icon icon--xs">
                        <use href="#i-terminal" />
                      </svg>
                      <span>
                        <strong>Terminal</strong>
                        <small>zsh</small>
                      </span>
                    </button>
                  </div>
                  <div className="env-panes">
                    <div
                      role="tabpanel"
                      id="env-panel-jupyter"
                      aria-labelledby="env-tab-jupyter"
                      className="env-pane is-active"
                      data-env-pane="jupyter"
                    >
                      <div className="env-pane-head">
                        <span>notebooks/analysis.ipynb</span>
                        <span className="mono">PYTHON 3.12.1 · IPYKERNEL</span>
                      </div>
                      <pre className="env-code">
                        <code>
                          <span className="tok-key">import</span> pandas{" "}
                          <span className="tok-key">as</span> pd{"\n"}
                          df = pd.read_csv(<span className="tok-str">"data/tidal-2026.csv"</span>)
                          {"\n"}
                          df.groupby(<span className="tok-str">"site"</span>).salinity.describe()
                        </code>
                      </pre>
                      <div className="env-output">
                        <span className="mono">OUT</span>
                        <pre>count 120 · mean 29.7 · std 1.4 · max 33.1</pre>
                      </div>
                      <div className="env-pane-foot">
                        <span>pandas 2.2.3 · numpy 2.1.1 · matplotlib 3.9.2</span>
                        <span className="mono">KERNEL 0.4s</span>
                      </div>
                    </div>
                    <div
                      role="tabpanel"
                      id="env-panel-rstudio"
                      aria-labelledby="env-tab-rstudio"
                      className="env-pane"
                      data-env-pane="rstudio"
                      hidden
                    >
                      <div className="env-pane-head">
                        <span>analysis.R</span>
                        <span className="mono">R 4.4.1 · RENV LOCK</span>
                      </div>
                      <pre className="env-code">
                        <code>
                          <span className="tok-fn">library</span>(tidyverse){"\n"}
                          tidal {"<-"} <span className="tok-fn">read_csv</span>(
                          <span className="tok-str">"data/tidal-2026.csv"</span>){"\n"}
                          model {"<-"} <span className="tok-fn">lm</span>(salinity ~ turbidity +
                          site, data = tidal){"\n"}
                          <span className="tok-fn">summary</span>(model)
                        </code>
                      </pre>
                      <div className="env-output">
                        <span className="mono">CONSOLE</span>
                        <pre>R² 0.87 · 120 observations · residuals clean</pre>
                      </div>
                      <div className="env-pane-foot">
                        <span>tidyverse 2.0.0 · ggplot2 3.5.1 · sf 1.0-17</span>
                        <span className="mono">PLOT 0.6s</span>
                      </div>
                    </div>
                    <div
                      role="tabpanel"
                      id="env-panel-vscode"
                      aria-labelledby="env-tab-vscode"
                      className="env-pane"
                      data-env-pane="vscode"
                      hidden
                    >
                      <div className="env-pane-head">
                        <span>clean_data.py</span>
                        <span className="mono">VS CODE · PYRIGHT</span>
                      </div>
                      <div className="env-vscode">
                        <div className="env-tree" aria-label="Project files">
                          <span>
                            <svg className="icon icon--xs">
                              <use href="#i-folder" />
                            </svg>{" "}
                            data/
                          </span>
                          <span>
                            <svg className="icon icon--xs">
                              <use href="#i-folder" />
                            </svg>{" "}
                            notebooks/
                          </span>
                          <span>
                            <svg className="icon icon--xs">
                              <use href="#i-folder" />
                            </svg>{" "}
                            outputs/
                          </span>
                          <span className="is-active">
                            <svg className="icon icon--xs">
                              <use href="#i-code" />
                            </svg>{" "}
                            clean_data.py
                          </span>
                        </div>
                        <pre className="env-code env-code--editor">
                          <code>
                            <span className="tok-key">def</span>{" "}
                            <span className="tok-fn">normalize_sites</span>(frame):{"\n"}
                            {"    "}
                            <span className="tok-key">return</span>{" "}
                            frame.assign(site=frame.site.str. upper()){"\n\n"}clean =
                            normalize_sites(raw){"\n"}clean.to_csv(
                            <span className="tok-str">"outputs/clean-sites.csv"</span>, index=
                            <span className="tok-key">False</span>)
                          </code>
                        </pre>
                      </div>
                      <div className="env-output">
                        <span className="mono">TESTS</span>
                        <pre>14 passed in 2.31s · 0 warnings</pre>
                      </div>
                      <div className="env-pane-foot">
                        <span>Python extension · Ruff · Pytest · Git</span>
                        <span className="mono">14 TESTS</span>
                      </div>
                    </div>
                    <div
                      role="tabpanel"
                      id="env-panel-terminal"
                      aria-labelledby="env-tab-terminal"
                      className="env-pane"
                      data-env-pane="terminal"
                      hidden
                    >
                      <div className="env-pane-head">
                        <span>~/coastal-resilience</span>
                        <span className="mono">BASH 5.2 · 2 vCPU</span>
                      </div>
                      <pre className="env-code env-code--terminal">
                        <code>
                          <span className="env-prompt">$</span> python -m pytest
                          tests/test_cleaning.py -q{"\n"}
                          {"..............                                  [100%]\n"}
                          14 passed in 2.31s{"\n\n"}
                          <span className="env-prompt">$</span> ls outputs{"\n"}
                          recovery-map.png export_final_v3.csv
                        </code>
                      </pre>
                      <div className="env-output">
                        <span className="mono">EXIT</span>
                        <pre>0 · working tree clean · 42.8 MB in /outputs</pre>
                      </div>
                      <div className="env-pane-foot">
                        <span>bash · coreutils · git · make · jq</span>
                        <span className="mono">4 GB RAM</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="lab-section section" id="workbench" aria-labelledby="workbench-title">
            <div className="lab-split lab-split--reverse container">
              <div className="lab-demo" data-reveal>
                <div className="product-window lab-window workbench-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Workbench · coastal-resilience</span>
                    <span className="window-bar-status">
                      <i></i> 4 tools · 12 runs
                    </span>
                  </div>
                  <div className="workbench-body">
                    <div className="workbench-list" role="tablist" aria-label="Lab workbench tools">
                      <button
                        type="button"
                        role="tab"
                        id="wb-tab-tide"
                        aria-controls="wb-panel-tide"
                        aria-selected="true"
                        tabIndex={0}
                        className="workbench-item is-active"
                        data-workbench-tool="tide"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-chart" />
                        </svg>
                        <span>
                          <strong>Tide analysis</strong>
                          <small>3 runs · harmonic</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="wb-tab-survey"
                        aria-controls="wb-panel-survey"
                        aria-selected="false"
                        tabIndex={-1}
                        className="workbench-item"
                        data-workbench-tool="survey"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-grid" />
                        </svg>
                        <span>
                          <strong>Survey cleaning</strong>
                          <small>4 runs · validation</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="wb-tab-species"
                        aria-controls="wb-panel-species"
                        aria-selected="false"
                        tabIndex={-1}
                        className="workbench-item"
                        data-workbench-tool="species"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-globe" />
                        </svg>
                        <span>
                          <strong>Species map</strong>
                          <small>3 runs · raster</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="wb-tab-export"
                        aria-controls="wb-panel-export"
                        aria-selected="false"
                        tabIndex={-1}
                        className="workbench-item"
                        data-workbench-tool="export"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-arrow-down" />
                        </svg>
                        <span>
                          <strong>Export results</strong>
                          <small>2 runs · archive</small>
                        </span>
                      </button>
                    </div>
                    <div className="workbench-main">
                      <div
                        role="tabpanel"
                        id="wb-panel-tide"
                        aria-labelledby="wb-tab-tide"
                        className="workbench-pane is-active"
                        data-workbench-pane="tide"
                        data-workbench-duration="1.8"
                      >
                        <div className="workbench-pane-head">
                          <div>
                            <strong>Tide analysis</strong>
                            <span>Harmonic decomposition over a sliding window.</span>
                          </div>
                          <span className="mono">tide-analysis</span>
                        </div>
                        <div className="workbench-params">
                          <div className="workbench-param">
                            <span>Dataset</span>
                            <strong>tidal-2026.csv</strong>
                            <em className="mono">select</em>
                          </div>
                          <div className="workbench-param">
                            <span>Analysis window</span>
                            <strong>14 days</strong>
                            <em className="mono">slider 1–30</em>
                          </div>
                          <div className="workbench-param">
                            <span>Remove linear trend</span>
                            <strong>on</strong>
                            <em className="mono">checkbox</em>
                          </div>
                        </div>
                        <div className="workbench-actions">
                          <button
                            type="button"
                            className="lab-run-btn lab-run-btn--sm"
                            data-workbench-run
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-play" />
                            </svg>{" "}
                            Run tool
                          </button>
                          <span className="workbench-status" data-workbench-status>
                            Ready · parameters valid
                          </span>
                        </div>
                        <div className="workbench-history" aria-live="polite">
                          <div className="workbench-history-head">
                            <span>Run history</span>
                            <span className="mono">3 RUNS · SAVED TO PROJECT</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>18 Nov · 16:24</span>
                            <span>14 d · detrend on</span>
                            <span className="mono">1.8 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>17 Nov · 09:12</span>
                            <span>14 d · detrend off</span>
                            <span className="mono">1.7 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>15 Nov · 14:03</span>
                            <span>7 d · detrend on</span>
                            <span className="mono">1.4 s</span>
                          </div>
                        </div>
                      </div>
                      <div
                        role="tabpanel"
                        id="wb-panel-survey"
                        aria-labelledby="wb-tab-survey"
                        className="workbench-pane"
                        data-workbench-pane="survey"
                        data-workbench-duration="2.3"
                        hidden
                      >
                        <div className="workbench-pane-head">
                          <div>
                            <strong>Survey data cleaning</strong>
                            <span>Validate an export and flag low-confidence records.</span>
                          </div>
                          <span className="mono">survey-clean</span>
                        </div>
                        <div className="workbench-params">
                          <div className="workbench-param">
                            <span>Input file</span>
                            <strong>data/survey-export.csv</strong>
                            <em className="mono">text · required</em>
                          </div>
                          <div className="workbench-param">
                            <span>Minimum confidence</span>
                            <strong>60%</strong>
                            <em className="mono">slider 0–100</em>
                          </div>
                          <div className="workbench-param">
                            <span>Drop empty rows</span>
                            <strong>yes</strong>
                            <em className="mono">checkbox</em>
                          </div>
                        </div>
                        <div className="workbench-actions">
                          <button
                            type="button"
                            className="lab-run-btn lab-run-btn--sm"
                            data-workbench-run
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-play" />
                            </svg>{" "}
                            Run tool
                          </button>
                          <span className="workbench-status" data-workbench-status>
                            Ready · parameters valid
                          </span>
                        </div>
                        <div className="workbench-history" aria-live="polite">
                          <div className="workbench-history-head">
                            <span>Run history</span>
                            <span className="mono">4 RUNS · SAVED TO PROJECT</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>19 Nov · 11:40</span>
                            <span>1,284 kept · 37 dropped</span>
                            <span className="mono">2.3 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>16 Nov · 08:51</span>
                            <span>1,302 kept · 19 dropped</span>
                            <span className="mono">2.1 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-failed">failed</span>
                            <span>14 Nov · 17:22</span>
                            <span>missing reading column</span>
                            <span className="mono">0.4 s</span>
                          </div>
                        </div>
                      </div>
                      <div
                        role="tabpanel"
                        id="wb-panel-species"
                        aria-labelledby="wb-tab-species"
                        className="workbench-pane"
                        data-workbench-pane="species"
                        data-workbench-duration="6.4"
                        hidden
                      >
                        <div className="workbench-pane-head">
                          <div>
                            <strong>Species distribution map</strong>
                            <span>Rasterize occurrence records onto a coastal grid.</span>
                          </div>
                          <span className="mono">species-map</span>
                        </div>
                        <div className="workbench-params">
                          <div className="workbench-param">
                            <span>Species</span>
                            <strong>Larus argentatus</strong>
                            <em className="mono">text · required</em>
                          </div>
                          <div className="workbench-param">
                            <span>Grid resolution</span>
                            <strong>1 km</strong>
                            <em className="mono">select</em>
                          </div>
                          <div className="workbench-param">
                            <span>Coastal buffer</span>
                            <strong>10 km</strong>
                            <em className="mono">slider 0–50</em>
                          </div>
                        </div>
                        <div className="workbench-actions">
                          <button
                            type="button"
                            className="lab-run-btn lab-run-btn--sm"
                            data-workbench-run
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-play" />
                            </svg>{" "}
                            Run tool
                          </button>
                          <span className="workbench-status" data-workbench-status>
                            Ready · parameters valid
                          </span>
                        </div>
                        <div className="workbench-history" aria-live="polite">
                          <div className="workbench-history-head">
                            <span>Run history</span>
                            <span className="mono">3 RUNS · SAVED TO PROJECT</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>16 Nov · 17:05</span>
                            <span>214 cells · 61 occupied</span>
                            <span className="mono">6.4 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>15 Nov · 14:22</span>
                            <span>214 cells · 58 occupied</span>
                            <span className="mono">6.1 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>12 Nov · 10:04</span>
                            <span>856 cells · 203 occupied</span>
                            <span className="mono">6.8 s</span>
                          </div>
                        </div>
                      </div>
                      <div
                        role="tabpanel"
                        id="wb-panel-export"
                        aria-labelledby="wb-tab-export"
                        className="workbench-pane"
                        data-workbench-pane="export"
                        data-workbench-duration="0.9"
                        hidden
                      >
                        <div className="workbench-pane-head">
                          <div>
                            <strong>Export results</strong>
                            <span>Package the latest outputs into a downloadable archive.</span>
                          </div>
                          <span className="mono">export-results</span>
                        </div>
                        <div className="workbench-params">
                          <div className="workbench-param">
                            <span>Format</span>
                            <strong>CSV</strong>
                            <em className="mono">select · required</em>
                          </div>
                          <div className="workbench-param">
                            <span>Compression</span>
                            <strong>gzip</strong>
                            <em className="mono">select</em>
                          </div>
                          <div className="workbench-param">
                            <span>Include run metadata</span>
                            <strong>on</strong>
                            <em className="mono">checkbox</em>
                          </div>
                        </div>
                        <div className="workbench-actions">
                          <button
                            type="button"
                            className="lab-run-btn lab-run-btn--sm"
                            data-workbench-run
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-play" />
                            </svg>{" "}
                            Run tool
                          </button>
                          <span className="workbench-status" data-workbench-status>
                            Ready · parameters valid
                          </span>
                        </div>
                        <div className="workbench-history" aria-live="polite">
                          <div className="workbench-history-head">
                            <span>Run history</span>
                            <span className="mono">2 RUNS · SAVED TO PROJECT</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>18 Nov · 16:40</span>
                            <span>CSV · gzip · 42.8 MB</span>
                            <span className="mono">0.9 s</span>
                          </div>
                          <div className="workbench-run">
                            <span className="workbench-badge is-completed">completed</span>
                            <span>12 Nov · 11:30</span>
                            <span>Parquet · zstd · 38.1 MB</span>
                            <span className="mono">1.1 s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lab-copy" data-reveal data-reveal-delay="100">
                <div className="lab-index">
                  <span>13</span>
                  <i></i> REPEATABLE TOOLS
                </div>
                <h2 id="workbench-title" className="section-title">
                  Parameterized tools, not one-off scripts.
                </h2>
                <p className="section-desc">
                  Some analyses should never be retyped. The Workbench turns a script into a tool
                  with named parameters, defaults, and validation. Pick a tool, fill in the inputs,
                  and every run lands in the project history with those exact inputs attached.
                </p>
                <ul className="lab-feature-list">
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Typed parameters</strong>
                      <small>Text, numbers, sliders, selects, and flags with bounds</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Run history with inputs</strong>
                      <small>Re-run an old tool call with one click, or diff the outputs</small>
                    </span>
                  </li>
                  <li>
                    <span className="lab-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Callable from anywhere</strong>
                      <small>Ask the agent, click run, or schedule it as a cron job</small>
                    </span>
                  </li>
                </ul>
                <div className="lab-tech-note">
                  <div className="tech-note-head">
                    <svg className="icon icon--xs">
                      <use href="#i-bolt" />
                    </svg>{" "}
                    WHY PARAMETERS
                  </div>
                  <p>
                    A parameterized tool is a small contract: the inputs are validated before the
                    run starts, so a failed job is a bad file or a real bug — not a typo in a path.
                  </p>
                </div>
                <div className="lab-chips">
                  <span>Tool runner</span>
                  <span>Parameter schemas</span>
                  <span>Run history</span>
                  <span>Cron</span>
                </div>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="snapshots"
            aria-labelledby="snapshots-title"
          >
            <div className="container">
              <div className="lab-section-head" data-reveal>
                <div className="lab-index">
                  <span>14</span>
                  <i></i> REPRODUCIBILITY
                </div>
                <h2 id="snapshots-title" className="section-title">
                  Every run leaves a state you can return to.
                </h2>
                <p className="section-desc lab-section-desc">
                  A snapshot captures the whole workspace — files, kernel state, environment, and
                  the rendered surface. Mark one as the baseline, capture the same screen in
                  Chromium, Firefox, and WebKit, and review the pixel diff before it becomes the new
                  reference.
                </p>
              </div>
              <div className="snap-layout">
                <div className="product-window lab-window snap-window" data-reveal>
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">Snapshots · coastal-resilience</span>
                    <span className="window-bar-status">
                      <i></i> 7 captures · 4 environments
                    </span>
                  </div>
                  <div className="snap-toolbar">
                    <div className="snap-filters" role="group" aria-label="Filter snapshots">
                      <button
                        type="button"
                        className="snap-filter is-active"
                        data-snap-filter="all"
                      >
                        All <span>7</span>
                      </button>
                      <button type="button" className="snap-filter" data-snap-filter="rstudio">
                        RStudio <span>2</span>
                      </button>
                      <button type="button" className="snap-filter" data-snap-filter="jupyter">
                        JupyterLab <span>2</span>
                      </button>
                      <button type="button" className="snap-filter" data-snap-filter="vscode">
                        VS Code <span>2</span>
                      </button>
                      <button type="button" className="snap-filter" data-snap-filter="terminal">
                        Terminal <span>1</span>
                      </button>
                    </div>
                    <span className="mono snap-count" data-snap-count>
                      7 captures
                    </span>
                  </div>
                  <div className="snap-table" role="table" aria-label="Lab snapshots">
                    <div className="snap-row snap-row--head" role="row">
                      <span role="columnheader">Snapshot</span>
                      <span role="columnheader">Environment</span>
                      <span role="columnheader">Size</span>
                      <span role="columnheader">Captured</span>
                      <span role="columnheader">Diff</span>
                      <span role="columnheader">Status</span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="rstudio">
                      <span role="cell" className="snap-name">
                        Pre-analysis baseline <em className="snap-baseline">baseline</em>
                      </span>
                      <span role="cell">RStudio</span>
                      <span role="cell" className="mono">
                        48 MB
                      </span>
                      <span role="cell">18 Nov</span>
                      <span role="cell" className="mono">
                        0.0%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-approved">approved</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="jupyter">
                      <span role="cell" className="snap-name">
                        Clean survey inputs
                      </span>
                      <span role="cell">JupyterLab</span>
                      <span role="cell" className="mono">
                        132 MB
                      </span>
                      <span role="cell">17 Nov</span>
                      <span role="cell" className="mono">
                        0.4%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-pending">pending</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="vscode">
                      <span role="cell" className="snap-name">
                        Species grid v2
                      </span>
                      <span role="cell">VS Code</span>
                      <span role="cell" className="mono">
                        96 MB
                      </span>
                      <span role="cell">15 Nov</span>
                      <span role="cell" className="mono">
                        0.8%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-approved">approved</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="terminal">
                      <span role="cell" className="snap-name">
                        Export bundle
                      </span>
                      <span role="cell">Terminal</span>
                      <span role="cell" className="mono">
                        12 MB
                      </span>
                      <span role="cell">12 Nov</span>
                      <span role="cell" className="mono">
                        2.1%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-rejected">rejected</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="rstudio">
                      <span role="cell" className="snap-name">
                        Post-review state
                      </span>
                      <span role="cell">RStudio</span>
                      <span role="cell" className="mono">
                        51 MB
                      </span>
                      <span role="cell">19 Nov</span>
                      <span role="cell" className="mono">
                        1.2%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-pending">pending</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="jupyter">
                      <span role="cell" className="snap-name">
                        Raw survey dump
                      </span>
                      <span role="cell">JupyterLab</span>
                      <span role="cell" className="mono">
                        118 MB
                      </span>
                      <span role="cell">16 Nov</span>
                      <span role="cell" className="mono">
                        0.6%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-approved">approved</span>
                      </span>
                    </div>
                    <div className="snap-row" role="row" data-snap-env="vscode">
                      <span role="cell" className="snap-name">
                        Species grid v3
                      </span>
                      <span role="cell">VS Code</span>
                      <span role="cell" className="mono">
                        104 MB
                      </span>
                      <span role="cell">16 Nov</span>
                      <span role="cell" className="mono">
                        1.7%
                      </span>
                      <span role="cell">
                        <span className="snap-badge is-pending">pending</span>
                      </span>
                    </div>
                  </div>
                  <div className="snap-foot">
                    <span className="mono">FILTER BY ENVIRONMENT</span>
                    <span>Snapshots are read-only until cloned</span>
                  </div>
                </div>
                <aside className="snap-side" data-reveal data-reveal-delay="100">
                  <div className="snap-card">
                    <div className="snap-card-head">
                      <span className="mono">BROWSER MATRIX</span>
                      <span>vs. Chromium</span>
                    </div>
                    <div className="snap-browser">
                      <div className="snap-browser-row">
                        <span>Chromium · reference</span>
                        <span className="snap-browser-track">
                          <i style={{ "--w": "4%" } as CSSProperties}></i>
                        </span>
                        <span className="mono">0.0%</span>
                      </div>
                      <div className="snap-browser-row">
                        <span>Firefox · Gecko</span>
                        <span className="snap-browser-track">
                          <i style={{ "--w": "32%" } as CSSProperties}></i>
                        </span>
                        <span className="mono">0.4%</span>
                      </div>
                      <div className="snap-browser-row">
                        <span>WebKit · Safari</span>
                        <span className="snap-browser-track">
                          <i style={{ "--w": "78%" } as CSSProperties}></i>
                        </span>
                        <span className="mono">1.7%</span>
                      </div>
                    </div>
                    <p className="snap-card-note">
                      One shared seed, three real engines. Only rendering drift differs, so the diff
                      measures the browser — not the data.
                    </p>
                  </div>
                  <div className="snap-card">
                    <div className="snap-card-head">
                      <span className="mono">BASELINE</span>
                      <span className="mono">SNAP-01</span>
                    </div>
                    <strong className="snap-card-title">Pre-analysis baseline</strong>
                    <p className="snap-card-note">
                      Promoted 18 Nov by Mara. Every other capture is diffed against it until a new
                      baseline is approved.
                    </p>
                    <div className="snap-card-meta">
                      <span>Approval</span>
                      <span className="snap-badge is-approved">approved</span>
                    </div>
                  </div>
                  <div className="snap-card">
                    <div className="snap-card-head">
                      <span className="mono">SHARE</span>
                      <span className="mono">/s/snap-01</span>
                    </div>
                    <p className="snap-card-note">
                      Send a read-only link to the exact workspace. Teammates can clone it, diff it,
                      or open it in any environment. Access follows project permissions.
                    </p>
                  </div>
                </aside>
              </div>
              <div className="lab-feature-row">
                <article className="lab-feature-card" data-reveal>
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-cube" />
                    </svg>
                  </span>
                  <h3>Capture</h3>
                  <p>
                    Files, installed packages, kernel state, and the visible surface are stored
                    together, so a restore lands exactly where the run did.
                  </p>
                </article>
                <article className="lab-feature-card" data-reveal data-reveal-delay="60">
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-layers" />
                    </svg>
                  </span>
                  <h3>Compare</h3>
                  <p>
                    Diff two snapshots by file, output, or pixels. Promote a capture to the new
                    baseline only after a reviewer approves it.
                  </p>
                </article>
                <article className="lab-feature-card" data-reveal data-reveal-delay="120">
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-shield" />
                    </svg>
                  </span>
                  <h3>Return</h3>
                  <p>
                    Clone a snapshot into a fresh session, restore in place, or hand the share link
                    to a collaborator. Nothing is ever applied silently.
                  </p>
                </article>
              </div>
              <p className="lab-inline-note">
                Backed by the same snapshot browser used in the product. The page previews the
                review flow; it does not capture your browser.
              </p>
            </div>
          </section>
          <section
            className="lab-section section"
            id="benchmarks"
            aria-labelledby="benchmarks-title"
          >
            <div className="container">
              <div className="lab-section-head" data-reveal>
                <div className="lab-index">
                  <span>15</span>
                  <i></i> PERFORMANCE
                </div>
                <h2 id="benchmarks-title" className="section-title">
                  Know what a snapshot costs to open.
                </h2>
                <p className="section-desc lab-section-desc">
                  The benchmark panel times every capture — environment render and screenshot encode
                  — and keeps the history beside the snapshot. Compare a large Parquet view against
                  a small export bundle, or watch a new baseline move the median.
                </p>
              </div>
              <div className="bench-stats">
                <div className="bench-stat" data-reveal>
                  <span className="mono">MEDIAN OPEN</span>
                  <strong>310 ms</strong>
                  <small>Across 7 captures</small>
                </div>
                <div className="bench-stat" data-reveal data-reveal-delay="50">
                  <span className="mono">FASTEST</span>
                  <strong>199 ms</strong>
                  <small>Export bundle · 12 MB</small>
                </div>
                <div className="bench-stat" data-reveal data-reveal-delay="100">
                  <span className="mono">SLOWEST</span>
                  <strong>356 ms</strong>
                  <small>Clean survey inputs · 132 MB</small>
                </div>
                <div className="bench-stat" data-reveal data-reveal-delay="150">
                  <span className="mono">RUNS KEPT</span>
                  <strong>35</strong>
                  <small>5 per snapshot · newest first</small>
                </div>
              </div>
              <div className="product-window lab-window bench-window" data-reveal>
                <div className="window-bar">
                  <div className="traffic-lights" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <span className="window-bar-title">
                    Benchmark history · latest run per snapshot
                  </span>
                  <span className="window-bar-status">
                    <i></i> Chromium reference
                  </span>
                </div>
                <div className="bench-table" role="table" aria-label="Lab benchmark results">
                  <div className="bench-row bench-row--head" role="row">
                    <span role="columnheader">Snapshot</span>
                    <span role="columnheader">Environment</span>
                    <span role="columnheader">Size</span>
                    <span role="columnheader">Render</span>
                    <span role="columnheader">Capture</span>
                    <span role="columnheader">Total</span>
                    <span role="columnheader">0–400 ms</span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Pre-analysis baseline</span>
                    <span role="cell">RStudio</span>
                    <span role="cell" className="mono">
                      48 MB
                    </span>
                    <span role="cell" className="mono">
                      214 ms
                    </span>
                    <span role="cell" className="mono">
                      71 ms
                    </span>
                    <span role="cell" className="mono">
                      285 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "71%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Clean survey inputs</span>
                    <span role="cell">JupyterLab</span>
                    <span role="cell" className="mono">
                      132 MB
                    </span>
                    <span role="cell" className="mono">
                      268 ms
                    </span>
                    <span role="cell" className="mono">
                      88 ms
                    </span>
                    <span role="cell" className="mono">
                      356 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "89%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Species grid v2</span>
                    <span role="cell">VS Code</span>
                    <span role="cell" className="mono">
                      96 MB
                    </span>
                    <span role="cell" className="mono">
                      231 ms
                    </span>
                    <span role="cell" className="mono">
                      79 ms
                    </span>
                    <span role="cell" className="mono">
                      310 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "78%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Export bundle</span>
                    <span role="cell">Terminal</span>
                    <span role="cell" className="mono">
                      12 MB
                    </span>
                    <span role="cell" className="mono">
                      147 ms
                    </span>
                    <span role="cell" className="mono">
                      52 ms
                    </span>
                    <span role="cell" className="mono">
                      199 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "50%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Post-review state</span>
                    <span role="cell">RStudio</span>
                    <span role="cell" className="mono">
                      51 MB
                    </span>
                    <span role="cell" className="mono">
                      219 ms
                    </span>
                    <span role="cell" className="mono">
                      74 ms
                    </span>
                    <span role="cell" className="mono">
                      293 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "73%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Raw survey dump</span>
                    <span role="cell">JupyterLab</span>
                    <span role="cell" className="mono">
                      118 MB
                    </span>
                    <span role="cell" className="mono">
                      251 ms
                    </span>
                    <span role="cell" className="mono">
                      84 ms
                    </span>
                    <span role="cell" className="mono">
                      335 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "84%" } as CSSProperties}></i>
                    </span>
                  </div>
                  <div className="bench-row" role="row">
                    <span role="cell">Species grid v3</span>
                    <span role="cell">VS Code</span>
                    <span role="cell" className="mono">
                      104 MB
                    </span>
                    <span role="cell" className="mono">
                      238 ms
                    </span>
                    <span role="cell" className="mono">
                      81 ms
                    </span>
                    <span role="cell" className="mono">
                      319 ms
                    </span>
                    <span role="cell" className="bench-bar-cell">
                      <i style={{ "--w": "80%" } as CSSProperties}></i>
                    </span>
                  </div>
                </div>
                <div className="bench-foot">
                  <span className="mono">RENDER + CAPTURE = TOTAL</span>
                  <span>History is deterministic: the same snapshot and browser always match</span>
                </div>
              </div>
              <div className="lab-feature-row">
                <article className="lab-feature-card" data-reveal>
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-clock" />
                    </svg>
                  </span>
                  <h3>Every capture is timed</h3>
                  <p>
                    Render and encode are recorded separately, so a slow environment is not mistaken
                    for a slow screenshot pipeline.
                  </p>
                </article>
                <article className="lab-feature-card" data-reveal data-reveal-delay="60">
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-chart" />
                    </svg>
                  </span>
                  <h3>History, not a single number</h3>
                  <p>
                    Five runs are kept per snapshot. A regression reads as a trend instead of a
                    noisy one-off measurement.
                  </p>
                </article>
                <article className="lab-feature-card" data-reveal data-reveal-delay="120">
                  <span className="lab-feature-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-layers" />
                    </svg>
                  </span>
                  <h3>Comparable across browsers</h3>
                  <p>
                    The same benchmark runs against Chromium, Firefox, and WebKit captures, so
                    engine-specific costs are visible before review.
                  </p>
                </article>
              </div>
            </div>
          </section>
          <section
            className="lab-section section lab-section--alt"
            id="faq"
            aria-labelledby="faq-title"
          >
            <div className="lab-faq-wrap container">
              <div className="lab-section-head" data-reveal>
                <div className="lab-index">
                  <span>16</span>
                  <i></i> QUESTIONS
                </div>
                <h2 id="faq-title" className="section-title">
                  What people ask before their first run.
                </h2>
                <p className="section-desc lab-section-desc">
                  Short answers to the things that decide whether the Lab fits your project. If
                  something is missing, the help centre goes deeper.
                </p>
              </div>
              <div className="lab-faq-list" data-reveal>
                <details className="lab-faq-item">
                  <summary>
                    Do the Lab tools run locally or on your servers?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Both, by design. duckdb-wasm queries, the Canvas, Desmos, the math engine, and
                      the Visualizer run inside your browser. Python and R need a real kernel, so
                      they run on shared compute with your project mounted read-write — only when
                      you start a session. The file never has to be uploaded to the compute host.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    What happens to my session when I close the tab?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      The session stays warm for 10 minutes after the last edit. If you come back
                      inside that window, the kernel and environment are intact. After that, the
                      workspace is snapshotted and the kernel stops; reopening restores the files
                      and the last visible state.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    How much compute does a session get?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Each session starts with 2 vCPU and 4 GB of RAM on a fair-share pool. That is
                      enough for the notebooks, R sessions, and Parquet queries shown here. Long
                      jobs are better run through the Script Runner or a Workbench tool, where the
                      run history and time limits are explicit.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Can I install packages?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Yes. pip and install.packages write into the project&apos;s package snapshot,
                      so an install is cached for every later session. If a package needs a system
                      library, add it to the project environment definition or ask the agent to
                      resolve it.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Are project secrets available inside a notebook?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Project environment variables are injected at run time and redacted from logs,
                      notebook outputs, and snapshots. They are never written into an exported file
                      or a shared view. If a cell prints one, the value is replaced before the
                      output is stored.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Can I share a run or a snapshot?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Snapshots and Workbench runs have read-only links. A teammate can open the
                      exact workspace, clone it into a new session, or diff it against the baseline.
                      Access follows the project&apos;s permissions, so a link never grants more
                      than the project already does.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Which languages and versions are available?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Python 3.12 with the scientific stack, R 4.4 with tidyverse and renv, Node 22,
                      and bash. SQL runs through duckdb-wasm. The exact package versions are pinned
                      per project, so a reopened notebook resolves the same environment it did
                      before.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Does the Lab work offline?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Browser-only tools keep working after the page has loaded, including SQL over
                      already-open local files, Canvas, Desmos, the math engine, and the Visualizer.
                      Python and R sessions need the shared runtime, so they pause while you are
                      offline and resume when the connection returns.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    Can the agent and scheduled jobs use the Lab?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Yes. Workbench tools are callable from the agent, from a cron schedule, and
                      from the command menu. Each invocation records its parameters and output, so a
                      scheduled run and a manual run are directly comparable.
                    </p>
                  </div>
                </details>
                <details className="lab-faq-item">
                  <summary>
                    What is not allowed on the shared compute?
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </summary>
                  <div className="lab-faq-answer">
                    <p>
                      Mining crypto, attempting to escape a sandbox, and running workloads unrelated
                      to the project are prohibited by the{" "}
                      <a href="/acceptable-use">Acceptable Use Policy</a>. The Lab is for project
                      analysis, not general-purpose hosting.
                    </p>
                  </div>
                </details>
              </div>
              <p className="lab-faq-more" data-reveal>
                Still deciding? <a href="/pricing">Compare plans</a>, read the{" "}
                <a href="/help">help centre</a>, or <a href="/contact">ask us directly</a>.
              </p>
            </div>
          </section>
          <section
            className="lab-quickstart section"
            id="quick-start"
            aria-labelledby="quickstart-title"
          >
            <div className="container">
              <div className="lab-quickstart-box" data-reveal>
                <div className="lab-index">
                  <span>17</span>
                  <i></i> QUICK START
                </div>
                <h2 id="quickstart-title">Open it from wherever you already are.</h2>
                <p className="lab-quickstart-sub">
                  There is no separate setup step. The Lab is attached to every project, and the
                  agent can put you inside it.
                </p>
                <div className="quickstart-grid">
                  <article className="quickstart-card">
                    <span className="quickstart-num">01</span>
                    <h3>From the command menu</h3>
                    <p>Press the menu shortcut, type “Lab”, and pick the surface you want.</p>
                    <kbd>⌘ K</kbd>
                  </article>
                  <article className="quickstart-card">
                    <span className="quickstart-num">02</span>
                    <h3>From a project file</h3>
                    <p>
                      Right-click a <code>.csv</code>, <code>.ipynb</code>, or <code>.R</code> file
                      and choose “Open in Lab”. It opens with the file already loaded.
                    </p>
                    <kbd>Right-click</kbd>
                  </article>
                  <article className="quickstart-card">
                    <span className="quickstart-num">03</span>
                    <h3>From the agent</h3>
                    <p>
                      Ask for a notebook, a tool run, or a snapshot. The run appears in the Lab
                      history with its parameters and outputs.
                    </p>
                    <kbd>Ask</kbd>
                  </article>
                </div>
                <div className="quickstart-keys">
                  <div className="quickstart-keys-head">
                    <span className="mono">INSIDE THE LAB</span>
                    <span>Mac shortcuts · Ctrl on Windows and Linux</span>
                  </div>
                  <dl className="quickstart-key-list">
                    <div>
                      <dt>Run cell</dt>
                      <dd>
                        <kbd>⌘</kbd> <kbd>Enter</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>Run cell and advance</dt>
                      <dd>
                        <kbd>⇧</kbd> <kbd>Enter</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>Save snapshot</dt>
                      <dd>
                        <kbd>⌘</kbd> <kbd>S</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>Command palette</dt>
                      <dd>
                        <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>P</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>Restart kernel</dt>
                      <dd>
                        <kbd>⌥</kbd> <kbd>R</kbd>
                      </dd>
                    </div>
                    <div>
                      <dt>Interrupt kernel</dt>
                      <dd>
                        <kbd>⌘</kbd> <kbd>.</kbd>
                      </dd>
                    </div>
                  </dl>
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
                  Notebooks, R, scripts, SQL on duckdb-wasm, Excalidraw, Desmos, symbolic math, file
                  views, four full environments, reproducible tool runs, and snapshot baselines —
                  one Lab tab in every project.
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
