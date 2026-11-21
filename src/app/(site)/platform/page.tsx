import "../../styles/pages.css"
import "../../styles/platform.css"

import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Platform — Spindle",
  description:
    "Explore the Spindle platform: project files, a live lab, local search, automations, an agent, collaboration, integrations, and the controls that keep research together.",
  path: "/platform",
})

const platformFeatures = [
  {
    href: "/workspace",
    icon: "i-grid",
    title: "Project workspace",
    body: "Every project gets one home for files, notebooks, search, agent history, automations, and conversation.",
    meta: "Start here",
  },
  {
    href: "/files",
    icon: "i-folder",
    title: "Files",
    body: "Upload, organize, detect, and preview research data without leaving the project tree.",
    meta: "100+ formats",
  },
  {
    href: "/lab",
    icon: "i-flask",
    title: "Live lab",
    body: "Notebooks, scripts, consoles, SQL, plots, canvas, and math run against the same project files.",
    meta: "4 environments",
  },
  {
    href: "/search",
    icon: "i-search",
    title: "Local search",
    body: "Basic and Academic modes through a SearXNG instance hosted alongside the workspace.",
    meta: "2 modes",
  },
  {
    href: "/agent",
    icon: "i-sparkle",
    title: "Agent",
    body: "Ask for multi-step work across files, folders, spreadsheets, and lab runs — always reviewable.",
    meta: "Diffs first",
  },
  {
    href: "/automations",
    icon: "i-bolt",
    title: "Automations",
    body: "Describe a workflow in plain language, build it visually, or write a cron job yourself.",
    meta: "Text or code",
  },
  {
    href: "/collaboration#chat",
    icon: "i-message",
    title: "Team chat",
    body: "Channels and direct messages live inside the project, next to the work they discuss.",
    meta: "Project scoped",
  },
  {
    href: "/collaboration",
    icon: "i-users",
    title: "Live collaboration",
    body: "Shared editing, presence, cursors, comments, roles, and history keep a team in sync.",
    meta: "Real time",
  },
  {
    href: "/developers",
    icon: "i-code",
    title: "Developer platform",
    body: "Authentication, scopes, app review, analytics, and an interactive API playground.",
    meta: "Build on Spindle",
  },
  {
    href: "/infrastructure",
    icon: "i-server",
    title: "Infrastructure",
    body: "Private storage, project isolation, encrypted lab connections, backups, and retention controls.",
    meta: "Private by default",
  },
]

const workflowSteps = [
  {
    title: "Create the project home",
    body: "Files, lab sessions, search, agent history, automations, and chat stay under one roof.",
    href: "/workspace",
    link: "Tour the workspace",
  },
  {
    title: "Bring the material in",
    body: "Upload datasets, notebooks, papers, images, media, and code; previews detect the format.",
    href: "/files",
    link: "See file management",
  },
  {
    title: "Analyze where data lives",
    body: "Run notebooks, scripts, SQL, charts, and symbolic math without exporting first.",
    href: "/lab",
    link: "Explore the Lab",
  },
  {
    title: "Find and cite sources",
    body: "Switch between Academic and Basic search without losing the project context.",
    href: "/search",
    link: "See how search works",
  },
  {
    title: "Automate repeat work",
    body: "Turn recurring cleanup, syncing, and reporting into reviewed workflows or cron jobs.",
    href: "/automations",
    link: "Build an automation",
  },
  {
    title: "Review, share, hand off",
    body: "Diffs, comments, presence, and shared history keep the project understandable over time.",
    href: "/collaboration",
    link: "Explore collaboration",
  },
]

const capabilityRows = [
  {
    area: "Project workspace",
    covers:
      "One project home with files, lab sessions, search, agent history, automations, and chat.",
    access: "Hobby",
    href: "/workspace",
  },
  {
    area: "Files & previews",
    covers:
      "5 GB free, upload queues, folders, format detection, and inline previews for 100+ formats.",
    access: "Hobby",
    href: "/files",
  },
  {
    area: "Lab",
    covers:
      "Python notebooks, R console, script runner, SQL explorer, canvas, graphing, and symbolic math.",
    access: "Hobby",
    href: "/lab",
  },
  {
    area: "Search",
    covers:
      "Basic and Academic modes through Spindle-hosted SearXNG, with results saved beside the work.",
    access: "Hobby",
    href: "/search",
  },
  {
    area: "Agent",
    covers:
      "Multi-step file, folder, spreadsheet, and lab work with reviewable diffs and approval gates.",
    access: "Hobby",
    href: "/agent",
  },
  {
    area: "Automations",
    covers: "Plain-language workflows, a visual builder, and cron jobs with run history and logs.",
    access: "Hobby",
    href: "/automations",
  },
  {
    area: "Team chat",
    covers:
      "Project channels, direct messages, anonymous display names, and Mixnet routing planned.",
    access: "Hobby",
    href: "/collaboration#chat",
  },
  {
    area: "Shared workspaces",
    covers: "Shared files, lab sessions, agent history, real-time editing, presence, and comments.",
    access: "Hobby",
    href: "/collaboration",
  },
  {
    area: "Security controls",
    covers:
      "TLS, project isolation, encrypted lab SSH, role controls, backups, and retention controls.",
    access: "All plans",
    href: "/infrastructure",
  },
  {
    area: "Developer platform",
    covers:
      "App registration, OAuth/session auth, scopes, review, analytics, and the API playground.",
    access: "All plans",
    href: "/developers",
  },
]

const integrations = [
  { name: "JupyterLab", detail: "Notebook environment", orb: "JL" },
  { name: "RStudio", detail: "R console", orb: "R" },
  { name: "VS Code", detail: "Editor workspace", orb: "VS" },
  { name: "Quarto", detail: "Reports and publishing", orb: "Q" },
  { name: "CSV / Parquet", detail: "Tabular datasets", orb: "CSV" },
  { name: "NetCDF", detail: "Scientific arrays", orb: "NC" },
  { name: "Zotero", detail: "References", orb: "Z" },
  { name: "SearXNG", detail: "Private search", orb: "SX" },
]

const trustCards = [
  {
    icon: "i-shield",
    title: "Private by default",
    body: "Search does not build an advertising profile. Projects stay isolated, connections use TLS, and lab hosts are reached over encrypted SSH.",
    href: "/security",
    link: "Read the trust centre",
  },
  {
    icon: "i-refresh",
    title: "Work stays reviewable",
    body: "Agent changes arrive as diffs, lab runs keep snapshots, automations keep history, and shared edits remain attributable.",
    href: "/infrastructure",
    link: "See infrastructure controls",
  },
  {
    icon: "i-users",
    title: "Controls scale with the team",
    body: "Invite members, assign roles, and move to shared workspaces when the project needs more people.",
    href: "/collaboration",
    link: "Explore team controls",
  },
]

const platformFaqs = [
  {
    question: "Is the whole platform free?",
    answer:
      "The Hobby plan is free with no credit card and includes the workspace, files, lab, search, automations, chat, real-time collaboration, and 20 agent requests per day. Donations fund the servers and development. Enterprise is a custom agreement for organizations that need dedicated infrastructure, larger allowances, support, and organization controls.",
    href: "/pricing",
    link: "Compare plans",
  },
  {
    question: "What can the agent change?",
    answer:
      "The agent can read project files, edit documents and spreadsheets, move or reorganize files, run lab work, and handle multi-step requests. Changes are presented as reviewable diffs, and destructive actions pause for approval.",
    href: "/agent",
    link: "Read the agent guide",
  },
  {
    question: "Where does search run?",
    answer:
      "Search runs through a SearXNG instance hosted alongside Spindle, so queries stay within the service instead of becoming an advertising profile. Academic mode targets papers and citations; Basic mode covers the wider web.",
    href: "/search",
    link: "See search modes",
  },
  {
    question: "Can my team work in the same project?",
    answer:
      "Project chat is built into every workspace. Shared workspaces add real-time editing, presence, comments, roles, and shared lab and agent history — included on the free Hobby plan.",
    href: "/collaboration",
    link: "Explore collaboration",
  },
  {
    question: "Which file formats can I preview?",
    answer:
      "Spindle detects and previews more than 100 formats inline, including documents, spreadsheets, datasets, images, media, archives, code, and notebooks. Files that need a lab environment can be opened directly from the same project tree.",
    href: "/workspace",
    link: "Tour the workspace",
  },
]

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

function FeatureCard({
  href,
  icon,
  title,
  body,
  meta,
}: {
  href: string
  icon: string
  title: string
  body: string
  meta: string
}) {
  return (
    <a href={href} className="feature-card plat-feature-card" data-reveal>
      <span className="card-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="plat-feature-meta">
        <span>{meta}</span>
        <Icon name="i-arrow-right" />
      </span>
    </a>
  )
}

function SectionHead({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="section-head plat-section-head" data-reveal>
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="section-title">{title}</h2>
      <p className="section-desc">{desc}</p>
    </div>
  )
}

function CheckItem({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <span className="feature-check">
        <Icon name="i-check" />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
    </li>
  )
}

function PlatformHeroVisual() {
  return (
    <div className="product-window plat-window" data-reveal>
      <div className="window-bar">
        <div className="traffic-lights" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <span className="window-bar-title">coastal-resilience / workspace</span>
        <span className="window-bar-status">
          <i></i> Synced
        </span>
      </div>
      <div className="plat-window-body">
        <aside className="plat-window-rail" aria-hidden="true">
          <div className="plat-window-brand">
            <i></i> Project rail
          </div>
          <div className="plat-window-nav">
            <span className="is-active">
              <Icon name="i-grid" /> Overview
            </span>
            <span>
              <Icon name="i-folder" /> Files
            </span>
            <span>
              <Icon name="i-flask" /> Lab
            </span>
            <span>
              <Icon name="i-search" /> Search
            </span>
            <span>
              <Icon name="i-sparkle" /> Agent
            </span>
            <span>
              <Icon name="i-bolt" /> Automations
            </span>
            <span>
              <Icon name="i-message" /> Chat
            </span>
          </div>
        </aside>
        <div className="plat-window-main">
          <div className="plat-panel-head">
            <strong>Project activity</strong>
            <span>Updated now</span>
          </div>
          <div className="plat-metrics">
            <div className="plat-metric">
              <strong>128</strong>
              <span>project files</span>
            </div>
            <div className="plat-metric">
              <strong>14/20</strong>
              <span>agent requests left</span>
            </div>
            <div className="plat-metric">
              <strong>3</strong>
              <span>active automations</span>
            </div>
          </div>
          <div className="plat-work-grid">
            <div className="plat-mini-panel">
              <div className="plat-mini-head">
                <span>Files</span>
                <span>5 GB</span>
              </div>
              <div className="plat-file-list">
                <div className="plat-file-row is-selected">
                  <Icon name="i-folder" />
                  <span>data/</span>
                  <small>86 MB</small>
                </div>
                <div className="plat-file-row">
                  <Icon name="i-folder" />
                  <span>notebooks/</span>
                  <small>410 KB</small>
                </div>
                <div className="plat-file-row">
                  <Icon name="i-folder" />
                  <span>results/</span>
                  <small>2.1 MB</small>
                </div>
              </div>
            </div>
            <div className="plat-mini-panel">
              <div className="plat-mini-head">
                <span>analysis.ipynb</span>
                <span>Python 3.12</span>
              </div>
              <div className="plat-notebook">
                <pre className="plat-code">
                  <span className="tok-key">import</span> pandas <span className="tok-key">as</span>{" "}
                  pd
                  {"\n"}df = pd.read_parquet(
                  <span className="tok-str">"data/survey.parquet"</span>){"\n"}df =
                  df.dropna(subset=[
                  <span className="tok-str">"salinity"</span>])
                </pre>
                <div className="plat-notebook-out">17,402 rows · 12 columns · no errors</div>
              </div>
            </div>
          </div>
          <div className="plat-activity" aria-hidden="true">
            <div className="plat-activity-row">
              <Icon name="i-search" />
              <span>Saved 3 Academic sources to references</span>
              <time>09:42</time>
            </div>
            <div className="plat-activity-row">
              <Icon name="i-bolt" />
              <span>Weekly tide sync completed in 42s</span>
              <time>08:15</time>
            </div>
            <div className="plat-activity-row">
              <Icon name="i-users" />
              <span>Mara and Theo joined the project</span>
              <time>Yesterday</time>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FilesLabDemo() {
  return (
    <div className="product-window plat-window plat-split-demo" data-reveal>
      <div className="window-bar">
        <div className="traffic-lights" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <span className="window-bar-title">coastal-resilience / lab</span>
        <span className="window-bar-status">
          <i></i> Kernel idle
        </span>
      </div>
      <div className="plat-window-main">
        <div className="plat-work-grid">
          <div className="plat-file-pane">
            <div className="plat-pane-head">
              <span>Project files</span>
              <span>Mounted</span>
            </div>
            <div className="plat-pane-body">
              <div className="plat-file-tree">
                <div className="plat-tree-row">
                  <Icon name="i-folder" />
                  <span>data/</span>
                </div>
                <div className="plat-tree-row plat-tree-indent-1 is-file">
                  <Icon name="i-folder" />
                  <span>survey.parquet</span>
                  <small>86 MB</small>
                </div>
                <div className="plat-tree-row plat-tree-indent-1 is-file">
                  <Icon name="i-folder" />
                  <span>tidal-2026.csv</span>
                  <small>2.4 MB</small>
                </div>
                <div className="plat-tree-row">
                  <Icon name="i-folder" />
                  <span>notebooks/</span>
                </div>
                <div className="plat-tree-row plat-tree-indent-1 is-file">
                  <Icon name="i-folder" />
                  <span>analysis.ipynb</span>
                  <small>410 KB</small>
                </div>
              </div>
              <svg
                className="plat-chart"
                viewBox="0 0 320 120"
                role="img"
                aria-label="Recovery score trend"
              >
                <path className="plat-chart-grid" d="M0 24H320M0 48H320M0 72H320M0 96H320" />
                <path d="M8 92C42 84 62 88 92 76S142 82 172 62s62-8 92-24 54-10 54-10" />
                <circle cx="318" cy="28" r="3.5" />
              </svg>
            </div>
          </div>
          <div className="plat-notebook-pane">
            <div className="plat-pane-head">
              <span>analysis.ipynb</span>
              <span>Cell 4 of 9</span>
            </div>
            <div className="plat-pane-body">
              <pre className="plat-code">
                <span className="tok-com">{"# recovery score by site"}</span>
                {"\n"}sites = gpd.read_file(
                <span className="tok-str">"data/sites.geojson"</span>){"\n"}merged = sites.merge(
                <span className="tok-fn">survey_summary</span>(), on=
                <span className="tok-str">"site_id"</span>){"\n"}merged.to_parquet(
                <span className="tok-str">"results/recovery.parquet"</span>)
              </pre>
              <div className="plat-notebook-out">9 features · CRS EPSG:4326 · output saved</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchAgentDemo() {
  return (
    <div className="product-window plat-window plat-split-demo" data-reveal>
      <div className="window-bar">
        <div className="traffic-lights" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </div>
        <span className="window-bar-title">research pipeline / agent</span>
        <span className="window-bar-status">
          <i></i> Review pending
        </span>
      </div>
      <div className="plat-window-main">
        <div className="plat-demo-stack">
          <div className="plat-file-pane">
            <div className="plat-pane-head">
              <span>Academic search</span>
              <span>SearXNG local</span>
            </div>
            <div className="plat-pane-body">
              <div className="plat-chat-lines">
                <div className="plat-chat-line">
                  <span className="plat-chat-avatar">01</span>
                  <div>
                    <strong>
                      Blue carbon in restored marshes <time>BASE</time>
                    </strong>
                    <p>Open access · saved to references</p>
                  </div>
                </div>
                <div className="plat-chat-line">
                  <span className="plat-chat-avatar">02</span>
                  <div>
                    <strong>
                      Sediment accretion after rewetting <time>OpenAlex</time>
                    </strong>
                    <p>118 citations · added to notes</p>
                  </div>
                </div>
                <div className="plat-chat-line">
                  <span className="plat-chat-avatar">03</span>
                  <div>
                    <strong>
                      Coastal vegetation recovery <time>arXiv</time>
                    </strong>
                    <p>Preprint · queued for review</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="plat-agent-pane">
            <div className="plat-pane-head">
              <span>Agent request</span>
              <span>3 of 4 steps</span>
            </div>
            <div className="plat-pane-body">
              <div className="plat-agent-steps">
                <div className="plat-agent-step">
                  <Icon name="i-check" />
                  <span>Read saved sources and survey metadata</span>
                  <time>0.4s</time>
                </div>
                <div className="plat-agent-step">
                  <Icon name="i-check" />
                  <span>Update citations in notes.md</span>
                  <time>1.1s</time>
                </div>
                <div className="plat-agent-step is-running">
                  <Icon name="i-sparkle" />
                  <span>Recomputing recovery summary in Lab</span>
                  <time>2.6s</time>
                </div>
                <div className="plat-agent-step">
                  <Icon name="i-folder" />
                  <span>Write diff for results/recovery.parquet</span>
                  <time>—</time>
                </div>
              </div>
              <div className="plat-diff">
                <span className="is-add">+42 rows</span>
                <span className="is-del">−8 stale</span>
                <span className="plat-diff-note">Review before apply</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PlatformPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero plat-hero">
          <div className="plat-hero-grid container">
            <div className="plat-hero-copy">
              <div className="eyebrow">Platform</div>
              <h1 className="page-title">The research operating system, in one project.</h1>
              <p className="page-lede">
                Spindle brings files, a live lab, local search, automations, an agent, team chat,
                collaboration, and the infrastructure underneath into a single project-shaped home.
              </p>
              <div className="page-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Start free
                </a>
                <a href="/docs" className="btn btn--ghost btn--lg">
                  Read the docs
                </a>
              </div>
              <div className="plat-hero-meta" aria-label="Platform highlights">
                <span className="plat-hero-chip">
                  <i></i> One project home
                </span>
                <span className="plat-hero-chip">
                  <i></i> Files + lab + agent
                </span>
                <span className="plat-hero-chip plat-hero-chip--amber">
                  <i></i> 5 GB free
                </span>
              </div>
            </div>
            <PlatformHeroVisual />
          </div>
        </section>

        <section className="section" id="overview">
          <div className="container">
            <SectionHead
              eyebrow="Platform map"
              title="Everything a project needs, together."
              desc="Each surface is useful on its own. Together they remove the handoffs between storage, analysis, search, automation, and review."
            />
            <div className="stats-grid" data-reveal>
              <div className="stat">
                <div className="stat-value">
                  5<span className="stat-suffix"> GB</span>
                </div>
                <p>Storage on the free plan</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  20<span className="stat-suffix">/day</span>
                </div>
                <p>Agent requests included</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  100<span className="stat-suffix">+</span>
                </div>
                <p>Formats detected inline</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  2<span className="stat-suffix"> modes</span>
                </div>
                <p>Academic and Basic search</p>
              </div>
            </div>
            <div className="feature-grid" style={{ marginTop: "28px" }}>
              {platformFeatures.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section className="section section--alt" id="workflow">
          <div className="container">
            <SectionHead
              eyebrow="How it fits together"
              title="From first file to finished project."
              desc="The platform is organized around the lifecycle of research: collect, analyze, automate, collaborate, review, and hand off."
            />
            <ol className="plat-workflow" data-reveal>
              {workflowSteps.map((step, index) => (
                <li className="plat-step" key={step.title}>
                  <span className="plat-step-number">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <a href={step.href}>
                    {step.link}
                    <Icon name="i-arrow-right" />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="files-lab">
          <div className="container">
            <div className="split-grid">
              <div className="split-copy">
                <div className="eyebrow">Files + Lab</div>
                <h2 className="section-title">The working surface stays in sync.</h2>
                <p className="section-desc">
                  Files are the project. The lab mounts the same tree, so notebooks, scripts,
                  automations, and the agent all read and write the same source of truth.
                </p>
                <ul className="feature-list">
                  <CheckItem
                    title="Inline previews for 100+ formats"
                    body="Datasets, documents, media, code, and notebooks open in place"
                  />
                  <CheckItem
                    title="Lab environments ready to run"
                    body="Python notebooks, R console, scripts, SQL explorer, canvas, and math"
                  />
                  <CheckItem
                    title="Snapshots and run history"
                    body="Rewind an analysis without losing the thread"
                  />
                  <CheckItem
                    title="One file tree for everything"
                    body="Search results, agent changes, and automation outputs land beside the data"
                  />
                </ul>
                <div className="plat-section-links">
                  <a href="/lab" className="text-link">
                    Explore the Lab <Icon name="i-arrow-right" />
                  </a>
                  <a href="/workspace" className="text-link">
                    See the workspace tour <Icon name="i-arrow-right" />
                  </a>
                </div>
              </div>
              <FilesLabDemo />
            </div>
          </div>
        </section>

        <section className="section section--alt" id="find-act">
          <div className="container">
            <div className="split-grid split-grid--reverse">
              <SearchAgentDemo />
              <div className="split-copy">
                <div className="eyebrow">Search + Agent</div>
                <h2 className="section-title">Find the evidence. Let the agent act.</h2>
                <p className="section-desc">
                  Search keeps sources close to the project. The agent can then turn those sources
                  and files into reviewed changes, reports, and repeatable workflows.
                </p>
                <ul className="feature-list">
                  <CheckItem
                    title="Academic and Basic search modes"
                    body="Papers, citations, datasets, news, and practical references through local SearXNG"
                  />
                  <CheckItem
                    title="Results stay in context"
                    body="Citations, notes, and saved sources live beside the files they support"
                  />
                  <CheckItem
                    title="Agent work across the project"
                    body="Reads files, edits documents, moves folders, updates spreadsheets, and runs lab jobs"
                  />
                  <CheckItem
                    title="Approval before risky changes"
                    body="Destructive actions pause while ordinary edits arrive as reviewable diffs"
                  />
                </ul>
                <div className="plat-section-links">
                  <a href="/search" className="text-link">
                    See search modes <Icon name="i-arrow-right" />
                  </a>
                  <a href="/agent" className="text-link">
                    Explore the agent <Icon name="i-arrow-right" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="automate-collaborate">
          <div className="container">
            <SectionHead
              eyebrow="Automation + collaboration"
              title="Keep the project moving between sessions."
              desc="Recurring work can run itself, while people and agents stay aligned through shared context, diffs, comments, and chat."
            />
            <div className="duo-grid">
              <article className="duo-card" data-reveal>
                <div className="duo-badge">
                  <Icon name="i-bolt" /> Plain language or code
                </div>
                <h3>Automate the repeatable parts</h3>
                <p>
                  Describe what should happen, build the workflow visually, or write a cron job
                  against the project. Every path shares run history, logs, and guardrails.
                </p>
                <ul className="check-list">
                  <li>Plain-language automation drafts</li>
                  <li>Visual workflow builder</li>
                  <li>Cron schedules with timezones</li>
                  <li>Run history and failure alerts</li>
                </ul>
                <div className="prompt-card">
                  <p>
                    When a new CSV lands in <strong>/data</strong>, clean it and add a short summary
                    to the project log.
                  </p>
                  <div className="prompt-foot">
                    <span>Spindle drafted 4 steps</span>
                    <span className="prompt-live">
                      <i></i> Ready to review
                    </span>
                  </div>
                </div>
                <div className="plat-section-links">
                  <a href="/automations" className="text-link">
                    Open automations <Icon name="i-arrow-right" />
                  </a>
                </div>
              </article>
              <article className="duo-card" data-reveal>
                <div className="duo-badge duo-badge--amber">
                  <Icon name="i-users" /> Team + agents
                </div>
                <h3>Decisions stay beside the work</h3>
                <p>
                  Channels, direct messages, presence, cursors, comments, and shared history keep
                  the conversation attached to the files, cells, and runs it belongs to.
                </p>
                <ul className="check-list">
                  <li>Project channels and direct messages</li>
                  <li>Live cursors and presence</li>
                  <li>Comments in context</li>
                  <li>Roles, permissions, and shared history</li>
                </ul>
                <div className="plat-chat-pane" aria-hidden="true">
                  <div className="plat-pane-head">
                    <span># field-notes</span>
                    <span>8 members</span>
                  </div>
                  <div className="plat-pane-body">
                    <div className="plat-chat-lines">
                      <div className="plat-chat-line">
                        <span className="plat-chat-avatar">MR</span>
                        <div>
                          <strong>
                            Mara <time>09:14</time>
                          </strong>
                          <p>New survey batch is in /data — viewer detected Parquet.</p>
                        </div>
                      </div>
                      <div className="plat-chat-line">
                        <span className="plat-chat-avatar">JL</span>
                        <div>
                          <strong>
                            Jules <time>09:18</time>
                          </strong>
                          <p>The lab still has yesterday's kernel warm.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="plat-section-links">
                  <a href="/collaboration" className="text-link">
                    Explore collaboration <Icon name="i-arrow-right" />
                  </a>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="included">
          <div className="container">
            <SectionHead
              eyebrow="Capability map"
              title="What is included, and where it lives."
              desc="A quick map of the platform surfaces, what each one covers, and which plan unlocks the shared-team layer."
            />
            <div className="plat-matrix-wrap" data-reveal>
              <table className="plat-matrix">
                <thead>
                  <tr>
                    <th scope="col">Area</th>
                    <th scope="col">What it covers</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Explore</th>
                  </tr>
                </thead>
                <tbody>
                  {capabilityRows.map((row) => (
                    <tr key={row.area}>
                      <th scope="row">{row.area}</th>
                      <td>{row.covers}</td>
                      <td>
                        <span
                          className={
                            row.access === "Team"
                              ? "plat-status plat-status--planned"
                              : "plat-status"
                          }
                        >
                          {row.access}
                        </span>
                      </td>
                      <td>
                        <a href={row.href}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section" id="integrations">
          <div className="container">
            <SectionHead
              eyebrow="Integrations"
              title="Connected to the tools researchers already use."
              desc="Spindle does not ask the project to leave its tools. Notebooks, datasets, references, search, and publishing formats stay in the same project flow."
            />
            <div className="plat-integrations" data-reveal>
              {integrations.map((integration) => (
                <div className="plat-integration" key={integration.name}>
                  <span className="plat-integration-orb" aria-hidden="true">
                    {integration.orb}
                  </span>
                  <span>
                    <strong>{integration.name}</strong>
                    <small>{integration.detail}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--alt" id="trust">
          <div className="container">
            <SectionHead
              eyebrow="Trust"
              title="Powerful enough for the work. Bounded enough to trust."
              desc="The platform is designed so agents, automations, search, and collaboration all operate inside explicit project boundaries."
            />
            <div className="plat-trust-grid">
              {trustCards.map((card) => (
                <article className="plat-trust-card" key={card.title} data-reveal>
                  <span className="card-icon">
                    <Icon name={card.icon} />
                  </span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <a href={card.href}>
                    {card.link} <Icon name="i-arrow-right" />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="container">
            <SectionHead
              eyebrow="Platform FAQ"
              title="Questions before you start."
              desc="The short version: the free plan includes the full workspace surfaces, while paid plans scale storage, seats, agent allowance, and organization controls."
            />
            <div className="plat-faq" data-reveal>
              {platformFaqs.map((faq) => (
                <details className="plat-faq-item" key={faq.question}>
                  <summary>
                    {faq.question}
                    <Icon name="i-chevron-down" />
                  </summary>
                  <div className="plat-faq-answer">
                    <p>
                      {faq.answer} <a href={faq.href}>{faq.link}</a>
                    </p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section" id="start">
          <div className="container">
            <div className="cta-box" data-reveal>
              <h2>Give your research a place to live.</h2>
              <p>
                Start with 5 GB, a lab, local search, automations, chat, and 20 agent requests a
                day. Bring the project and keep it together.
              </p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create free workspace
                </a>
                <a href="/pricing" className="btn btn--ghost btn--lg">
                  Compare plans
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
