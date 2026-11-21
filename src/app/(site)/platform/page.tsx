import "../../styles/pages.css"
import Link from "next/link"

import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Platform — Spindle",
  description:
    "Files, a live lab, local search, automations, an agent, and team chat — one home for every research project.",
  path: "/platform",
})

export default function PlatformPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Platform</div>
            <h1 className="page-title">One workspace, end to end.</h1>
            <p className="page-lede">
              Spindle keeps the messy middle of research — data, notebooks, sources, and
              conversations — in one project-shaped home. Each link below opens a live preview on
              the homepage.
            </p>
            <div className="page-actions">
              <a href="/sign-up" className="btn btn--primary btn--lg">
                Start free{" "}
                <svg className="icon icon--xs" aria-hidden="true">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
              <a href="/docs" className="btn btn--ghost btn--lg">
                Read the docs
              </a>
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">The workspace</div>
              <h2 className="section-title">Everything a project needs, together.</h2>
              <p className="section-desc">
                Six tools that share the same files, the same history, and the same project.
              </p>
            </div>
            <div className="feature-grid">
              <Link href="/#files" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-folder" />
                  </svg>
                </span>
                <h3>Files</h3>
                <p>5 GB free, a clean file manager, and inline previews for 100+ formats.</p>
              </Link>
              <Link href="/lab" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>Live lab</h3>
                <p>Notebooks, R, SQL, and more in the browser — already connected to your files.</p>
              </Link>
              <Link href="/#search" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-search" />
                  </svg>
                </span>
                <h3>Local search</h3>
                <p>Academic and Basic modes run through SearXNG hosted alongside Spindle.</p>
              </Link>
              <Link href="/automations" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>Automations</h3>
                <p>Text it, build it, or write the cron yourself.</p>
              </Link>
              <Link href="/agent" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-sparkle" />
                  </svg>
                </span>
                <h3>Agent</h3>
                <p>
                  Ask it to refactor a pipeline, edit a sheet, move a folder, or summarize new
                  sources.
                </p>
              </Link>
              <Link href="/#chat" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-message" />
                  </svg>
                </span>
                <h3>Team chat</h3>
                <p>Channels live inside each project, with an optional anonymous mode.</p>
              </Link>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Design choices</div>
              <h2 className="section-title">Built around the project, not the tab.</h2>
            </div>
            <div className="duo-grid">
              <div className="duo-card">
                <span className="duo-badge">ONE HOME</span>
                <h3>Keep the context</h3>
                <p>Notes, results, and decisions stay next to the files they describe.</p>
                <ul className="check-list">
                  <li>A single file tree for the whole project</li>
                  <li>Lab sessions open on the same data</li>
                  <li>Search results and citations saved in place</li>
                  <li>Channels scoped to the work at hand</li>
                </ul>
              </div>
              <div className="duo-card">
                <span className="duo-badge duo-badge--amber">LOCAL BY DEFAULT</span>
                <h3>Keep it close</h3>
                <p>The useful parts of the workspace run alongside your data.</p>
                <ul className="check-list">
                  <li>SearXNG hosted with your workspace</li>
                  <li>Optional anonymity (Nym Mixnet routing planned)</li>
                  <li>No advertising profile built from searches</li>
                  <li>Storage you can archive on your own terms</li>
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
