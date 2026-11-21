import "../../styles/agent.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { AgentFaq } from "@/components/site/agent-faq"

export const metadata = createPageMetadata({
  title: "Agent — Spindle",
  description:
    "Spindle's agent reads your project, edits files in place, moves and reorganizes them, and runs multi-step tasks autonomously — every change arrives as a reviewable diff.",
  path: "/agent",
})

export default function AgentPage() {
  return (
    <PageTransition>
      <div className="agent-page">
        <main id="top" tabIndex={-1}>
          <section className="agent-hero">
            <div className="agent-hero-grid-bg" aria-hidden="true"></div>
            <div className="agent-hero-glow" aria-hidden="true"></div>
            <div className="agent-hero-inner container">
              <div className="agent-hero-copy" data-reveal>
                <div className="agent-kicker">
                  <i aria-hidden="true"></i> AGENT · INCLUDED ON THE FREE PLAN
                </div>
                <h1>
                  An agent that
                  <br />
                  <span>works the project.</span>
                </h1>
                <p className="agent-subtitle">
                  {" "}
                  It reads your files, edits them in place, moves them where they belong, and keeps
                  going until the task is finished. Every change arrives as a diff you can review,
                  approve, or throw away.{" "}
                </p>
                <div className="agent-hero-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Start with 20 requests a day{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="#capabilities" className="btn btn--ghost btn--lg">
                    See what it can do
                  </a>
                </div>
                <div className="agent-hero-foot">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Edits files, not just chat
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Autonomous multi-step runs
                  </span>
                </div>
              </div>
              <div className="agent-hero-visual" data-reveal data-reveal-delay="100">
                <div className="visual-halo" aria-hidden="true"></div>
                <div className="product-window agent-window agent-window--hero">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">
                      <svg className="icon icon--xs">
                        <use href="#i-sparkle" />
                      </svg>{" "}
                      Agent · coastal-resilience
                    </span>
                    <span className="window-bar-status">
                      <i></i> 14 / 20 left
                    </span>
                  </div>
                  <div className="agent-body">
                    <div className="agent-prompt-label">REQUEST</div>
                    <div className="agent-prompt" id="agentPrompt">
                      Move the 2026 field data into /data/2026, rename the exports, and fix every
                      notebook path.
                    </div>
                    <div
                      className="agent-suggestions"
                      role="group"
                      aria-label="Example agent requests"
                    >
                      <button className="suggestion is-active" data-agent-example="moveFiles">
                        Reorganize files
                      </button>
                      <button className="suggestion" data-agent-example="refactor">
                        Refactor a pipeline
                      </button>
                      <button className="suggestion" data-agent-example="spreadsheet">
                        Edit a spreadsheet
                      </button>
                    </div>
                    <div className="agent-trace" id="agentTrace">
                      <div className="trace-row is-done">
                        <span className="trace-icon">
                          <svg className="icon icon--xs">
                            <use href="#i-check" />
                          </svg>
                        </span>
                        <span>Scan 34 files and 2 notebooks for references</span>
                        <time>0.5s</time>
                      </div>
                      <div className="trace-row is-done">
                        <span className="trace-icon">
                          <svg className="icon icon--xs">
                            <use href="#i-check" />
                          </svg>
                        </span>
                        <span>
                          Create <strong>/data/2026</strong> and move 12 files into it
                        </span>
                        <time>1.6s</time>
                      </div>
                      <div className="trace-row is-running">
                        <span className="trace-icon">
                          <span className="trace-pulse"></span>
                        </span>
                        <span>
                          Rewriting 8 paths in <strong>analysis.ipynb</strong>
                        </span>
                        <time>2.9s</time>
                      </div>
                      <div className="trace-row">
                        <span className="trace-icon trace-icon--empty"></span>
                        <span>Report the changes to the project log</span>
                        <time>—</time>
                      </div>
                    </div>
                    <div className="agent-diff">
                      <span>
                        <i className="diff-add"></i> 12 files moved
                      </span>
                      <span>
                        <i className="diff-del"></i> 8 paths repaired
                      </span>
                      <span className="agent-diff-note">Nothing applied until you review</span>
                    </div>
                  </div>
                  <div className="agent-run-foot">
                    <span className="mono">RUNNING · 00:12</span>
                    <span>Step 3 of 4 · working autonomously</span>
                  </div>
                </div>
                <div className="floating-note agent-float" aria-hidden="true">
                  <span className="note-icon">
                    <svg className="icon icon--xs">
                      <use href="#i-sparkle" />
                    </svg>
                  </span>
                  <span>
                    <strong>+50 requests</strong>
                    <small>for each referral · never expire</small>
                  </span>
                </div>
              </div>
            </div>
          </section>
          <section className="section" id="capabilities">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">What it can do</div>
                <h2 className="section-title">More than a chat window.</h2>
                <p className="section-desc">
                  The agent has the same access to the project that you do: the file tree, the
                  notebooks, the lab, and the notes. That is what lets it finish the work instead of
                  describing it.
                </p>
              </div>
              <div className="agent-cap-grid">
                <article className="agent-cap" data-reveal>
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-code" />
                    </svg>
                  </span>
                  <h3>Edit files in place</h3>
                  <p>
                    Open a CSV, a notebook, a script, or a note and change it where it lives — no
                    copy-paste round trip, no lost formatting, no final_v7.
                  </p>
                  <span className="agent-cap-meta">CSV · XLSX · IPYNB · MD</span>
                </article>
                <article className="agent-cap" data-reveal data-reveal-delay="60">
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-folder" />
                    </svg>
                  </span>
                  <h3>Move and reorganize</h3>
                  <p>
                    Create folders, move files, rename exports, and repair the notebook paths and
                    references that pointed at them.
                  </p>
                  <span className="agent-cap-meta">MOVE · RENAME · REPOINT</span>
                </article>
                <article className="agent-cap" data-reveal data-reveal-delay="120">
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <h3>Work autonomously</h3>
                  <p>
                    Give it an outcome, not a checklist. It plans the steps, runs them in order,
                    checks its own output, and continues without you.
                  </p>
                  <span className="agent-cap-meta">PLAN · ACT · VERIFY</span>
                </article>
                <article className="agent-cap" data-reveal>
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-search" />
                    </svg>
                  </span>
                  <h3>Read the whole project</h3>
                  <p>
                    File tree, notes, sources, and recent project activity are all in scope, so it
                    stops guessing where things live.
                  </p>
                  <span className="agent-cap-meta">PROJECT CONTEXT</span>
                </article>
                <article className="agent-cap" data-reveal data-reveal-delay="60">
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-flask" />
                    </svg>
                  </span>
                  <h3>Run the lab</h3>
                  <p>
                    Execute a script or a notebook cell, read the result, and feed it into the next
                    step of the task — then show you what ran.
                  </p>
                  <span className="agent-cap-meta">PYTHON · R · SHELL</span>
                </article>
                <article className="agent-cap" data-reveal data-reveal-delay="120">
                  <span className="agent-cap-icon">
                    <svg className="icon">
                      <use href="#i-shield" />
                    </svg>
                  </span>
                  <h3>Stop for review</h3>
                  <p>
                    Every change lands as a diff. Approve it, adjust it, or roll it back — nothing
                    is applied behind your back.
                  </p>
                  <span className="agent-cap-meta">DIFF · APPROVE · UNDO</span>
                </article>
              </div>
            </div>
          </section>
          <section className="section section--alt" id="organize">
            <div className="container">
              <div className="agent-split">
                <div className="agent-split-copy" data-reveal>
                  <div className="eyebrow">Files, not screenshots</div>
                  <h2 className="section-title">It edits files. It moves them around.</h2>
                  <p className="section-desc">
                    This is not a chatbot telling you what you could do. The agent works inside the
                    project: opens the file, makes the change, puts it back, and tells you exactly
                    what moved.
                  </p>
                  <ul className="feature-list">
                    <li>
                      <span className="feature-check">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        <strong>Edits in place</strong>
                        <small>Keeps the format, encoding, and column order of the original.</small>
                      </span>
                    </li>
                    <li>
                      <span className="feature-check">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        <strong>Moves without breaking links</strong>
                        <small>
                          Renames an export and updates every notebook that referenced it.
                        </small>
                      </span>
                    </li>
                    <li>
                      <span className="feature-check">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        <strong>A real file tree</strong>
                        <small>
                          New folders, archived versions, cleaned duplicates — in the project you
                          already have.
                        </small>
                      </span>
                    </li>
                  </ul>
                  <a href="#requests" className="text-link">
                    See what a request covers{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                </div>
                <div
                  className="product-window agent-tree-window"
                  data-reveal
                  data-reveal-delay="100"
                >
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">
                      <svg className="icon icon--xs">
                        <use href="#i-folder" />
                      </svg>{" "}
                      coastal-resilience / files
                    </span>
                    <span className="window-bar-status">
                      <i></i> 12 files moved
                    </span>
                  </div>
                  <div className="agent-tree-body">
                    <div className="agent-tree-col">
                      <span className="agent-tree-label">BEFORE</span>
                      <div className="agent-file agent-file--folder">
                        <svg className="icon">
                          <use href="#i-chevron-down" />
                        </svg>
                        <span>data</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>tidal-2026.csv</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--parquet">PQ</span>
                        <span>survey.parquet</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--other">GEO</span>
                        <span>sites.geojson</span>
                      </div>
                      <div className="agent-file agent-file--indent agent-file--moved">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>export_final_v3.csv</span>
                      </div>
                      <div className="agent-file agent-file--indent agent-file--moved">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>export_final_v2.csv</span>
                      </div>
                      <div className="agent-file agent-file--folder">
                        <svg className="icon">
                          <use href="#i-chevron-down" />
                        </svg>
                        <span>notebooks</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--ipynb">IPY</span>
                        <span>analysis.ipynb</span>
                      </div>
                    </div>
                    <div className="agent-tree-arrow" aria-hidden="true">
                      <svg className="icon icon--sm">
                        <use href="#i-arrow-right" />
                      </svg>
                    </div>
                    <div className="agent-tree-col agent-tree-col--after">
                      <span className="agent-tree-label">AFTER</span>
                      <div className="agent-file agent-file--folder">
                        <svg className="icon">
                          <use href="#i-chevron-down" />
                        </svg>
                        <span>data</span>
                      </div>
                      <div className="agent-file agent-file--indent agent-file--new">
                        <svg className="icon">
                          <use href="#i-folder" />
                        </svg>
                        <span>2026</span>
                      </div>
                      <div className="agent-file agent-file--indent-2">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>tidal-2026.csv</span>
                      </div>
                      <div className="agent-file agent-file--indent-2">
                        <span className="file-ext file-ext--parquet">PQ</span>
                        <span>survey.parquet</span>
                      </div>
                      <div className="agent-file agent-file--indent-2">
                        <span className="file-ext file-ext--other">GEO</span>
                        <span>sites.geojson</span>
                      </div>
                      <div className="agent-file agent-file--folder">
                        <svg className="icon">
                          <use href="#i-chevron-down" />
                        </svg>
                        <span>archive</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>field-export.csv</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--csv">CSV</span>
                        <span>field-export-v2.csv</span>
                      </div>
                      <div className="agent-file agent-file--folder">
                        <svg className="icon">
                          <use href="#i-chevron-down" />
                        </svg>
                        <span>notebooks</span>
                      </div>
                      <div className="agent-file agent-file--indent">
                        <span className="file-ext file-ext--ipynb">IPY</span>
                        <span>analysis.ipynb</span>
                      </div>
                    </div>
                  </div>
                  <div className="agent-tree-foot">
                    <span>12 files moved</span>
                    <span>8 paths repaired</span>
                    <span>0 files lost</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="section" id="autonomy">
            <div className="container">
              <div className="agent-autonomy">
                <div className="agent-autonomy-copy" data-reveal>
                  <div className="eyebrow">Autonomy</div>
                  <h2 className="section-title">Point it at an outcome. Walk away.</h2>
                  <p className="section-desc">
                    You do not have to babysit the steps. A request becomes a plan, the plan becomes
                    a run, and the run continues across files, folders, and lab sessions until the
                    task is finished.
                  </p>
                  <ol className="agent-steps">
                    <li className="agent-step">
                      <div>
                        <strong>Understand the request</strong>
                        <p>
                          Reads the file tree, notes, and recent activity to work out what you are
                          actually asking for.
                        </p>
                      </div>
                    </li>
                    <li className="agent-step">
                      <div>
                        <strong>Write a plan</strong>
                        <p>
                          Breaks the task into concrete steps: which files open, which commands run,
                          what changes.
                        </p>
                      </div>
                    </li>
                    <li className="agent-step">
                      <div>
                        <strong>Act, then check</strong>
                        <p>
                          Executes each step, re-reads the result, and retries when something does
                          not line up.
                        </p>
                      </div>
                    </li>
                    <li className="agent-step">
                      <div>
                        <strong>Report back</strong>
                        <p>
                          Leaves a summary, a diff, and a run log in the project so the next person
                          can follow it.
                        </p>
                      </div>
                    </li>
                  </ol>
                  <div className="agent-run-note">
                    <strong>Long jobs are fine.</strong> Runs live with the project, not in your
                    browser tab. Close the laptop and come back to a finished diff, a paused
                    approval, or a clear failure.{" "}
                  </div>
                </div>
                <div className="product-window agent-run-card" data-reveal data-reveal-delay="100">
                  <div className="agent-run-head">
                    <div>
                      <span className="panel-kicker">ACTIVE RUN · 00:42</span>
                      <h3>Tidy the 2026 field season</h3>
                    </div>
                    <span className="status-pill">
                      <i></i> Autonomous
                    </span>
                  </div>
                  <div className="agent-run-body">
                    <div
                      className="agent-run-progress"
                      role="progressbar"
                      aria-label="Run progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={72}
                    >
                      <span></span>
                    </div>
                    <div className="agent-run-row is-done">
                      <span className="trace-icon">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        Moved 12 files into <strong>/data/2026</strong>
                      </span>
                      <span className="run-state">DONE</span>
                    </div>
                    <div className="agent-run-row is-done">
                      <span className="trace-icon">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        Renamed <strong>export_final_v3.csv</strong> → field-export.csv
                      </span>
                      <span className="run-state">DONE</span>
                    </div>
                    <div className="agent-run-row is-live">
                      <span className="trace-icon">
                        <span className="trace-pulse"></span>
                      </span>
                      <span>
                        Rewriting paths in <strong>analysis.ipynb</strong>
                      </span>
                      <span className="run-state">LIVE</span>
                    </div>
                    <div className="agent-run-row is-paused">
                      <span className="trace-icon trace-icon--empty"></span>
                      <span>Run the notebook once to confirm</span>
                      <span className="run-state">QUEUED</span>
                    </div>
                  </div>
                  <div className="agent-run-footer">
                    <span>Self-checks passed · 2 / 2</span>
                    <span className="status-pill status-pill--tiny">
                      <i></i> Review before apply
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="section section--alt" id="requests">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Requests</div>
                <h2 className="section-title">
                  20 requests a day. 50 more when you refer someone.
                </h2>
                <p className="section-desc">
                  Every plan includes agent requests. Spend them on whole tasks — the edits, the
                  moves, the lab run, and the summary at the end.
                </p>
              </div>
              <div className="agent-allowance-grid">
                <div className="allowance-card allowance-card--daily" data-reveal>
                  <div className="eyebrow">Every day</div>
                  <div className="allowance-big">
                    <span className="num">20</span>
                    <span className="unit">
                      AGENT REQUESTS
                      <br />
                      PER DAY
                    </span>
                  </div>
                  <h3>Included on the free plan</h3>
                  <p>
                    Twenty requests arrive with every day, on the same plan that gives you 5 GB of
                    storage. One request covers one task, from your first sentence to the finished
                    diff — however many steps it takes.
                  </p>
                  <span className="allowance-tag">NO CARD · NO TRIAL</span>
                </div>
                <div
                  className="allowance-card allowance-card--referral"
                  data-reveal
                  data-reveal-delay="80"
                >
                  <div className="eyebrow">One time</div>
                  <div className="allowance-big">
                    <span className="num">+50</span>
                    <span className="unit">
                      EXTRA REQUESTS
                      <br />
                      FOR A REFERRAL
                    </span>
                  </div>
                  <h3>Refer a new user</h3>
                  <p>
                    Send someone your link. When they create an account with it, 50 extra requests
                    are added to your plan, one time.
                  </p>
                  <p>
                    Unlike the daily twenty, these do not expire. They sit in your balance until a
                    week gets busy.
                  </p>
                  <span className="allowance-tag">
                    <svg className="icon icon--xs">
                      <use href="#i-clock" />
                    </svg>{" "}
                    NEVER EXPIRE
                  </span>
                </div>
              </div>
              <div className="request-rules">
                <article className="request-rule">
                  <span>01</span>
                  <h3>One task, one request</h3>
                  <p>
                    A request is one instruction you hand the agent. A ten-step refactor is still a
                    single request.
                  </p>
                </article>
                <article className="request-rule">
                  <span>02</span>
                  <h3>Reviewing is free</h3>
                  <p>
                    Opening a diff, approving it, or rolling it back never spends a request. Only
                    new tasks do.
                  </p>
                </article>
                <article className="request-rule">
                  <span>03</span>
                  <h3>Bonus first, then daily</h3>
                  <p>
                    Referral requests are used after the day's twenty run out, so your balance
                    carries forward untouched.
                  </p>
                </article>
              </div>
              <ol className="referral-steps">
                <li className="referral-step">
                  <div>
                    <strong>Share your link</strong>
                    <small>Every account gets one in the referral panel.</small>
                  </div>
                </li>
                <li className="referral-step">
                  <div>
                    <strong>They create an account</strong>
                    <small>The bonus applies the first time a new user joins with your link.</small>
                  </div>
                </li>
                <li className="referral-step">
                  <div>
                    <strong>50 requests land</strong>
                    <small>Added once, never expire, shown next to your daily balance.</small>
                  </div>
                </li>
              </ol>
            </div>
          </section>
          <section className="section" id="examples">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">In practice</div>
                <h2 className="section-title">Things people hand to the agent.</h2>
                <p className="section-desc">
                  Edits, moves, and follow-through across the project — not just a paragraph of
                  advice about it.
                </p>
              </div>
              <div className="agent-use-grid">
                <article className="agent-use-card" data-reveal>
                  <div className="agent-use-head">
                    <span className="agent-use-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-folder" />
                      </svg>
                    </span>
                    <h3>Tidy a field season</h3>
                  </div>
                  <p className="agent-use-prompt">
                    Move everything from the 2026 survey into data/2026, rename the exports
                    consistently, and fix the notebook paths.
                  </p>
                  <span className="agent-use-result">
                    <svg className="icon">
                      <use href="#i-check" />
                    </svg>{" "}
                    12 files moved · 8 paths repaired
                  </span>
                </article>
                <article className="agent-use-card" data-reveal data-reveal-delay="60">
                  <div className="agent-use-head">
                    <span className="agent-use-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-grid" />
                      </svg>
                    </span>
                    <h3>Edit a spreadsheet</h3>
                  </div>
                  <p className="agent-use-prompt">
                    Normalize the site names in results.xlsx and add the salinity column from
                    tidal-2026.csv.
                  </p>
                  <span className="agent-use-result">
                    <svg className="icon">
                      <use href="#i-check" />
                    </svg>{" "}
                    3 sheets edited · review copy saved
                  </span>
                </article>
                <article className="agent-use-card" data-reveal data-reveal-delay="120">
                  <div className="agent-use-head">
                    <span className="agent-use-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-code" />
                      </svg>
                    </span>
                    <h3>Refactor a pipeline</h3>
                  </div>
                  <p className="agent-use-prompt">
                    Split the cleaning logic out of analysis.ipynb into clean_data.py and update
                    results.csv with the new columns.
                  </p>
                  <span className="agent-use-result">
                    <svg className="icon">
                      <use href="#i-check" />
                    </svg>{" "}
                    +84 lines · −19 lines
                  </span>
                </article>
                <article className="agent-use-card" data-reveal data-reveal-delay="180">
                  <div className="agent-use-head">
                    <span className="agent-use-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-sparkle" />
                      </svg>
                    </span>
                    <h3>Summarize sources</h3>
                  </div>
                  <p className="agent-use-prompt">
                    Read the 6 newest papers in /sources and draft a literature note with a citation
                    for each claim.
                  </p>
                  <span className="agent-use-result">
                    <svg className="icon">
                      <use href="#i-check" />
                    </svg>{" "}
                    literature-note.md · 6 citations
                  </span>
                </article>
              </div>
            </div>
          </section>
          <section className="section section--alt" id="control">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Control</div>
                <h2 className="section-title">Autonomous does not mean unsupervised.</h2>
                <p className="section-desc">
                  The agent gets room to finish the job, not permission to do whatever it likes.
                  These limits are always on.
                </p>
              </div>
              <div className="agent-guard-grid">
                <article className="agent-guard" data-reveal>
                  <span className="agent-guard-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-eye" />
                    </svg>
                  </span>
                  <h3>Every change is a diff</h3>
                  <p>
                    Inspect the exact lines before they land. Approve, adjust, or discard the whole
                    run.
                  </p>
                </article>
                <article className="agent-guard" data-reveal data-reveal-delay="60">
                  <span className="agent-guard-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-clock" />
                    </svg>
                  </span>
                  <h3>History you can rewind</h3>
                  <p>
                    Each run keeps its inputs, file changes, and output. Restore an earlier version
                    in one click.
                  </p>
                </article>
                <article className="agent-guard" data-reveal data-reveal-delay="120">
                  <span className="agent-guard-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-lock" />
                    </svg>
                  </span>
                  <h3>Scoped to one project</h3>
                  <p>It sees the project it was invoked in, and nothing else in your workspace.</p>
                </article>
                <article className="agent-guard" data-reveal data-reveal-delay="180">
                  <span className="agent-guard-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-shield" />
                    </svg>
                  </span>
                  <h3>Approval gates</h3>
                  <p>
                    Overwrites, folder-wide moves, and anything destructive pause for a yes before
                    they run.
                  </p>
                </article>
              </div>
              <p className="agent-guard-note">
                Every run follows the <a href="/acceptable-use">Acceptable Use Policy</a> — runs are
                attributed to whoever started them, and allowance or sandbox limits cannot be worked
                around.
              </p>
            </div>
          </section>
          <section className="section" id="faq">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Questions</div>
                <h2 className="section-title">The practical details.</h2>
              </div>
              <AgentFaq />
            </div>
          </section>
          <section className="cta-section" id="get-started">
            <div className="container">
              <div className="cta-box agent-cta">
                <div className="cta-orbit" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="eyebrow">READY WHEN YOU ARE</div>
                <h2>Hand it the boring half of the project.</h2>
                <p>
                  Start free with 20 agent requests a day — or refer a colleague and keep 50 more in
                  reserve, without an expiry date.
                </p>
                <div className="cta-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Create free workspace{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="/pricing" className="btn btn--ghost btn--lg">
                    See the pricing
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </PageTransition>
  )
}
