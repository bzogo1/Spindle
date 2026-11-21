import "../../../styles/pages.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Solutions for Individual Researchers — Spindle",
  description:
    "A quiet place for one project: keep data, drafts, and sources together in a free research workspace.",
  path: "/solutions/researchers",
})

const OTHER_SOLUTIONS = [
  { href: "/solutions/labs", title: "Research labs", body: "Shared notebooks and one source of truth." },
  { href: "/solutions/teams", title: "Research teams", body: "Channels, roles, and presence in the project." },
  { href: "/solutions/institutions", title: "Institutions", body: "Central billing and easy onboarding." },
]

export default function ResearchersSolutionPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Solutions · Individual researchers</div>
            <h1 className="page-title">A quiet place for one project.</h1>
            <p className="page-lede">
              Keep the data, drafts, and sources for a single study together without building your
              own folder convention. Spindle starts as a project home and grows into shared
              infrastructure when you do.
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
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Built for one person</div>
              <h2 className="section-title">Everything a solo project needs.</h2>
            </div>
            <div className="feature-grid">
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-folder" />
                  </svg>
                </span>
                <h3>One file tree</h3>
                <p>
                  Data, scripts, drafts, and figures live in a single tree that the lab boots
                  with — no syncing, no "final_v2" folders.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>A lab that boots</h3>
                <p>
                  Shared kernels, notebooks, and a terminal are attached to the project, so the
                  environment is ready the moment you open it.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon" aria-hidden="true">
                    <use href="#i-search" />
                  </svg>
                </span>
                <h3>Search beside your notes</h3>
                <p>
                  Academic and Basic search sit next to your notes and citations, so sources stay
                  attached to the claims they support.
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
              <h2>Give your research a place to live.</h2>
              <p>Start with 5 GB, a lab, local search, and 20 agent requests a day.</p>
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
