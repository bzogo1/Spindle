import "../../../styles/pages.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Solutions for Research Teams — Spindle",
  description:
    "Channels, roles, and presence in the project: give a distributed team a single place to coordinate the work and talk about it.",
  path: "/solutions/teams",
})

const OTHER_SOLUTIONS = [
  { href: "/solutions/researchers", title: "Individual researchers", body: "A quiet place for one project." },
  { href: "/solutions/labs", title: "Research labs", body: "Shared notebooks and one source of truth." },
  { href: "/solutions/institutions", title: "Institutions", body: "Central billing and easy onboarding." },
]

export default function TeamsSolutionPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Solutions · Research teams</div>
            <h1 className="page-title">Channels, roles, and presence in the project.</h1>
            <p className="page-lede">
              Give a distributed team a single place to coordinate the work and talk about it —
              chat, files, and automations live in the same workspace, not in separate apps.
            </p>
            <div className="page-actions">
              <a href="/sign-up" className="btn btn--primary btn--lg">
                Create free workspace{" "}
                <svg className="icon icon--xs" aria-hidden="true">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
              <a href="/solutions" className="btn btn--ghost btn--lg">
                All solutions
              </a>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="duo-grid">
              <div className="duo-card">
                <span className="duo-badge">HOW IT HELPS</span>
                <h3>Talk where the work happens</h3>
                <p>Team chat is part of the workspace, not another app to keep open.</p>
                <ul className="check-list">
                  <li>Channels scoped to each project</li>
                  <li>Presence indicators and shared context</li>
                  <li>Optional anonymous mode (Nym Mixnet routing planned)</li>
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
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">For distributed teams</div>
              <h2 className="section-title">One workspace, every timezone.</h2>
            </div>
            <div className="feature-grid">
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-message" />
                  </svg>
                </span>
                <h3>Chat in context</h3>
                <p>
                  Channels are scoped to each project, with presence indicators and shared
                  context — plus optional anonymous mode for sensitive topics.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-users" />
                  </svg>
                </span>
                <h3>Roles that fit</h3>
                <p>
                  Invite collaborators into the project itself, with clear ownership as the team
                  grows and changes — no separate drive to manage.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>Work that runs itself</h3>
                <p>
                  Automations handle routine data steps and the agent takes repetitive edits,
                  leaving the team free for the parts that need humans.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Other solutions</div>
              <h2 className="section-title">Spindle grows with your work.</h2>
            </div>
            <div className="feature-grid">
              {OTHER_SOLUTIONS.map((solution) => (
                <a key={solution.href} href={solution.href} className="feature-card">
                  <h3>{solution.title}</h3>
                  <p>{solution.body}</p>
                </a>
              ))}
            </div>
          </div>
        </section>
        <section className="cta-section">
          <div className="container">
            <div className="cta-box">
              <h2>Give your team a single place to work.</h2>
              <p>Start with a free workspace and invite collaborators when you&apos;re ready.</p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
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
    </PageTransition>
  )
}
