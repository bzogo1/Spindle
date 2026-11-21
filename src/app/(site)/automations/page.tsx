import "../../styles/automations.css"
import { PageInteractions } from "@/components/site/page-interactions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Automations — Spindle",
  description:
    "Turn a sentence into a repeatable research workflow. Text Spindle's AI, build with a friendly visual editor, or write raw cron — with one set of guardrails.",
  path: "/automations",
})

export default function AutomationsPage() {
  return (
    <PageTransition>
      <div className="automations-page">
        <main id="top" tabIndex={-1}>
          <section className="auto-hero">
            <div className="auto-hero-grid-bg" aria-hidden="true"></div>
            <div className="auto-hero-glow" aria-hidden="true"></div>
            <div className="auto-hero-grid container">
              <div className="auto-hero-copy" data-reveal>
                <div className="auto-kicker">
                  <i aria-hidden="true"></i> AUTOMATIONS · ONE WORKSPACE
                </div>
                <h1>
                  Put your research
                  <br />
                  <span>on a schedule.</span>
                </h1>
                <p className="auto-subtitle">
                  {" "}
                  Text an AI what you need, shape it with a friendly builder, or write the cron
                  yourself. Spindle turns the sentence into a real workflow — with your files, logs,
                  and guardrails already attached.{" "}
                </p>
                <div className="auto-hero-actions">
                  <a href="#studio" className="btn btn--primary btn--lg">
                    Open the studio{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="#how-it-works" className="btn btn--ghost btn--lg">
                    See how it works
                  </a>
                </div>
                <div className="auto-hero-foot">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Preview before anything runs
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    No infrastructure to manage
                  </span>
                </div>
              </div>
              <div className="auto-hero-visual" data-reveal data-reveal-delay="100">
                <div className="visual-halo" aria-hidden="true"></div>
                <div className="product-window auto-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">coastal-resilience / automations</span>
                    <span className="window-bar-status">
                      <i></i> 3 active
                    </span>
                  </div>
                  <div className="auto-window-body">
                    <div className="runs-head">
                      <div>
                        <span className="panel-kicker">PROJECT / DAILY RHYTHM</span>
                        <h2>This week's runs</h2>
                      </div>
                      <span className="status-pill status-pill--tiny">
                        <i></i> All healthy
                      </span>
                    </div>
                    <div className="run-list">
                      <div className="run-row">
                        <span className="run-time">17:00</span>
                        <span className="run-icon run-icon--lime">
                          <svg className="icon icon--xs">
                            <use href="#i-flask" />
                          </svg>
                        </span>
                        <span className="run-main">
                          <strong>Check study results</strong>
                          <small>9 new records · 1 flagged for review</small>
                        </span>
                        <span className="run-result run-result--ok">Success</span>
                      </div>
                      <div className="run-row">
                        <span className="run-time">08:30</span>
                        <span className="run-icon run-icon--teal">
                          <svg className="icon icon--xs">
                            <use href="#i-refresh" />
                          </svg>
                        </span>
                        <span className="run-main">
                          <strong>Sync source folder</strong>
                          <small>4 files changed · 12 MB</small>
                        </span>
                        <span className="run-result run-result--ok">Success</span>
                      </div>
                      <div className="run-row">
                        <span className="run-time">06:00</span>
                        <span className="run-icon run-icon--amber">
                          <svg className="icon icon--xs">
                            <use href="#i-code" />
                          </svg>
                        </span>
                        <span className="run-main">
                          <strong>tide-sync.py</strong>
                          <small>cron · generated 3 snapshots</small>
                        </span>
                        <span className="run-result run-result--ok">Success</span>
                      </div>
                    </div>
                    <div className="pipeline-card">
                      <div className="pipeline-card-head">
                        <span className="mono">SELECTED · DAILY STUDY CHECK</span>
                        <span className="pipeline-live">
                          <i></i> Next run today, 17:00
                        </span>
                      </div>
                      <div className="pipeline">
                        <div className="pipe-step">
                          <span className="pipe-ico">
                            <svg className="icon icon--sm">
                              <use href="#i-clock" />
                            </svg>
                          </span>
                          <span className="pipe-label">WHEN</span>
                          <strong>
                            Every day
                            <br />
                            at 17:00
                          </strong>
                        </div>
                        <div className="pipe-connector" aria-hidden="true">
                          <span></span>
                        </div>
                        <div className="pipe-step">
                          <span className="pipe-ico">
                            <svg className="icon icon--sm">
                              <use href="#i-sparkle" />
                            </svg>
                          </span>
                          <span className="pipe-label">THEN</span>
                          <strong>
                            Check results
                            <br />& flag outliers
                          </strong>
                        </div>
                        <div className="pipe-connector" aria-hidden="true">
                          <span></span>
                        </div>
                        <div className="pipe-step">
                          <span className="pipe-ico">
                            <svg className="icon icon--sm">
                              <use href="#i-message" />
                            </svg>
                          </span>
                          <span className="pipe-label">DELIVER</span>
                          <strong>
                            Digest to
                            <br />
                            #study-updates
                          </strong>
                        </div>
                      </div>
                    </div>
                    <div className="clock-strip">
                      <div className="clock-dial" aria-hidden="true">
                        <span className="clock-ring"></span>
                        <span className="clock-hand"></span>
                        <span className="clock-center"></span>
                      </div>
                      <div className="clock-copy">
                        <span className="mono">NEXT TRIGGER</span>
                        <strong>05:00 PM</strong>
                        <small>Local time · Europe/Berlin</small>
                      </div>
                      <div className="clock-bars" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i className="is-hot"></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                        <i></i>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="floating-note" aria-hidden="true">
                  <span className="note-icon">
                    <svg className="icon icon--xs">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <span>
                    <strong>4.5 hrs</strong>
                    <small>saved this month</small>
                  </span>
                </div>
              </div>
            </div>
          </section>
          <section className="paths" id="how-it-works" aria-label="Ways to create an automation">
            <div className="container">
              <div className="paths-grid">
                <button type="button" className="path-card" data-goto-mode="ask">
                  <span className="path-num">01</span>
                  <span className="path-icon path-icon--lime">
                    <svg className="icon">
                      <use href="#i-sparkle" />
                    </svg>
                  </span>
                  <strong>Text it</strong>
                  <span className="path-desc">
                    Say it like you'd text a labmate. The AI drafts the workflow.
                  </span>
                  <span className="path-example">
                    “Check results for this study at 5 PM every day”
                  </span>
                  <span className="path-cta">
                    Try the chat{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                </button>
                <button type="button" className="path-card" data-goto-mode="build">
                  <span className="path-num">02</span>
                  <span className="path-icon path-icon--teal">
                    <svg className="icon">
                      <use href="#i-grid" />
                    </svg>
                  </span>
                  <strong>Build it</strong>
                  <span className="path-desc">
                    Pick a trigger, stack a few steps, choose where it lands.
                  </span>
                  <span className="path-example">
                    Friendly controls, plain-English preview, zero syntax.
                  </span>
                  <span className="path-cta">
                    Open builder{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                </button>
                <button type="button" className="path-card" data-goto-mode="cron">
                  <span className="path-num">03</span>
                  <span className="path-icon path-icon--amber">
                    <svg className="icon">
                      <use href="#i-code" />
                    </svg>
                  </span>
                  <strong>Script it</strong>
                  <span className="path-desc">
                    Drop into Cron mode with your own command and schedule.
                  </span>
                  <span className="path-example">
                    0 17 * * * · full syntax · project files mounted
                  </span>
                  <span className="path-cta">
                    Write cron{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          </section>
          <section className="section studio-section" id="studio">
            <div className="container">
              <div className="studio-head">
                <div className="section-head">
                  <div className="eyebrow">The studio</div>
                  <h2 className="section-title">Three ways in. One reliable run.</h2>
                  <p className="section-desc">
                    Start with a sentence, shape it with controls, or go full cron. Every path lands
                    in the same place: a preview you approve, a history you can trust, and logs you
                    can actually read.
                  </p>
                </div>
                <div className="mode-tabs" role="tablist" aria-label="Automation creation mode">
                  <button
                    type="button"
                    className="mode-tab is-active"
                    role="tab"
                    aria-selected="true"
                    id="tab-ask"
                    aria-controls="panel-ask"
                    data-mode="ask"
                  >
                    <svg className="icon icon--sm">
                      <use href="#i-sparkle" />
                    </svg>{" "}
                    Ask AI{" "}
                  </button>
                  <button
                    type="button"
                    className="mode-tab"
                    role="tab"
                    aria-selected="false"
                    id="tab-build"
                    aria-controls="panel-build"
                    data-mode="build"
                    tabIndex={-1}
                  >
                    <svg className="icon icon--sm">
                      <use href="#i-grid" />
                    </svg>{" "}
                    Builder{" "}
                  </button>
                  <button
                    type="button"
                    className="mode-tab"
                    role="tab"
                    aria-selected="false"
                    id="tab-cron"
                    aria-controls="panel-cron"
                    data-mode="cron"
                    tabIndex={-1}
                  >
                    <svg className="icon icon--sm">
                      <use href="#i-code" />
                    </svg>{" "}
                    Cron{" "}
                  </button>
                </div>
              </div>
              <div className="product-window studio-window">
                <div className="window-bar studio-topbar">
                  <div className="traffic-lights" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <span className="window-bar-title">
                    New automation <span className="slash">/</span>{" "}
                    <span id="studioModeLabel">Ask AI</span>
                  </span>
                  <div className="studio-topbar-right">
                    <span className="status-pill status-pill--tiny" id="studioStatus">
                      <i></i> Draft
                    </span>
                    <button type="button" className="reset-btn" id="resetDemo" title="Reset demo">
                      <svg className="icon icon--xs">
                        <use href="#i-refresh" />
                      </svg>{" "}
                      Reset{" "}
                    </button>
                  </div>
                </div>
                <div
                  className="studio-panel is-active"
                  id="panel-ask"
                  role="tabpanel"
                  aria-labelledby="tab-ask"
                  data-mode-panel="ask"
                >
                  <div className="ask-layout">
                    <div className="chat-side">
                      <div className="chat-head">
                        <span className="ai-avatar">
                          <svg className="icon icon--sm">
                            <use href="#i-sparkle" />
                          </svg>
                        </span>
                        <span className="chat-head-text">
                          <strong>Spindle agent</strong>
                          <small>
                            <i></i> Reading coastal-resilience
                          </small>
                        </span>
                        <span className="chat-head-tag">GPT · project-aware</span>
                      </div>
                      <div className="chat-thread" id="chatThread" aria-live="polite">
                        <div className="msg msg--ai">
                          <span className="msg-avatar">
                            <svg className="icon icon--xs">
                              <use href="#i-sparkle" />
                            </svg>
                          </span>
                          <div className="bubble">
                            Hey — want an automation? Tell me what should happen and when. I'll
                            draft the steps and you approve them before anything runs.
                          </div>
                        </div>
                        <div className="msg msg--user">
                          <div className="bubble">
                            Check results for this study at 5 PM every day.
                          </div>
                        </div>
                        <div className="msg msg--ai" id="chatDraft">
                          <span className="msg-avatar">
                            <svg className="icon icon--xs">
                              <use href="#i-sparkle" />
                            </svg>
                          </span>
                          <div className="bubble bubble--draft">
                            <p>Got it. Here's the routine I'd set up:</p>
                            <ol className="draft-steps">
                              <li>
                                Read new results in <code>/results</code>
                              </li>
                              <li>Compare against the baseline and flag outliers</li>
                              <li>
                                Write a short digest to <code>#study-updates</code>
                              </li>
                            </ol>
                            <div className="draft-schedule">
                              <svg className="icon icon--xs">
                                <use href="#i-clock" />
                              </svg>{" "}
                              Every day at 5:00 PM · Europe/Berlin
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="chat-suggestions" aria-label="Example requests">
                        <button
                          type="button"
                          data-prompt="Check results for this study at 5 PM every day"
                        >
                          Check results daily
                        </button>
                        <button
                          type="button"
                          data-prompt="Every Monday, summarize new papers into notes.md"
                        >
                          Summarize papers weekly
                        </button>
                        <button
                          type="button"
                          data-prompt="When a new CSV lands in /data, clean it and flag weird rows"
                        >
                          Watch new CSVs
                        </button>
                      </div>
                      <form className="chat-form" id="chatForm" autoComplete="off">
                        <label htmlFor="chatInput" className="sr-only">
                          Describe an automation
                        </label>
                        <svg className="icon chat-form-icon">
                          <use href="#i-sparkle" />
                        </svg>
                        <input
                          id="chatInput"
                          type="text"
                          placeholder="Describe an automation…"
                          maxLength={180}
                        />
                        <button type="submit" className="send-btn" aria-label="Send request">
                          <svg className="icon icon--sm">
                            <use href="#i-send" />
                          </svg>
                        </button>
                      </form>
                    </div>
                    <aside className="draft-side">
                      <div className="draft-side-head">
                        <span className="panel-kicker">READY TO REVIEW</span>
                        <h3 id="askTitle">Daily study results check</h3>
                      </div>
                      <div className="draft-preview" id="askFlow">
                        <div className="draft-flow-step">
                          <span className="step-dot step-dot--lime"></span>
                          <div>
                            <small>TRIGGER</small>
                            <strong id="askTrigger">Every day · 17:00</strong>
                          </div>
                        </div>
                        <div className="draft-flow-step">
                          <span className="step-dot step-dot--teal"></span>
                          <div>
                            <small>ACTION 1</small>
                            <strong id="askAction1">Scan /results for new entries</strong>
                          </div>
                        </div>
                        <div className="draft-flow-step">
                          <span className="step-dot step-dot--teal"></span>
                          <div>
                            <small>ACTION 2</small>
                            <strong id="askAction2">Flag outliers against baseline</strong>
                          </div>
                        </div>
                        <div className="draft-flow-step">
                          <span className="step-dot step-dot--amber"></span>
                          <div>
                            <small>DELIVER</small>
                            <strong id="askDelivery">Digest to #study-updates</strong>
                          </div>
                        </div>
                      </div>
                      <dl className="draft-facts">
                        <div>
                          <dt>Project</dt>
                          <dd>coastal-resilience</dd>
                        </div>
                        <div>
                          <dt>Timezone</dt>
                          <dd>Europe/Berlin</dd>
                        </div>
                        <div>
                          <dt>Guardrails</dt>
                          <dd>Preview · logs · alerts</dd>
                        </div>
                      </dl>
                      <button type="button" className="btn btn--primary btn--full" id="askApprove">
                        <svg className="icon icon--sm">
                          <use href="#i-check" />
                        </svg>{" "}
                        Approve & schedule
                      </button>
                      <p className="demo-note">Interface preview — nothing is scheduled.</p>
                    </aside>
                  </div>
                </div>
                <div
                  className="studio-panel"
                  id="panel-build"
                  role="tabpanel"
                  aria-labelledby="tab-build"
                  data-mode-panel="build"
                  hidden
                >
                  <div className="builder-layout">
                    <div className="builder-form">
                      <div className="builder-intro">
                        <span className="panel-kicker">NO CODE, JUST CHOICES</span>
                        <h3>Make it yours in three steps.</h3>
                      </div>
                      <fieldset className="builder-block">
                        <legend>
                          <span className="step-num">1</span> When should it run?
                        </legend>
                        <div
                          className="segmented"
                          id="freqGroup"
                          role="group"
                          aria-label="Frequency"
                        >
                          <button
                            type="button"
                            className="seg is-active"
                            data-freq="daily"
                            aria-pressed="true"
                          >
                            Daily
                          </button>
                          <button
                            type="button"
                            className="seg"
                            data-freq="weekly"
                            aria-pressed="false"
                          >
                            Weekly
                          </button>
                          <button
                            type="button"
                            className="seg"
                            data-freq="file"
                            aria-pressed="false"
                          >
                            On new file
                          </button>
                        </div>
                        <div className="builder-fields" id="timeFields">
                          <label className="field">
                            <span>At</span>
                            <input type="time" id="buildTime" defaultValue="17:00" />
                          </label>
                          <label className="field">
                            <span>Timezone</span>
                            <select id="buildTz">
                              <option value="Europe/Berlin">Europe/Berlin (UTC+2)</option>
                              <option value="UTC">UTC</option>
                              <option value="America/New_York">America/New_York (UTC−4)</option>
                              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                            </select>
                          </label>
                        </div>
                        <div
                          className="day-pills"
                          id="dayPills"
                          hidden
                          aria-label="Days of the week"
                        >
                          <button
                            type="button"
                            className="day is-active"
                            data-day="1"
                            aria-pressed="true"
                          >
                            M
                          </button>
                          <button type="button" className="day" data-day="2" aria-pressed="false">
                            T
                          </button>
                          <button type="button" className="day" data-day="3" aria-pressed="false">
                            W
                          </button>
                          <button type="button" className="day" data-day="4" aria-pressed="false">
                            T
                          </button>
                          <button type="button" className="day" data-day="5" aria-pressed="false">
                            F
                          </button>
                          <button type="button" className="day" data-day="6" aria-pressed="false">
                            S
                          </button>
                          <button type="button" className="day" data-day="0" aria-pressed="false">
                            S
                          </button>
                        </div>
                      </fieldset>
                      <fieldset className="builder-block">
                        <legend>
                          <span className="step-num">2</span> What should it do?
                        </legend>
                        <div className="option-grid">
                          <label className="option checked">
                            <input type="checkbox" data-action="results" defaultChecked />
                            <span className="option-box">
                              <svg className="icon icon--xs">
                                <use href="#i-check" />
                              </svg>
                            </span>
                            <span>
                              <strong>Check study results</strong>
                              <small>Look for new or updated entries</small>
                            </span>
                          </label>
                          <label className="option checked">
                            <input type="checkbox" data-action="flag" defaultChecked />
                            <span className="option-box">
                              <svg className="icon icon--xs">
                                <use href="#i-check" />
                              </svg>
                            </span>
                            <span>
                              <strong>Flag outliers</strong>
                              <small>Compare with the running baseline</small>
                            </span>
                          </label>
                          <label className="option">
                            <input type="checkbox" data-action="summary" />
                            <span className="option-box">
                              <svg className="icon icon--xs">
                                <use href="#i-check" />
                              </svg>
                            </span>
                            <span>
                              <strong>Write a summary</strong>
                              <small>Turn the changes into a short note</small>
                            </span>
                          </label>
                          <label className="option">
                            <input type="checkbox" data-action="log" />
                            <span className="option-box">
                              <svg className="icon icon--xs">
                                <use href="#i-check" />
                              </svg>
                            </span>
                            <span>
                              <strong>Append to project log</strong>
                              <small>Keep a dated trail in notes.md</small>
                            </span>
                          </label>
                        </div>
                      </fieldset>
                      <fieldset className="builder-block">
                        <legend>
                          <span className="step-num">3</span> Where should it land?
                        </legend>
                        <div className="channel-row" id="channelGroup">
                          <button
                            type="button"
                            className="channel active"
                            data-channel="Project log"
                            aria-pressed="true"
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-folder" />
                            </svg>{" "}
                            Project log
                          </button>
                          <button
                            type="button"
                            className="channel active"
                            data-channel="#study-updates"
                            aria-pressed="true"
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-message" />
                            </svg>{" "}
                            #study-updates
                          </button>
                          <button
                            type="button"
                            className="channel"
                            data-channel="Email digest"
                            aria-pressed="false"
                          >
                            <svg className="icon icon--xs">
                              <use href="#i-send" />
                            </svg>{" "}
                            Email digest
                          </button>
                        </div>
                      </fieldset>
                      <div className="builder-buttons">
                        <button type="button" className="btn btn--ghost" id="buildDraft">
                          Save as draft
                        </button>
                        <button type="button" className="btn btn--primary" id="buildCreate">
                          <svg className="icon icon--sm">
                            <use href="#i-bolt" />
                          </svg>{" "}
                          Create automation
                        </button>
                      </div>
                    </div>
                    <aside className="builder-side">
                      <div className="plain-card">
                        <span className="panel-kicker">IN PLAIN ENGLISH</span>
                        <p id="plainEnglish">
                          Every day at 17:00 (Europe/Berlin), check study results and flag outliers.
                          Send the outcome to Project log and #study-updates.
                        </p>
                      </div>
                      <div className="flow-card">
                        <span className="panel-kicker">WHAT WILL HAPPEN</span>
                        <ol className="flow-list" id="flowList"></ol>
                      </div>
                      <div className="next-card">
                        <span className="panel-kicker">NEXT RUNS</span>
                        <ul id="nextRuns"></ul>
                      </div>
                      <div className="toast" id="buildToast" role="status" hidden></div>
                    </aside>
                  </div>
                </div>
                <div
                  className="studio-panel"
                  id="panel-cron"
                  role="tabpanel"
                  aria-labelledby="tab-cron"
                  data-mode-panel="cron"
                  hidden
                >
                  <div className="cron-layout">
                    <div className="cron-editor">
                      <div className="editor-head">
                        <div className="editor-tabs" role="tablist" aria-label="Code files">
                          <button
                            type="button"
                            className="code-tab is-active"
                            data-code-tab="script"
                            role="tab"
                            aria-selected="true"
                          >
                            <span data-script-file>check_results.py</span>
                          </button>
                          <button
                            type="button"
                            className="code-tab"
                            data-code-tab="env"
                            role="tab"
                            aria-selected="false"
                          >
                            spindle.toml
                          </button>
                        </div>
                        <div className="lang-switch" role="group" aria-label="Snippet language">
                          <button
                            type="button"
                            className="lang-btn is-active"
                            data-lang-btn="py"
                            aria-pressed="true"
                          >
                            Python
                          </button>
                          <button
                            type="button"
                            className="lang-btn"
                            data-lang-btn="r"
                            aria-pressed="false"
                          >
                            R
                          </button>
                          <button
                            type="button"
                            className="lang-btn"
                            data-lang-btn="jl"
                            aria-pressed="false"
                          >
                            Julia
                          </button>
                        </div>
                        <div className="editor-head-actions">
                          <details className="version-history">
                            <summary aria-label="Script version history">
                              <svg className="icon icon--xs">
                                <use href="#i-clock" />
                              </svg>{" "}
                              History
                              <svg className="icon icon--xs version-caret">
                                <use href="#i-chevron-down" />
                              </svg>
                            </summary>
                            <ul className="version-list">
                              <li>
                                <button
                                  type="button"
                                  className="version-item is-current"
                                  data-version="current"
                                  aria-current="true"
                                >
                                  <span className="version-tag">v1.4</span>
                                  <span className="version-meta">
                                    <strong>Current</strong>
                                    <small>Today · you</small>
                                  </span>
                                </button>
                              </li>
                              <li>
                                <button type="button" className="version-item" data-version="v1.3">
                                  <span className="version-tag">v1.3</span>
                                  <span className="version-meta">
                                    <strong>Baseline comparison</strong>
                                    <small>Mar 4 · you</small>
                                  </span>
                                </button>
                              </li>
                              <li>
                                <button type="button" className="version-item" data-version="v1.2">
                                  <span className="version-tag">v1.2</span>
                                  <span className="version-meta">
                                    <strong>CSV outlier export</strong>
                                    <small>Feb 18 · ana</small>
                                  </span>
                                </button>
                              </li>
                              <li>
                                <button type="button" className="version-item" data-version="v1.1">
                                  <span className="version-tag">v1.1</span>
                                  <span className="version-meta">
                                    <strong>Initial stub</strong>
                                    <small>Feb 2 · you</small>
                                  </span>
                                </button>
                              </li>
                            </ul>
                          </details>
                          <button type="button" className="copy-btn" id="copyCode">
                            <svg className="icon icon--xs">
                              <use href="#i-copy" />
                            </svg>{" "}
                            Copy
                          </button>
                        </div>
                      </div>
                      <div className="crontab-line">
                        <span className="cron-hash">#</span>
                        <label htmlFor="cronExpr" className="sr-only">
                          Cron expression
                        </label>
                        <input
                          id="cronExpr"
                          className="cron-input mono"
                          defaultValue="0 17 * * *"
                          spellCheck="false"
                          aria-describedby="cronValidation"
                        />
                        <span className="cron-command" id="cronCommand">
                          python check_results.py
                        </span>
                        <button
                          type="button"
                          className="copy-btn cron-copy-command"
                          id="copyCronCommand"
                        >
                          <svg className="icon icon--xs">
                            <use href="#i-copy" />
                          </svg>{" "}
                          Copy command
                        </button>
                      </div>
                      <pre className="code-block" data-code-panel="script">
                        <code data-lang-panel="py">
                          <span className="tok-com">
                            {"# Spindle mounts your project files automatically"}
                          </span>
                          {"\n"}
                          <span className="tok-key">{"from"}</span>
                          {" spindle "}
                          <span className="tok-key">{"import"}</span>
                          {" project "}
                          <span className="tok-key">{"as"}</span>
                          {" sp\n"}
                          <span className="tok-key">{"import"}</span>
                          {" pandas "}
                          <span className="tok-key">{"as"}</span>
                          {" pd\n\nresults = sp.files.read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {")\nbaseline = sp.files.read("}
                          <span className="tok-str">{'"baselines/survey.csv"'}</span>
                          {")\n\noutliers = results[results.zscore > "}
                          <span className="tok-num">{"2.5"}</span>
                          {"]\ndigest = sp.agent.summarize(outliers, baseline)\n\nsp.log.write("}
                          <span className="tok-str">{'"notes.md"'}</span>
                          {", digest)\nsp.notify("}
                          <span className="tok-str">{'"#study-updates"'}</span>
                          {", digest)"}
                        </code>
                        <code data-lang-panel="r" hidden>
                          <span className="tok-com">
                            {"# Spindle mounts your project files automatically"}
                          </span>
                          {"\n"}
                          <span className="tok-key">{"library"}</span>
                          {"(spindle)\n"}
                          <span className="tok-key">{"library"}</span>
                          {"(readr)\n\nresults "}
                          <span className="tok-key">{"<-"}</span>
                          {" sp$files$read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {")\nbaseline "}
                          <span className="tok-key">{"<-"}</span>
                          {" sp$files$read("}
                          <span className="tok-str">{'"baselines/survey.csv"'}</span>
                          {")\n\noutliers <- results[results$zscore > "}
                          <span className="tok-num">{"2.5"}</span>
                          {", ]\ndigest <- sp$agent$summarize(outliers, baseline)\n\n"}
                          <span className="tok-key">{"sp$log$write("}</span>
                          <span className="tok-str">{'"notes.md"'}</span>
                          {", digest)\n"}
                          <span className="tok-key">{"sp$notify("}</span>
                          <span className="tok-str">{'"#study-updates"'}</span>
                          {", digest)"}
                        </code>
                        <code data-lang-panel="jl" hidden>
                          <span className="tok-com">
                            {"# Spindle mounts your project files automatically"}
                          </span>
                          {"\n"}
                          <span className="tok-key">{"using"}</span>
                          {" Spindle\n"}
                          <span className="tok-key">{"const"}</span>
                          {" sp = Spindle.project()\n\nresults = sp.files.read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {")\nbaseline = sp.files.read("}
                          <span className="tok-str">{'"baselines/survey.csv"'}</span>
                          {")\n\noutliers = results[results.zscore .> "}
                          <span className="tok-num">{"2.5"}</span>
                          {", :]\ndigest = sp.agent.summarize(outliers, baseline)\n\n"}
                          <span className="tok-key">{"sp.log.write("}</span>
                          <span className="tok-str">{'"notes.md"'}</span>
                          {", digest)\n"}
                          <span className="tok-key">{"sp.notify("}</span>
                          <span className="tok-str">{'"#study-updates"'}</span>
                          {", digest)"}
                        </code>
                      </pre>
                      <pre className="code-block" data-code-panel="script@v1.3" hidden>
                        <code>
                          <span className="tok-com">
                            {"# Spindle mounts your project files automatically"}
                          </span>
                          {"\n"}
                          <span className="tok-key">{"from"}</span>
                          {" spindle "}
                          <span className="tok-key">{"import"}</span>
                          {" project "}
                          <span className="tok-key">{"as"}</span>
                          {" sp\n"}
                          <span className="tok-key">{"import"}</span>
                          {" pandas "}
                          <span className="tok-key">{"as"}</span>
                          {" pd\n\nresults = sp.files.read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {')\n\noutliers = results[results["score"] > '}
                          <span className="tok-num">{"2.5"}</span>
                          {"]\ndigest = sp.agent.summarize(outliers)\n\nsp.log.write("}
                          <span className="tok-str">{'"notes.md"'}</span>
                          {", digest)\nsp.notify("}
                          <span className="tok-str">{'"#study-updates"'}</span>
                          {", digest)"}
                        </code>
                      </pre>
                      <pre className="code-block" data-code-panel="script@v1.2" hidden>
                        <code>
                          <span className="tok-com">
                            {"# Daily outlier check — results/latest.csv"}
                          </span>
                          {"\n"}
                          <span className="tok-key">{"from"}</span>
                          {" spindle "}
                          <span className="tok-key">{"import"}</span>
                          {" project "}
                          <span className="tok-key">{"as"}</span>
                          {" sp\n"}
                          <span className="tok-key">{"import"}</span>
                          {" pandas "}
                          <span className="tok-key">{"as"}</span>
                          {" pd\n\nresults = sp.files.read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {")\noutliers = results[results.zscore > "}
                          <span className="tok-num">{"2.5"}</span>
                          {
                            ']\noutliers.to_csv("output/outliers.csv", index=False)\n\nsp.log.write("notes.md", f"{len(outliers)} rows flagged")\nsp.notify("'
                          }
                          <span className="tok-str">{"#study-updates"}</span>
                          {'", "Outlier check finished")'}
                        </code>
                      </pre>
                      <pre className="code-block" data-code-panel="script@v1.1" hidden>
                        <code>
                          <span className="tok-com">{"# check_results.py — first pass"}</span>
                          {"\n"}
                          <span className="tok-key">{"from"}</span>
                          {" spindle "}
                          <span className="tok-key">{"import"}</span>
                          {" project "}
                          <span className="tok-key">{"as"}</span>
                          {" sp\n\nresults = sp.files.read("}
                          <span className="tok-str">{'"results/latest.csv"'}</span>
                          {
                            ')\nprint(f"rows: {len(results)}")\nsp.log.write("notes.md", "check_results ran")'
                          }
                        </code>
                      </pre>
                      <pre className="code-block" data-code-panel="env" hidden>
                        <code>
                          <span className="tok-com">{"# /project/spindle.toml"}</span>
                          {"\n["}
                          <span className="tok-key">{"runtime"}</span>
                          {"]\nimage = "}
                          <span className="tok-str">{'"python:3.12-slim"'}</span>
                          {"\ntimeout = "}
                          <span className="tok-str">{'"10m"'}</span>
                          {"\n\n["}
                          <span className="tok-key">{"secrets"}</span>
                          {"]\napi_key = "}
                          <span className="tok-str">{'"$SPINDLE_RESEARCH_KEY"'}</span>
                          {"\n\n["}
                          <span className="tok-key">{"alerts"}</span>
                          {"]\non_failure = "}
                          <span className="tok-str">{'"#lab-ops"'}</span>
                        </code>
                      </pre>
                      <div className="cron-actions">
                        <div className="cron-presets" aria-label="Cron presets">
                          <button type="button" data-cron="0 17 * * *">
                            Daily 17:00
                          </button>
                          <button type="button" data-cron="0 6 * * 1-5">
                            Weekdays 06:00
                          </button>
                          <button type="button" data-cron="30 9 * * 1">
                            Mondays 09:30
                          </button>
                          <button type="button" data-cron="*/15 * * * *">
                            Every 15 min
                          </button>
                        </div>
                      </div>
                    </div>
                    <aside className="cron-side">
                      <div className="cron-human">
                        <span className="panel-kicker">HUMAN TRANSLATION</span>
                        <p id="cronHuman">At 05:00 PM, every day</p>
                        <div className="cron-fields" id="cronFields"></div>
                        <div className="validation" id="cronValidation" role="status">
                          <svg className="icon icon--xs">
                            <use href="#i-check" />
                          </svg>{" "}
                          Valid 5-field cron
                        </div>
                        <div
                          className="dependency-check is-pending"
                          id="dependencyCheck"
                          role="status"
                          aria-label="Script dependency check"
                        >
                          <svg className="icon icon--xs" aria-hidden="true">
                            <use href="#i-cube" />
                          </svg>
                          <span>Checking script dependencies…</span>
                        </div>
                      </div>
                      <div className="terminal-card">
                        <div className="terminal-head">
                          <span>
                            <i></i>
                            <i></i>
                            <i></i>
                          </span>
                          <span className="mono">last run · 17:00</span>
                        </div>
                        <pre>
                          <span className="term-time">{"17:00:02"}</span>
                          {"  loading results/latest.csv\n"}
                          <span className="term-time">{"17:00:04"}</span>
                          {"  248 rows · 9 new\n"}
                          <span className="term-time">{"17:00:06"}</span>
                          {"  "}
                          <span className="term-warn">{"1 outlier flagged"}</span>
                          {"\n"}
                          <span className="term-time">{"17:00:07"}</span>
                          {"  digest → #study-updates\n"}
                          <span className="term-ok">{"✓ exited 0 in 6.4s"}</span>
                        </pre>
                      </div>
                      <div className="tz-row">
                        <label className="field">
                          <span>Timezone</span>
                          <select id="cronTz">
                            <option value="Europe/Berlin">Europe/Berlin</option>
                            <option value="UTC">UTC</option>
                            <option value="America/New_York">America/New_York</option>
                            <option value="Asia/Tokyo">Asia/Tokyo</option>
                          </select>
                        </label>
                      </div>
                      <button type="button" className="btn btn--primary btn--full" id="cronDeploy">
                        <svg className="icon icon--sm">
                          <use href="#i-terminal" />
                        </svg>{" "}
                        Deploy job
                      </button>
                      <div className="toast" id="cronToast" role="status" hidden></div>
                    </aside>
                  </div>
                </div>
              </div>
              <p className="studio-caption">
                <svg className="icon icon--xs">
                  <use href="#i-lock" />
                </svg>{" "}
                All three modes run inside the project. Files, secrets, and logs stay scoped to the
                workspace.
              </p>
              <p className="studio-caption">
                Scheduled jobs run under the <a href="/acceptable-use">Acceptable Use Policy</a> —
                no crypto mining, outbound spam, credential stuffing, or workloads unrelated to the
                project.
              </p>
            </div>
          </section>
          <section className="section section--alt guardrails-section" id="guardrails">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Under the hood</div>
                <h2 className="section-title">The boring parts, handled.</h2>
                <p className="section-desc">
                  An automation you forget about is worse than no automation. Every job — typed,
                  clicked, or scripted — gets the same operational backbone.
                </p>
              </div>
              <div className="guard-grid">
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-eye" />
                    </svg>
                  </span>
                  <h3>Preview before run</h3>
                  <p>
                    See the exact steps, files, and recipients first. Nothing is scheduled until you
                    say so.
                  </p>
                </article>
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-git" />
                    </svg>
                  </span>
                  <h3>Run history</h3>
                  <p>
                    Every execution keeps inputs, diffs, output, and timing. Rewind or re-run in one
                    click.
                  </p>
                </article>
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-lock" />
                    </svg>
                  </span>
                  <h3>Scoped secrets</h3>
                  <p>
                    Keys live in the project, not in your prompt or cron line. Rotate them without
                    editing jobs.
                  </p>
                </article>
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-globe" />
                    </svg>
                  </span>
                  <h3>Timezone aware</h3>
                  <p>5 PM means 5 PM where your team works. DST shifts are handled for you.</p>
                </article>
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <h3>Failure alerts</h3>
                  <p>
                    Get a message when a run fails, times out, or flags something that needs a
                    human.
                  </p>
                </article>
                <article className="guard-card" data-reveal>
                  <span className="guard-icon">
                    <svg className="icon">
                      <use href="#i-folder" />
                    </svg>
                  </span>
                  <h3>Project context</h3>
                  <p>
                    Jobs see the right files, notes, and channel history — no copy-pasted paths or
                    API tokens.
                  </p>
                </article>
              </div>
            </div>
          </section>
          <section className="section rhythm-section" id="rhythm">
            <div className="rhythm-grid container">
              <div className="rhythm-copy" data-reveal>
                <div className="eyebrow">A day in the life</div>
                <h2 className="section-title">Your project keeps its promises.</h2>
                <p className="section-desc">
                  Automations run quietly in the background of every Spindle project. You show up to
                  the interesting part: the result.
                </p>
                <ol className="timeline">
                  <li>
                    <span className="tl-time">06:00</span>
                    <span className="tl-dot"></span>
                    <strong>Sources refreshed</strong>
                    <small>New PDFs pulled into the shared folder.</small>
                  </li>
                  <li>
                    <span className="tl-time">12:30</span>
                    <span className="tl-dot"></span>
                    <strong>Notebook snapshot</strong>
                    <small>The lab saved the current analysis state.</small>
                  </li>
                  <li className="is-hot">
                    <span className="tl-time">17:00</span>
                    <span className="tl-dot"></span>
                    <strong>Results checked</strong>
                    <small>Nine new records, one flagged for review.</small>
                  </li>
                  <li>
                    <span className="tl-time">17:01</span>
                    <span className="tl-dot"></span>
                    <strong>Digest delivered</strong>
                    <small>A two-paragraph summary in #study-updates.</small>
                  </li>
                </ol>
              </div>
              <div className="rhythm-visual" data-reveal data-reveal-delay="100">
                <div className="digest-window product-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">#study-updates</span>
                    <span className="window-bar-status">Today</span>
                  </div>
                  <div className="digest-body">
                    <div className="digest-message">
                      <span className="digest-avatar">
                        <svg className="icon icon--xs">
                          <use href="#i-sparkle" />
                        </svg>
                      </span>
                      <div>
                        <div className="digest-meta">
                          <strong>Spindle</strong>
                          <span className="mono">17:01</span>
                          <span className="auto-tag">automation</span>
                        </div>
                        <h4>Daily results · coastal resilience</h4>
                        <p>
                          9 new survey entries landed today. Turbidity is up 12% at station 4 —
                          that's outside the usual range and worth a look.
                        </p>
                        <div className="digest-stat">
                          <span>
                            <strong>9</strong> new entries
                          </span>
                          <span>
                            <strong>1</strong> flagged
                          </span>
                          <span>
                            <strong>248</strong> total
                          </span>
                        </div>
                        <div className="digest-actions">
                          <button type="button">
                            Open results{" "}
                            <svg className="icon icon--xs">
                              <use href="#i-arrow-up-right" />
                            </svg>
                          </button>
                          <button type="button">Snooze until tomorrow</button>
                        </div>
                      </div>
                    </div>
                    <div className="digest-line">
                      <span></span>
                    </div>
                    <div className="digest-quiet">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>{" "}
                      3 automations ran today · all healthy
                    </div>
                  </div>
                </div>
                <div className="rhythm-glow" aria-hidden="true"></div>
              </div>
            </div>
          </section>
          <section className="cta-section" id="get-started">
            <div className="container">
              <div className="cta-box auto-cta">
                <div className="cta-orbit" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="eyebrow">READY WHEN YOU ARE</div>
                <h2>Your next 5 PM can take care of itself.</h2>
                <p>
                  Bring the project. Text the first automation in under a minute — no
                  infrastructure, no cron crate, no babysitting.
                </p>
                <div className="cta-actions">
                  <a href="#studio" className="btn btn--primary btn--lg">
                    Build your first one{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="/sign-up" className="btn btn--ghost btn--lg">
                    Start a free workspace
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>

        <PageInteractions page="automations" />
      </div>
    </PageTransition>
  )
}
