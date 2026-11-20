import "../../styles/pages.css"

import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const description =
  "What Spindle is, why we built it, and how the workspace fits a full research project."

export const metadata = createPageMetadata({
  title: "About — Spindle",
  description,
  path: "/about",
})

export default function AboutPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">About</div>
            <h1 className="page-title">One workspace for the whole project.</h1>
            <p className="page-lede">
              Spindle is a research workspace. Files, notebooks, sources, automations, an agent, and
              the people you work with all stay attached to the project they belong to — free to
              start, local where it matters, and quiet enough to think in.
            </p>
            <div className="page-actions">
              <a href="/sign-up" className="btn btn--primary">
                Start free
              </a>
              <a href="/platform" className="btn btn--ghost">
                See everything inside
              </a>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Why we built it</div>
              <h2 className="section-title">
                The tools we had were never quite the tool we needed.
              </h2>
              <p className="section-desc">
                Research work is not writing, and it is not a meeting. It is a dataset, a notebook,
                a pile of sources, and a long trail of decisions that all have to survive together
                for months. The software we tried always handled one slice of that.
              </p>
            </div>
            <div className="duo-grid">
              <div className="duo-card">
                <span className="duo-badge">WHAT WE TRIED</span>
                <h3>Close, but built for something else</h3>
                <p>
                  MS Teams does chat and calls, but it is licensed per seat, aimed at company-wide
                  communication, and your actual project still lives in a folder somewhere else.
                  Notion is a good place to write things down, but it cannot run the notebook, open
                  the dataset, search your sources, or hold a project together for the six months it
                  takes to finish.
                </p>
              </div>
              <div className="duo-card">
                <span className="duo-badge duo-badge--amber">WHAT WE BUILT</span>
                <h3>A project, opened in one place</h3>
                <p>
                  Spindle puts the working parts of a project in the same window: files with
                  previews, a lab for notebooks, search across your sources, automations that keep
                  data fresh, an agent on call, and the conversation about the work. Nothing has to
                  be reassembled when you come back to it.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">What's inside</div>
              <h2 className="section-title">Six parts, one project.</h2>
              <p className="section-desc">
                Every page on this site is a view into the same workspace. Start from a file, follow
                it into a notebook, cite it in a note, then schedule the step that keeps it current.
              </p>
            </div>
            <div className="feature-grid">
              <a href="/#files" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-folder" />
                  </svg>
                </span>
                <h3>Files that open</h3>
                <p>
                  5 GB free, with more than a hundred inline previews for data, PDFs, images, and
                  code.
                </p>
              </a>
              <a href="/lab" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>A lab, not a scratchpad</h3>
                <p>
                  Jupyter notebooks, R, SQL, canvas, graphs, and math — all running against the
                  project's own files.
                </p>
              </a>
              <a href="/#search" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-search" />
                  </svg>
                </span>
                <h3>Search you host</h3>
                <p>
                  Academic and Basic modes, run locally, with every result tied back to the source
                  it came from.
                </p>
              </a>
              <a href="/automations" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>Routines that run</h3>
                <p>
                  Describe a repeated step in plain language or write the cron yourself. The
                  automation lives with the project.
                </p>
              </a>
              <a href="/agent" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-sparkle" />
                  </svg>
                </span>
                <h3>An agent with limits</h3>
                <p>
                  20 requests a day on the free plan, and 50 more for a referral. It reads the
                  project, edits and moves files, and never acts without you.
                </p>
              </a>
              <a href="/collaboration" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-users" />
                  </svg>
                </span>
                <h3>People in the same file</h3>
                <p>
                  Live cursors, roles, shared editing, and project channels — with anonymity
                  available where it helps.
                </p>
              </a>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">How it behaves</div>
              <h2 className="section-title">Made to be lived in, not managed.</h2>
              <p className="section-desc">
                A workspace you keep coming back to should get out of the way. These are the choices
                behind the one we built.
              </p>
            </div>
            <div className="feature-grid">
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-layers" />
                  </svg>
                </span>
                <h3>Context over features</h3>
                <p>The reasoning stays next to the result, so the project explains itself later.</p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-shield" />
                  </svg>
                </span>
                <h3>Local by default</h3>
                <p>
                  Searches run on your own machine and the index stays yours. Anonymous chat is
                  there when a project needs it.
                </p>
              </div>
              <div className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-clock" />
                  </svg>
                </span>
                <h3>Made to last</h3>
                <p>
                  Plain files, readable output, and no lock-in on the work you have already
                  finished.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="section section--alt" id="contact">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Contact</div>
              <h2 className="section-title">Questions about the workspace?</h2>
              <p className="section-desc">
                Two ways to go further: write to us about a lab, a team, or a department-wide
                workspace, or just put a real project in and see how it feels.
              </p>
            </div>
            <div className="contact-grid">
              <div className="contact-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-message" />
                  </svg>
                </span>
                <h3>Send a message</h3>
                <p>
                  Use the contact form for product questions, onboarding, or a walkthrough of your
                  team&apos;s workflow — or write to us directly.
                </p>
                <a className="text-link" href="/contact">
                  Open the contact form{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a className="text-link" href="mailto:hello@spindle.example">
                  hello@spindle.example{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
              <div className="contact-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-users" />
                  </svg>
                </span>
                <h3>Bring a project</h3>
                <p>
                  The fastest way to understand Spindle is to put a real project in it. Five
                  gigabytes are free.
                </p>
                <a className="text-link" href="/sign-up">
                  Create a free workspace{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
