import "../../styles/pages.css"

import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const description =
  "What Spindle is, why we built it for researchers who can't pay for more software, and how the workspace fits a full research project."

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
            <h1 className="page-title">Research tools shouldn&apos;t cost more than the research.</h1>
            <p className="page-lede">
              Spindle is a free research workspace. Files, notebooks, sources, automations, an agent,
              and the people you work with all stay attached to the project they belong to — free to
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
            <div className="stats-grid" data-reveal>
              <div className="stat">
                <div className="stat-value">
                  $<span className="counter" data-target="0">
                    0
                  </span>
                </div>
                <p>What every plan costs</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  <span className="counter" data-target="5">
                    5
                  </span>
                  <span className="stat-suffix"> GB</span>
                </div>
                <p>Storage per account</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  <span className="counter" data-target="20">
                    20
                  </span>
                </div>
                <p>Agent requests every day</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  <span className="counter" data-target="100">
                    100
                  </span>
                  <span className="stat-suffix">+</span>
                </div>
                <p>File formats detected inline</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt">
          <div className="container">
            <div className="section-head" data-reveal>
              <div className="eyebrow">Why we built it</div>
              <h2 className="section-title">
                The tools we had were never quite the tool we needed.
              </h2>
              <p className="section-desc">
                Research work is not writing, and it is not a meeting. It is a dataset, a notebook,
                a pile of sources, and a long trail of decisions that all have to survive together
                for months. The software we tried always handled one slice of that — and charged for
                the privilege.
              </p>
            </div>
            <div className="duo-grid">
              <article className="duo-card" data-reveal>
                <span className="duo-badge">WHAT WE TRIED</span>
                <h3>Close, but built for something else</h3>
                <p>
                  Notion is genuinely good at holding notes. But a research project is not a
                  document — it is data files, notebook runs, a literature pile, scheduled jobs,
                  and the conversation about all of it. Notion can describe that work; it cannot do
                  it. There is no lab, no local search, and no way for the project to run anything.
                </p>
                <ul className="check-list">
                  <li>Notion holds the notes, not the work</li>
                  <li>Chat tools bill per seat and forget the files</li>
                  <li>The notebook, the data, and the chat end up in three products</li>
                  <li>Nothing survives when the grant or the licence does</li>
                </ul>
              </article>
              <article className="duo-card" data-reveal>
                <span className="duo-badge duo-badge--amber">WHAT WE BUILT</span>
                <h3>A project, opened in one place</h3>
                <p>
                  Spindle puts the working parts of a project in the same window: files with
                  previews, a lab for notebooks, search across your sources, automations that keep
                  data fresh, an agent on call, and the conversation about the work. Nothing has to
                  be reassembled when you come back to it.
                </p>
                <ul className="check-list">
                  <li>Files, notebooks, search, and chat in one workspace</li>
                  <li>Automations and an agent that work on the project itself</li>
                  <li>Local search modes that keep the index yours</li>
                  <li>Plain files you can export whenever you want</li>
                </ul>
                <a href="/platform" className="text-link">
                  See the whole platform{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head" data-reveal>
              <div className="eyebrow">Who it&apos;s for</div>
              <h2 className="section-title">For people the software industry forgot.</h2>
              <p className="section-desc">
                Most research tools are priced for companies, not for the person with a folder of
                data and a question. Spindle is built for the other side of that invoice.
              </p>
            </div>
            <div className="feature-grid">
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>Grad students &amp; independents</h3>
                <p>
                  No lab budget, no institutional licence, no credit card. The full workspace is
                  free, so the research can start before the funding does.
                </p>
              </div>
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-users" />
                  </svg>
                </span>
                <h3>Small labs &amp; groups</h3>
                <p>
                  Collaborate without per-seat pricing. Roles, shared editing, and project channels
                  scale with the team you actually have — not the team a vendor wants you to buy.
                </p>
              </div>
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-layers" />
                  </svg>
                </span>
                <h3>Researchers who outgrew docs</h3>
                <p>
                  If your project lives in forty Notion pages and a Drive folder, you already know
                  what is missing. Spindle is the workspace those pages were pointing at.
                </p>
              </div>
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-shield" />
                  </svg>
                </span>
                <h3>People who read the privacy policy</h3>
                <p>
                  Search runs locally, the index stays on your machine, and there are no ads or data
                  sales. Your sources are inputs, not a product.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt">
          <div className="pricing-story container">
            <div className="eyebrow">The story so far</div>
            <h2 className="section-title">
              We got tired of paying rent on our own work.
            </h2>
            <p>
              Like most research groups, we started with the free tier of everything: a docs tool
              for notes, a chat app for questions, a notebook somewhere else, and a folder of files
              nobody could quite find. Each piece was fine on its own. Together they were a project
              scattered across four logins, with the actual reasoning — the part that makes the work
              reproducible — living in someone&apos;s Downloads folder.
            </p>
            <p>
              The tools that could hold a whole project wanted money we did not have: per-seat
              licences, storage upsells, seat minimums for a team of three. The free tools were
              either too simple to run a project or too complicated to trust with one. Notion was
              the closest thing — clean, fast, pleasant — but it is a writing tool. It can hold a
              beautifully organised description of your research. It cannot run the notebook, open
              the dataset, search the sources, or keep any of it together when the project gets
              real.
            </p>
            <blockquote className="pricing-pullquote">
              A workspace should hold the work, not just the notes about the work.
            </blockquote>
            <p>
              So we built the thing we needed: one place where the files, the lab, the search, the
              automations, and the conversation all belong to the same project — and where the
              price of admission is a signup form, not a purchase order. Spindle is that workspace,
              and it is free because the people it is for usually cannot pay.
            </p>
            <p>
              <a href="/pricing#how-spindle-is-funded" className="text-link">
                Read how Spindle stays free{" "}
                <svg className="icon icon--xs" aria-hidden="true">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head" data-reveal>
              <div className="eyebrow">What we believe</div>
              <h2 className="section-title">Principles the product is built on.</h2>
              <p className="section-desc">
                These are not values on a wall. Each one shows up in a specific decision about what
                Spindle does — and what it refuses to do.
              </p>
            </div>
            <ul className="pricing-principles">
              <li data-reveal>
                <span>
                  <strong>Free means free.</strong> Every feature is on the $0 plan. There is no
                  paid unlock, no seat minimum, and no feature held behind a payment form.
                </span>
              </li>
              <li data-reveal>
                <span>
                  <strong>Your research is not the product.</strong> No ads, no data sales, no
                  engagement tricks. The workspace exists to hold work, not to harvest attention.
                </span>
              </li>
              <li data-reveal>
                <span>
                  <strong>Local where it counts.</strong> Search runs on your machine and the index
                  stays yours. Sensitive sources never have to leave your side to be useful.
                </span>
              </li>
              <li data-reveal>
                <span>
                  <strong>Plain files, no lock-in.</strong> Your work is stored in formats you can
                  open elsewhere. Leave anytime and take everything with you.
                </span>
              </li>
              <li data-reveal>
                <span>
                  <strong>The agent works for you, not instead of you.</strong> It reads the project,
                  proposes changes as reviewable diffs, and never acts without your say-so.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="section section--alt">
          <div className="container">
            <div className="section-head" data-reveal>
              <div className="eyebrow">What&apos;s inside</div>
              <h2 className="section-title">Six parts, one project.</h2>
              <p className="section-desc">
                Every page on this site is a view into the same workspace. Start from a file, follow
                it into a notebook, cite it in a note, then schedule the step that keeps it current.
              </p>
            </div>
            <div className="feature-grid">
              <a href="/#files" className="feature-card" data-reveal>
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
              <a href="/lab" className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>A lab, not a scratchpad</h3>
                <p>
                  Jupyter notebooks, R, SQL, canvas, graphs, and math — all running against the
                  project&apos;s own files.
                </p>
              </a>
              <a href="/#search" className="feature-card" data-reveal>
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
              <a href="/automations" className="feature-card" data-reveal>
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
              <a href="/agent" className="feature-card" data-reveal>
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
              <a href="/collaboration" className="feature-card" data-reveal>
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
            <div className="section-head" data-reveal>
              <div className="eyebrow">How it behaves</div>
              <h2 className="section-title">Made to be lived in, not managed.</h2>
              <p className="section-desc">
                A workspace you keep coming back to should get out of the way. These are the choices
                behind the one we built.
              </p>
            </div>
            <div className="feature-grid">
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-layers" />
                  </svg>
                </span>
                <h3>Context over features</h3>
                <p>The reasoning stays next to the result, so the project explains itself later.</p>
              </div>
              <div className="feature-card" data-reveal>
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
              <div className="feature-card" data-reveal>
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
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>No engagement tricks</h3>
                <p>
                  No streaks, no infinite feeds, no notifications designed to pull you back. Spindle
                  waits until you need it.
                </p>
              </div>
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-terminal" />
                  </svg>
                </span>
                <h3>Boring where it counts</h3>
                <p>
                  Storage, permissions, and run history are engineered to be dependable, not
                  delightful. The interesting parts are the research.
                </p>
              </div>
              <div className="feature-card" data-reveal>
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-pen" />
                  </svg>
                </span>
                <h3>Yours to shape</h3>
                <p>
                  APIs, webhooks, and an open surface for the people who want to extend the
                  workspace instead of waiting for a feature request to be heard.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-box" data-reveal>
              <h2>Your project deserves a home that doesn&apos;t invoice you.</h2>
              <p>
                Five gigabytes, a lab, local search, and an agent that answers to you — all free.
                Bring the folder of files and the half-written paper, and see how it feels.
              </p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create a free workspace
                </a>
                <a href="/pricing" className="btn btn--ghost btn--lg">
                  How the free plan works
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="contact">
          <div className="container">
            <div className="section-head" data-reveal>
              <div className="eyebrow">Contact</div>
              <h2 className="section-title">Questions about the workspace?</h2>
              <p className="section-desc">
                Two ways to go further: write to us about a lab, a team, or a department-wide
                workspace, or just put a real project in and see how it feels.
              </p>
            </div>
            <div className="contact-grid">
              <div className="contact-card" data-reveal>
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
              <div className="contact-card" data-reveal>
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
