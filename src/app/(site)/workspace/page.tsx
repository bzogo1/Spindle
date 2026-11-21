import "../../styles/pages.css"
import "../../styles/workspace.css"
import {
  AgentDemo,
  LabSshDemo,
  SearchDemo,
  WorkspaceHeroField,
  WorkspaceTour,
} from "@/components/workspace/workspace-demos"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Workspace overview — Spindle",
  description:
    "A tour of everything inside a Spindle workspace: files, the Lab over SSH, local search, the agent, automations, and team chat — all in one project home.",
  path: "/workspace",
})

export default function WorkspacePage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero ws-hero">
          <div className="ws-dither-host" aria-hidden="true">
            <WorkspaceHeroField />
          </div>
          <div className="ws-hero-grid container">
            <div className="ws-hero-copy" data-reveal>
              <div className="eyebrow">Workspace overview</div>
              <h1 className="page-title">One account. Every tool a project needs.</h1>
              <p className="page-lede">
                A Spindle workspace is the home your whole project lives in — files, a live lab you
                can SSH into, local search, an agent, automations, and team chat. Below is a tour of
                what it actually looks like inside.
              </p>
              <div className="page-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Start free{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a href="/platform" className="btn btn--ghost btn--lg">
                  All features
                </a>
              </div>
              <div className="ws-hero-meta">
                <span>
                  <svg className="icon icon--xs">
                    <use href="#i-lock" />
                  </svg>{" "}
                  Encrypted SSH to your lab host
                </span>
                <span>
                  <svg className="icon icon--xs">
                    <use href="#i-sparkle" />
                  </svg>{" "}
                  20 agent requests a day free
                </span>
                <span>
                  <svg className="icon icon--xs">
                    <use href="#i-users" />
                  </svg>{" "}
                  Channels scoped per project
                </span>
              </div>
            </div>
            <div data-reveal data-reveal-delay="120">
              <WorkspaceTour />
            </div>
          </div>
        </section>

        <section className="section" id="lab" aria-labelledby="ws-lab-title">
          <div className="ws-split container">
            <div className="ws-split-copy" data-reveal>
              <div className="eyebrow">The Lab</div>
              <h2 id="ws-lab-title">SSH in. Run R or Python. Snapshots on every run.</h2>
              <p>
                Every workspace gets a lab host. Connect over encrypted SSH — the same session you
                see above — and your project files are already mounted. Run RStudio or a Python
                kernel, and every run is snapshotted so you can roll back any cell.
              </p>
              <ol className="ws-steps">
                <li>
                  <span>
                    <strong>Connect securely.</strong> Ed25519 key auth, AES-256-GCM, forward
                    secrecy — no passwords on the wire.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Pick a kernel.</strong> R 4.4, Python 3.12, SQL, or the math engine —
                    warm in under a second.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Work on real files.</strong> Read and write the same tree your team sees
                    in Files.
                  </span>
                </li>
              </ol>
              <div className="ws-link-row">
                <a href="/lab">
                  Explore the Lab{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a href="/infrastructure">
                  How hosts are isolated{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-up-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div data-reveal data-reveal-delay="100">
              <LabSshDemo />
            </div>
          </div>
        </section>

        <section className="section section--alt" id="search" aria-labelledby="ws-search-title">
          <div className="ws-split ws-split--reverse container">
            <div className="ws-split-copy" data-reveal>
              <div className="eyebrow">Local search</div>
              <h2 id="ws-search-title">Search your project and the web — locally.</h2>
              <p>
                One box, two modes. Basic searches the open web through SearXNG running next to your
                workspace; Academic adds scholarly sources. Results land next to your files and
                notebooks, ready to cite — and nothing builds an ads profile from your queries.
              </p>
              <ul className="check-list">
                <li>SearXNG hosted alongside your workspace</li>
                <li>Results and citations saved in place</li>
                <li>Optional anonymity via the Nym Mixnet</li>
              </ul>
              <div className="ws-link-row">
                <a href="/#search">
                  See it on the homepage{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-up-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div data-reveal data-reveal-delay="100">
              <SearchDemo />
            </div>
          </div>
        </section>

        <section className="section" id="agent" aria-labelledby="ws-agent-title">
          <div className="ws-split container">
            <div className="ws-split-copy" data-reveal>
              <div className="eyebrow">Agent</div>
              <h2 id="ws-agent-title">Hand off the busywork. Keep the judgment.</h2>
              <p>
                The agent works inside your workspace with the same file tree you see. Ask it to
                refactor a pipeline, reorganize a folder, move files between projects, or summarize
                new sources — every change lands as a snapshot you can inspect or undo.
              </p>
              <ol className="ws-steps">
                <li>
                  <span>
                    <strong>Describe the task</strong> in plain language — no prompt engineering
                    required.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Watch it work</strong> — reads, moves, and writes show up live in the
                    activity feed.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Review the diff</strong> — snapshots mean every change is reversible.
                  </span>
                </li>
              </ol>
              <div className="ws-link-row">
                <a href="/agent">
                  Meet the agent{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div data-reveal data-reveal-delay="100">
              <AgentDemo />
            </div>
          </div>
        </section>

        <section className="section section--alt" aria-labelledby="ws-everything-title">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Everything else in the workspace</div>
              <h2 className="section-title" id="ws-everything-title">
                The rest of the account, covered.
              </h2>
              <p className="section-desc">
                Files, automations, chat, and collaboration share the same project home — same
                files, same history, same permissions.
              </p>
            </div>
            <div className="ws-grid">
              <a href="/#files" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-folder" />
                  </svg>
                </span>
                <h3>Files</h3>
                <p>5 GB free, a clean file manager, and inline previews for 100+ formats.</p>
              </a>
              <a href="/automations" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-bolt" />
                  </svg>
                </span>
                <h3>Automations</h3>
                <p>
                  Text it, build it, or write the cron yourself — jobs run inside the workspace.
                </p>
              </a>
              <a href="/collaboration#chat" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-message" />
                  </svg>
                </span>
                <h3>Team chat</h3>
                <p>Channels live inside each project, with live cursors and optional anonymity.</p>
              </a>
              <a href="/collaboration" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-users" />
                  </svg>
                </span>
                <h3>Collaboration</h3>
                <p>Shared editing, roles, and presence — everyone sees the same workspace.</p>
              </a>
              <a href="/infrastructure" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-shield" />
                  </svg>
                </span>
                <h3>Infrastructure</h3>
                <p>Private by design — encrypted transport, isolated lab hosts, your own terms.</p>
              </a>
              <a href="/lab" className="feature-card">
                <span className="card-icon">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-flask" />
                  </svg>
                </span>
                <h3>The Lab</h3>
                <p>
                  Notebooks, R, SQL, canvas, graphs, and math — already connected to your files.
                </p>
              </a>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="ws-security-title">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Private by default</div>
              <h2 className="section-title" id="ws-security-title">
                The boring parts are handled.
              </h2>
            </div>
            <div className="ws-sec-grid">
              <div className="ws-sec">
                <svg className="icon icon--sm" aria-hidden="true">
                  <use href="#i-lock" />
                </svg>
                <strong>Encrypted end to end</strong>
                <span>
                  TLS everywhere, AES-256-GCM SSH tunnels to lab hosts, forward secrecy on every
                  session.
                </span>
              </div>
              <div className="ws-sec">
                <svg className="icon icon--sm" aria-hidden="true">
                  <use href="#i-clock" />
                </svg>
                <strong>Snapshots, not regrets</strong>
                <span>
                  Every lab run and agent change is snapshotted — roll back any cell, any edit.
                </span>
              </div>
              <div className="ws-sec">
                <svg className="icon icon--sm" aria-hidden="true">
                  <use href="#i-shield" />
                </svg>
                <strong>Search stays local</strong>
                <span>
                  SearXNG runs next to your data. No ad profile, optional Nym Mixnet anonymity.
                </span>
              </div>
              <div className="ws-sec">
                <svg className="icon icon--sm" aria-hidden="true">
                  <use href="#i-users" />
                </svg>
                <strong>Roles and audit</strong>
                <span>
                  Per-project permissions and member audit logs, with SSO on Enterprise agreements.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-box">
              <h2>Your project already has a home. Claim it.</h2>
              <p>Start with 5 GB, a lab host, local search, and 20 agent requests a day.</p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create free workspace
                </a>
                <a href="/docs" className="btn btn--ghost btn--lg">
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
