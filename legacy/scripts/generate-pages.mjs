/* Generates the small static pages linked from the main navigation.
   Shared bits (icon sprite, brand, footer) are taken from index.html so the
   pages stay visually in sync with the homepage. Run with: npm run pages */

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const home = readFileSync(path.join(root, "index.html"), "utf8")

const sprite = home.match(/<svg class="svg-sprite"[\s\S]*?<\/svg>/)?.[0] ?? ""
const brand = (home.match(/<a href="#top" class="brand"[\s\S]*?<\/a>/)?.[0] ?? "").replace('href="#top"', 'href="index.html"')
const footer = home.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)?.[0] ?? ""

const head = (title, description) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0d0f0e" />
  <title>${title} — Spindle</title>
  <meta name="description" content="${description}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="pages.css" />
</head>
<body>

  <!-- Icon sprite, kept in sync with index.html -->
  ${sprite}

  <header class="site-header" id="header">
    <div class="container header-inner">
      ${brand}

      <div class="nav-desktop-slot" id="ui-main-nav">
        <nav class="nav-fallback" aria-label="Main navigation">
          <a href="platform.html">Product</a>
          <a href="solutions.html">Solutions</a>
          <a href="pricing.html">Pricing</a>
          <a href="docs.html">Resources</a>
          <a href="about.html">Company</a>
        </nav>
      </div>

      <div class="header-actions">
        <div id="ui-signin"></div>
        <a href="index.html#get-started" class="btn btn--primary btn--sm">Start free</a>
        <button class="menu-toggle" id="menuToggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobileNav">
          <svg class="icon icon--open"><use href="#i-menu"/></svg>
          <svg class="icon icon--close"><use href="#i-close"/></svg>
        </button>
      </div>
    </div>

    <nav class="nav-mobile" id="mobileNav" aria-label="Mobile navigation">
      <div id="ui-mobile-nav">
        <div class="nav-fallback-mobile">
          <a href="platform.html">Product</a>
          <a href="solutions.html">Solutions</a>
          <a href="pricing.html">Pricing</a>
          <a href="docs.html">Resources</a>
          <a href="about.html">Company</a>
        </div>
      </div>
    </nav>
  </header>

  <main id="top" class="page-main">`

const tail = `
  </main>

  ${footer}

  <script type="module" src="script.js"></script>
  <script type="module" src="/src/nav.tsx"></script>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`

const icon = (name, cls = "icon icon--sm") => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`

const cta = `
    <section class="cta-section">
      <div class="container">
        <div class="cta-box">
          <h2>Give your research a place to live.</h2>
          <p>Start with 5 GB, a lab, local search, and 20 agent requests a day.</p>
          <div class="cta-actions">
            <a href="index.html#get-started" class="btn btn--primary btn--lg">Create free workspace</a>
            <a href="about.html#contact" class="btn btn--ghost btn--lg">Talk to us</a>
          </div>
        </div>
      </div>
    </section>`

const featureCard = (iconName, title, body, href = "index.html#platform") => `          <a href="${href}" class="feature-card">
            <span class="card-icon">${icon(iconName)}</span>
            <h3>${title}</h3>
            <p>${body}</p>
          </a>`

const checkList = (items) => `            <ul class="check-list">${items.map((item) => `\n              <li>${item}</li>`).join("")}\n            </ul>`

const audience = (id, eyebrow, title, description, first, second, inverse = false) => `    <section class="section${inverse ? " section--alt" : ""}" id="${id}">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">${eyebrow}</div>
          <h2 class="section-title">${title}</h2>
          <p class="section-desc">${description}</p>
        </div>
        <div class="duo-grid">
          <div class="duo-card">
            <span class="duo-badge">HOW IT HELPS</span>
            <h3>${first.title}</h3>
            <p>${first.body}</p>
${checkList(first.items)}
          </div>
          <div class="duo-card">
            <span class="duo-badge duo-badge--amber">AS YOU GROW</span>
            <h3>${second.title}</h3>
            <p>${second.body}</p>
${checkList(second.items)}
          </div>
        </div>
      </div>
    </section>`

const pages = {
  "platform.html": {
    title: "Platform",
    description: "Files, a live lab, local search, automations, an agent, and team chat — one home for every research project.",
    content: `
    <section class="page-hero">
      <div class="container">
        <div class="eyebrow">Platform</div>
        <h1 class="page-title">One workspace, end to end.</h1>
        <p class="page-lede">Spindle keeps the messy middle of research — data, notebooks, sources, and conversations — in one project-shaped home. Each link below opens a live preview on the homepage.</p>
        <div class="page-actions">
          <a href="index.html#get-started" class="btn btn--primary btn--lg">Start free ${icon("i-arrow-right", "icon icon--xs")}</a>
          <a href="docs.html" class="btn btn--ghost btn--lg">Read the docs</a>
        </div>
      </div>
    </section>

    <section class="section section--alt">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">The workspace</div>
          <h2 class="section-title">Everything a project needs, together.</h2>
          <p class="section-desc">Six tools that share the same files, the same history, and the same project.</p>
        </div>
        <div class="feature-grid">
${featureCard("i-folder", "Files", "5 GB free, a clean file manager, and inline previews for 100+ formats.", "index.html#files")}
${featureCard("i-flask", "Live lab", "Notebooks, R, SQL, and more in the browser — already connected to your files.", "lab.html")}
${featureCard("i-search", "Local search", "Academic and Basic modes run through SearXNG hosted alongside Spindle.", "index.html#search")}
${featureCard("i-bolt", "Automations", "Text it, build it, or write the cron yourself.", "automations.html")}
${featureCard("i-sparkle", "Agent", "Ask it to refactor a pipeline, edit a sheet, move a folder, or summarize new sources.", "agent.html")}
${featureCard("i-message", "Team chat", "Channels live inside each project, with an optional anonymous mode.", "index.html#chat")}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">Design choices</div>
          <h2 class="section-title">Built around the project, not the tab.</h2>
        </div>
        <div class="duo-grid">
          <div class="duo-card">
            <span class="duo-badge">ONE HOME</span>
            <h3>Keep the context</h3>
            <p>Notes, results, and decisions stay next to the files they describe.</p>
${checkList(["A single file tree for the whole project", "Lab sessions open on the same data", "Search results and citations saved in place", "Channels scoped to the work at hand"])}
          </div>
          <div class="duo-card">
            <span class="duo-badge duo-badge--amber">LOCAL BY DEFAULT</span>
            <h3>Keep it close</h3>
            <p>The useful parts of the workspace run alongside your data.</p>
${checkList(["SearXNG hosted with your workspace", "Optional anonymity (Nym Mixnet routing planned)", "No advertising profile built from searches", "Storage you can archive on your own terms"])}
          </div>
        </div>
      </div>
    </section>
${cta}`,
  },

  "solutions.html": {
    title: "Solutions",
    description: "How individual researchers, labs, teams, and institutions use Spindle as a shared research workspace.",
    content: `
    <section class="page-hero">
      <div class="container">
        <div class="eyebrow">Solutions</div>
        <h1 class="page-title">One workspace, shaped around how you work.</h1>
        <p class="page-lede">A solo field project and a department-wide program need different things. Spindle starts as a project home and grows into shared infrastructure when you do.</p>
        <div class="page-actions">
          <a href="about.html#contact" class="btn btn--primary btn--lg">Talk to us ${icon("i-arrow-right", "icon icon--xs")}</a>
          <a href="pricing.html" class="btn btn--ghost btn--lg">See pricing</a>
        </div>
      </div>
    </section>
${audience("researchers", "For one researcher", "A quiet place for one project.", "Keep the data, drafts, and sources for a single study together without building your own folder convention.", {
  title: "Start with a folder",
  body: "A free workspace gives you the full toolset from day one.",
  items: ["5 GB of storage for one active project", "A lab that boots with the project files", "Academic and Basic search beside your notes", "20 agent requests every day"],
}, {
  title: "When the project grows",
  body: "The same workspace becomes a shared one when collaborators arrive.",
  items: ["Invite people into the project, not a separate drive", "Keep earlier versions and outputs in place", "Add storage without moving the file tree", "Archive completed work on your own terms"],
})}
${audience("labs", "For research labs", "Shared notebooks, one source of truth.", "A lab runs on handoffs. Spindle keeps the handoff inside the project instead of in someone's inbox.", {
  title: "Work in the same session",
  body: "Lab sessions are shared, so a result is never stuck on one person's machine.",
  items: ["Shared kernels, live cursors, and comments", "Notebooks connected to the project file tree", "Inline previews for datasets and figures", "Project channels for discussion in context"],
}, {
  title: "Keep the method visible",
  body: "Automations and files live together, making it easier to see how a result was made.",
  items: ["Plain-language automations or cron jobs", "Sources and citations saved with the analysis", "A readable history of project activity", "Optional anonymous chat for sensitive topics"],
}, true)}
${audience("teams", "For research teams", "Channels, roles, and presence in the project.", "Give a distributed team a single place to coordinate the work and talk about it.", {
  title: "Talk where the work happens",
  body: "Team chat is part of the workspace, not another app to keep open.",
  items: ["Channels scoped to each project", "Presence indicators and shared context", "Optional anonymous mode (Nym Mixnet routing planned)", "Notes and links kept beside the conversation"],
}, {
  title: "Coordinate without ceremony",
  body: "Recurring work lives with the project it belongs to.",
  items: ["Automations for routine data steps", "Agent requests for repetitive edits", "One file tree for every artifact", "Clear ownership as the team changes"],
})}
${audience("institutions", "For institutions", "Room for a whole research group.", "Shared controls and central billing for departments that support many projects at once.", {
  title: "One place to manage",
  body: "Bring several labs onto the same workspace without fragmenting their projects.",
  items: ["Shared workspaces and roles", "Central billing and pooled storage", "Onboarding for a lab or department", "Consistent project structure across groups"],
}, {
  title: "Built to last",
  body: "Projects stay readable long after the original team has moved on.",
  items: ["Files and previews remain intact", "Notes and conversations stay with the project", "Archives stay on your own terms", "A single place to hand work over"],
}, true)}
${cta}`,
  },

  "pricing.html": {
    title: "Pricing",
    description: "Spindle is free for one researcher with 5 GB of storage. Labs and teams can talk to us about shared workspaces and central billing.",
    content: `
    <section class="page-hero">
      <div class="container">
        <div class="eyebrow">Pricing</div>
        <h1 class="page-title">Start free. Bring a project.</h1>
        <p class="page-lede">The full workspace, 5 GB of storage, and 20 agent requests a day — no credit card. Bigger research groups can talk to us about shared controls.</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="stats-grid">
          <div class="stat"><div class="stat-value">5<span class="stat-suffix"> GB</span></div><p>Storage per account</p></div>
          <div class="stat"><div class="stat-value">20</div><p>Agent requests every day</p></div>
          <div class="stat"><div class="stat-value">100<span class="stat-suffix">+</span></div><p>Formats detected inline</p></div>
          <div class="stat"><div class="stat-value">50</div><p>Extra requests by referral</p></div>
        </div>

        <div class="plan-cards">
          <div class="plan-card plan-card--free">
            <div class="plan-head"><span class="plan-name">Hobby</span> <span class="plan-price">$0</span></div>
            <p>For a single researcher or a project that's just getting started.</p>
            <ul>
              <li>5 GB storage</li>
              <li>Lab, Search, Files, Agent, and Chat</li>
              <li>Automations and cron jobs</li>
              <li>20 agent requests per day</li>
            </ul>
            <a href="index.html#get-started" class="btn btn--primary btn--full">Create your workspace</a>
          </div>
          <div class="plan-card">
            <div class="plan-head"><span class="plan-name">Enterprise</span><span class="plan-tag">TALK TO US</span></div>
            <p>Custom features, dedicated support, and anything your organization needs.</p>
            <ul>
              <li>Custom integrations and workflows</li>
              <li>Dedicated infrastructure and SLA</li>
              <li>Onboarding and training for your team</li>
            </ul>
            <a href="about.html#contact" class="btn btn--primary btn--full">Contact us</a>
          </div>
        </div>

        <div class="referral-note">${icon("i-users", "icon icon--xs")} Refer a friend and get <strong>+50 agent requests</strong>, one time, when they create an account with your link. <a href="docs.html#quickstart">See how to start ${icon("i-arrow-right", "icon icon--xs")}</a></div>
      </div>
    </section>
${cta}`,
  },

  "docs.html": {
    title: "Documentation",
    description: "Set up a Spindle workspace, connect a lab session, run local search, and write automations for your research project.",
    content: `
    <section class="page-hero">
      <div class="container">
        <div class="eyebrow">Documentation</div>
        <h1 class="page-title">Everything you need to get going.</h1>
        <p class="page-lede">A short path from an empty workspace to a project with files, a lab, sources, and a working automation.</p>
      </div>
    </section>

    <section class="section">
      <div class="container doc-layout">
        <aside class="doc-toc" aria-label="On this page">
          <h4>On this page</h4>
          <a href="#quickstart">Quickstart</a>
          <a href="#workspaces">Workspaces &amp; files</a>
          <a href="#lab">Lab sessions</a>
          <a href="#search">Local search</a>
          <a href="#automations">Automations</a>
          <a href="#guides">Guides</a>
        </aside>

        <div class="doc-content">
          <section class="doc-block" id="quickstart">
            <div class="eyebrow">Start here</div>
            <h2>Quickstart</h2>
            <p>A free workspace includes the whole platform. The first project is usually a folder, a notebook, and a few sources — add the rest as you need it.</p>
            <ol class="doc-steps">
              <li class="doc-step"><strong>Create a workspace.</strong> Pick a name you'll recognize later, like the study or lab you're working on.</li>
              <li class="doc-step"><strong>Add your first files.</strong> Upload a CSV, a notebook, or a PDF. Spindle detects common formats and previews them in place.</li>
              <li class="doc-step"><strong>Open the lab.</strong> Start RStudio, JupyterLab, VS Code, or a terminal on the same files.</li>
              <li class="doc-step"><strong>Run a search.</strong> Save results and citations into the project instead of a browser history.</li>
            </ol>
            <p class="doc-note">Need the short sales pitch instead? See <a href="pricing.html">pricing</a> or the <a href="index.html#get-started">homepage tour</a>.</p>
          </section>

          <section class="doc-block" id="workspaces">
            <div class="eyebrow">The basics</div>
            <h2>Workspaces &amp; files</h2>
            <p>Each project has its own file tree. Files, notes, results, and conversations stay with it, so handing a project to someone else means sharing one place rather than a pile of links.</p>
            <div class="code-card">
              <div class="code-card-head"><span>PROJECT LAYOUT</span><span>EXAMPLE</span></div>
              <pre>/coastal-resilience
  /data           measurements, exports
  /notebooks      R and Python analysis
  /sources        papers and search results
  /results        figures and tables
  project-log.md  decisions and handoffs</pre>
              <div class="code-card-foot"><span class="mono">5 GB FREE</span><span class="mono">100+ FORMATS</span></div>
            </div>
          </section>

          <section class="doc-block" id="lab">
            <div class="eyebrow">Compute</div>
            <h2>Lab sessions</h2>
            <p>Lab environments boot connected to the project files. Use RStudio for statistics, JupyterLab for notebooks, VS Code for code, or a terminal for everything else. Teammates can share kernels and leave comments in context.</p>
            <a class="text-link" href="lab.html">Explore the lab ${icon("i-arrow-right", "icon icon--xs")}</a>
          </section>

          <section class="doc-block" id="search">
            <div class="eyebrow">Sources</div>
            <h2>Local search</h2>
            <p>Academic mode queries BASE, arXiv, Crossref, Semantic Scholar, and OpenAlex. Basic mode uses Mojeek, Brave, and DuckDuckGo. Both run through a SearXNG instance hosted alongside Spindle, so results and notes stay inside the project.</p>
            <a class="text-link" href="index.html#search">See the search preview ${icon("i-arrow-right", "icon icon--xs")}</a>
          </section>

          <section class="doc-block" id="automations">
            <div class="eyebrow">Routines</div>
            <h2>Automations</h2>
            <p>Describe a repeated step in plain language or write a cron job yourself. Either way, the automation lives with the project it serves and can update files, notes, or results.</p>
            <div class="code-card">
              <div class="code-card-head"><span>CRON</span><span>WEEKLY</span></div>
              <pre>0 7 * * 1  refresh /data/tides.csv
             &amp;&amp; summarize changes to project-log.md</pre>
              <div class="code-card-foot"><span class="mono">PROJECT-SCOPED</span><span class="mono">EDITABLE</span></div>
            </div>
          </section>

          <section class="doc-block" id="guides">
            <div class="eyebrow">More</div>
            <h2>Guides</h2>
            <p>Short walkthroughs for the parts people use most. Each one opens the relevant preview on the homepage.</p>
            <div class="feature-grid doc-guides">
${featureCard("i-folder", "Organizing a project", "A file tree that stays readable after the field season.", "index.html#files")}
${featureCard("i-bolt", "Writing an automation", "Text it, build it, or write the cron.", "automations.html")}
${featureCard("i-sparkle", "Working with the agent", "What the daily request allowance covers.", "agent.html")}
            </div>
          </section>
        </div>
      </div>
    </section>`,
  },

  "about.html": {
    title: "About",
    description: "What Spindle is, why we built it, and how the workspace fits a full research project.",
    content: `
    <section class="page-hero">
      <div class="container">
        <div class="eyebrow">About</div>
        <h1 class="page-title">One workspace for the whole project.</h1>
        <p class="page-lede">Spindle is a research workspace. Files, notebooks, sources, automations, an agent, and the people you work with all stay attached to the project they belong to — free to start, local where it matters, and quiet enough to think in.</p>
        <div class="page-actions">
          <a href="index.html#get-started" class="btn btn--primary">Start free</a>
          <a href="platform.html" class="btn btn--ghost">See everything inside</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">Why we built it</div>
          <h2 class="section-title">The tools we had were never quite the tool we needed.</h2>
          <p class="section-desc">Research work is not writing, and it is not a meeting. It is a dataset, a notebook, a pile of sources, and a long trail of decisions that all have to survive together for months. The software we tried always handled one slice of that.</p>
        </div>
        <div class="duo-grid">
          <div class="duo-card">
            <span class="duo-badge">WHAT WE TRIED</span>
            <h3>Close, but built for something else</h3>
            <p>MS Teams does chat and calls, but it is licensed per seat, aimed at company-wide communication, and your actual project still lives in a folder somewhere else. Notion is a good place to write things down, but it cannot run the notebook, open the dataset, search your sources, or hold a project together for the six months it takes to finish.</p>
          </div>
          <div class="duo-card">
            <span class="duo-badge duo-badge--amber">WHAT WE BUILT</span>
            <h3>A project, opened in one place</h3>
            <p>Spindle puts the working parts of a project in the same window: files with previews, a lab for notebooks, search across your sources, automations that keep data fresh, an agent on call, and the conversation about the work. Nothing has to be reassembled when you come back to it.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--alt">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">What's inside</div>
          <h2 class="section-title">Six parts, one project.</h2>
          <p class="section-desc">Every page on this site is a view into the same workspace. Start from a file, follow it into a notebook, cite it in a note, then schedule the step that keeps it current.</p>
        </div>
        <div class="feature-grid">
${featureCard("i-folder", "Files that open", "5 GB free, with more than a hundred inline previews for data, PDFs, images, and code.", "index.html#files")}
${featureCard("i-flask", "A lab, not a scratchpad", "Jupyter notebooks, R, SQL, canvas, graphs, and math — all running against the project's own files.", "lab.html")}
${featureCard("i-search", "Search you host", "Academic and Basic modes, run locally, with every result tied back to the source it came from.", "index.html#search")}
${featureCard("i-bolt", "Routines that run", "Describe a repeated step in plain language or write the cron yourself. The automation lives with the project.", "automations.html")}
${featureCard("i-sparkle", "An agent with limits", "20 requests a day on the free plan, and 50 more for a referral. It reads the project, edits and moves files, and never acts without you.", "agent.html")}
${featureCard("i-users", "People in the same file", "Live cursors, roles, shared editing, and project channels — with anonymity available where it helps.", "collaboration.html")}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">How it behaves</div>
          <h2 class="section-title">Made to be lived in, not managed.</h2>
          <p class="section-desc">A workspace you keep coming back to should get out of the way. These are the choices behind the one we built.</p>
        </div>
        <div class="feature-grid">
          <div class="feature-card">
            <span class="card-icon">${icon("i-layers")}</span>
            <h3>Context over features</h3>
            <p>The reasoning stays next to the result, so the project explains itself later.</p>
          </div>
          <div class="feature-card">
            <span class="card-icon">${icon("i-shield")}</span>
            <h3>Local by default</h3>
            <p>Searches run on your own machine and the index stays yours. Anonymous chat is there when a project needs it.</p>
          </div>
          <div class="feature-card">
            <span class="card-icon">${icon("i-clock")}</span>
            <h3>Made to last</h3>
            <p>Plain files, readable output, and no lock-in on the work you have already finished.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--alt" id="contact">
      <div class="container">
        <div class="section-head">
          <div class="eyebrow">Contact</div>
          <h2 class="section-title">Questions about the workspace?</h2>
          <p class="section-desc">Two ways to go further: write to us about a lab, a team, or a department-wide workspace, or just put a real project in and see how it feels.</p>
        </div>
        <div class="contact-grid">
          <div class="contact-card">
            <span class="card-icon">${icon("i-message")}</span>
            <h3>Send an email</h3>
            <p>For product questions, onboarding, or a walkthrough of your team's workflow.</p>
            <a class="text-link" href="mailto:hello@spindle.example">hello@spindle.example ${icon("i-arrow-right", "icon icon--xs")}</a>
          </div>
          <div class="contact-card">
            <span class="card-icon">${icon("i-users")}</span>
            <h3>Bring a project</h3>
            <p>The fastest way to understand Spindle is to put a real project in it. Five gigabytes are free.</p>
            <a class="text-link" href="index.html#get-started">Create a free workspace ${icon("i-arrow-right", "icon icon--xs")}</a>
          </div>
        </div>
      </div>
    </section>`,
  },
}

for (const [name, page] of Object.entries(pages)) {
  const html = `${head(page.title, page.description)}${page.content}${tail}`
  writeFileSync(path.join(root, name), html)
  console.log(`wrote ${name}`)
}
