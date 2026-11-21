import "../../../styles/pages.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Solutions for Institutions — Spindle",
  description:
    "Room for a whole research group: shared controls and central billing for departments that support many projects at once.",
  path: "/solutions/institutions",
})

const OTHER_SOLUTIONS = [
  { href: "/solutions/researchers", title: "Individual researchers", body: "A quiet place for one project." },
  { href: "/solutions/labs", title: "Research labs", body: "Shared notebooks and one source of truth." },
  { href: "/solutions/teams", title: "Research teams", body: "Channels, roles, and presence in the project." },
]

export default function InstitutionsSolutionPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Solutions · Institutions</div>
            <h1 className="page-title">Room for a whole research group.</h1>
            <p className="page-lede">
              Shared controls and central billing for departments that support many projects at
              once — bring several labs onto the same workspace without fragmenting their work.
            </p>
            <div className="page-actions">
              <a href="/about#contact" className="btn btn--primary btn--lg">
                Talk to us{" "}
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
                <h3>One place to manage</h3>
                <p>
                  Bring several labs onto the same workspace without fragmenting their projects.
                </p>
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
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">For departments</div>
              <h2 className="section-title">Consistency at institutional scale.</h2>
            </div>
            <div className="feature-grid">
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-shield" />
                  </svg>
                </span>
                <h3>Shared controls</h3>
                <p>
                  Shared workspaces and roles give the department one consistent structure across
                  labs, with central billing and pooled storage.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-server" />
                  </svg>
                </span>
                <h3>Simple onboarding</h3>
                <p>
                  Onboarding for a whole lab or department is a single step — projects arrive
                  with the same layout, tools, and conventions.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-lock" />
                  </svg>
                </span>
                <h3>Projects that outlive teams</h3>
                <p>
                  Files, previews, notes, and conversations stay with the project, so work remains
                  readable and archivable on your own terms.
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
              <h2>Bring your institution onto Spindle.</h2>
              <p>Talk to us about onboarding a lab or an entire department.</p>
              <div className="cta-actions">
                <a href="/about#contact" className="btn btn--primary btn--lg">
                  Talk to us
                </a>
                <a href="/pricing" className="btn btn--ghost btn--lg">
                  See pricing
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
