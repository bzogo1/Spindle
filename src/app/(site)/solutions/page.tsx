import type { Metadata } from "next"
import "../../styles/pages.css"

export const metadata: Metadata = {
  title: "Solutions — Spindle",
  description:
    "How individual researchers, labs, teams, and institutions use Spindle as a shared research workspace.",
}

export default function SolutionsPage() {
  return (
    <main id="top" className="page-main">
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">Solutions</div>
          <h1 className="page-title">One workspace, shaped around how you work.</h1>
          <p className="page-lede">
            A solo field project and a department-wide program need different things. Spindle starts
            as a project home and grows into shared infrastructure when you do.
          </p>
          <div className="page-actions">
            <a href="/about#contact" className="btn btn--primary btn--lg">
              Talk to us{" "}
              <svg className="icon icon--xs" aria-hidden="true">
                <use href="#i-arrow-right" />
              </svg>
            </a>
            <a href="/pricing" className="btn btn--ghost btn--lg">
              See pricing
            </a>
          </div>
        </div>
      </section>
      <section className="section" id="researchers">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">For one researcher</div>
            <h2 className="section-title">A quiet place for one project.</h2>
            <p className="section-desc">
              Keep the data, drafts, and sources for a single study together without building your
              own folder convention.
            </p>
          </div>
          <div className="duo-grid">
            <div className="duo-card">
              <span className="duo-badge">HOW IT HELPS</span>
              <h3>Start with a folder</h3>
              <p>A free workspace gives you the full toolset from day one.</p>
              <ul className="check-list">
                <li>5 GB of storage for one active project</li>
                <li>A lab that boots with the project files</li>
                <li>Academic and Basic search beside your notes</li>
                <li>20 agent requests every day</li>
              </ul>
            </div>
            <div className="duo-card">
              <span className="duo-badge duo-badge--amber">AS YOU GROW</span>
              <h3>When the project grows</h3>
              <p>The same workspace becomes a shared one when collaborators arrive.</p>
              <ul className="check-list">
                <li>Invite people into the project, not a separate drive</li>
                <li>Keep earlier versions and outputs in place</li>
                <li>Add storage without moving the file tree</li>
                <li>Archive completed work on your own terms</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section className="section section--alt" id="labs">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">For research labs</div>
            <h2 className="section-title">Shared notebooks, one source of truth.</h2>
            <p className="section-desc">
              A lab runs on handoffs. Spindle keeps the handoff inside the project instead of in
              someone's inbox.
            </p>
          </div>
          <div className="duo-grid">
            <div className="duo-card">
              <span className="duo-badge">HOW IT HELPS</span>
              <h3>Work in the same session</h3>
              <p>Lab sessions are shared, so a result is never stuck on one person's machine.</p>
              <ul className="check-list">
                <li>Shared kernels, live cursors, and comments</li>
                <li>Notebooks connected to the project file tree</li>
                <li>Inline previews for datasets and figures</li>
                <li>Project channels for discussion in context</li>
              </ul>
            </div>
            <div className="duo-card">
              <span className="duo-badge duo-badge--amber">AS YOU GROW</span>
              <h3>Keep the method visible</h3>
              <p>
                Automations and files live together, making it easier to see how a result was made.
              </p>
              <ul className="check-list">
                <li>Plain-language automations or cron jobs</li>
                <li>Sources and citations saved with the analysis</li>
                <li>A readable history of project activity</li>
                <li>Optional anonymous chat for sensitive topics</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section className="section" id="teams">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">For research teams</div>
            <h2 className="section-title">Channels, roles, and presence in the project.</h2>
            <p className="section-desc">
              Give a distributed team a single place to coordinate the work and talk about it.
            </p>
          </div>
          <div className="duo-grid">
            <div className="duo-card">
              <span className="duo-badge">HOW IT HELPS</span>
              <h3>Talk where the work happens</h3>
              <p>Team chat is part of the workspace, not another app to keep open.</p>
              <ul className="check-list">
                <li>Channels scoped to each project</li>
                <li>Presence indicators and shared context</li>
                <li>Optional anonymous mode routed through Nym</li>
                <li>Notes and links kept beside the conversation</li>
              </ul>
            </div>
            <div className="duo-card">
              <span className="duo-badge duo-badge--amber">AS YOU GROW</span>
              <h3>Coordinate without ceremony</h3>
              <p>Recurring work lives with the project it belongs to.</p>
              <ul className="check-list">
                <li>Automations for routine data steps</li>
                <li>Agent requests for repetitive edits</li>
                <li>One file tree for every artifact</li>
                <li>Clear ownership as the team changes</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section className="section section--alt" id="institutions">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">For institutions</div>
            <h2 className="section-title">Room for a whole research group.</h2>
            <p className="section-desc">
              Shared controls and central billing for departments that support many projects at
              once.
            </p>
          </div>
          <div className="duo-grid">
            <div className="duo-card">
              <span className="duo-badge">HOW IT HELPS</span>
              <h3>One place to manage</h3>
              <p>Bring several labs onto the same workspace without fragmenting their projects.</p>
              <ul className="check-list">
                <li>Shared workspaces and roles</li>
                <li>Central billing and pooled storage</li>
                <li>Onboarding for a lab or department</li>
                <li>Consistent project structure across groups</li>
              </ul>
            </div>
            <div className="duo-card">
              <span className="duo-badge duo-badge--amber">AS YOU GROW</span>
              <h3>Built to last</h3>
              <p>Projects stay readable long after the original team has moved on.</p>
              <ul className="check-list">
                <li>Files and previews remain intact</li>
                <li>Notes and conversations stay with the project</li>
                <li>Archives stay on your own terms</li>
                <li>A single place to hand work over</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section className="cta-section">
        <div className="container">
          <div className="cta-box">
            <h2>Give your research a place to live.</h2>
            <p>Start with 5 GB, a lab, local search, and 20 agent requests a day.</p>
            <div className="cta-actions">
              <a href="/#get-started" className="btn btn--primary btn--lg">
                Create free workspace
              </a>
              <a href="/about#contact" className="btn btn--ghost btn--lg">
                Talk to us
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
