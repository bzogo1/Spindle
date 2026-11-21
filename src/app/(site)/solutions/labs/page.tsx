import "../../../styles/pages.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Solutions for Research Labs — Spindle",
  description:
    "Shared notebooks, one source of truth: a lab runs on handoffs, and Spindle keeps the handoff inside the project.",
  path: "/solutions/labs",
})

const OTHER_SOLUTIONS = [
  { href: "/solutions/researchers", title: "Individual researchers", body: "A quiet place for one project." },
  { href: "/solutions/teams", title: "Research teams", body: "Channels, roles, and presence in the project." },
  { href: "/solutions/institutions", title: "Institutions", body: "Central billing and easy onboarding." },
]

export default function LabsSolutionPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Solutions · Research labs</div>
            <h1 className="page-title">Shared notebooks, one source of truth.</h1>
            <p className="page-lede">
              A lab runs on handoffs. Spindle keeps the handoff inside the project instead of in
              someone&apos;s inbox — every session, notebook, and result lives in the same place.
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
                <h3>Work in the same session</h3>
                <p>Lab sessions are shared, so a result is never stuck on one person&apos;s machine.</p>
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
                  Automations and files live together, making it easier to see how a result was
                  made.
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
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">For the whole lab</div>
              <h2 className="section-title">Collaboration without the overhead.</h2>
            </div>
            <div className="feature-grid">
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-layers" />
                  </svg>
                </span>
                <h3>Shared sessions</h3>
                <p>
                  Everyone joins the same lab session — shared kernels, live cursors, and comments
                  mean questions get answered where the work is happening.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>Automations for routine work</h3>
                <p>
                  Plain-language automations and cron jobs handle repetitive data steps, so the
                  method stays visible and repeatable.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-message" />
                  </svg>
                </span>
                <h3>Discussion in context</h3>
                <p>
                  Project channels sit beside the notebooks and files they discuss, with optional
                  anonymous mode for sensitive topics.
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
              <h2>Bring your lab onto one workspace.</h2>
              <p>Start with a free workspace, then invite the whole group when you&apos;re ready.</p>
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
