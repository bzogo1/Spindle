import { Suspense } from "react"
import { Globe } from "@/components/ui/globe"
import {
  AnonymousSwitch,
  CopyPromptButton,
  CronCommandBuilder,
  FeatureCards,
  FeatureGrid,
  FeatureListPrintButton,
  FileActions,
  HeroActions,
  HeroBadge,
  LocalSearchNote,
  PlanCards,
  PresenceAvatar,
  StorageProgress,
} from "@/components/home-islands"
import { HeroAppWindow } from "@/components/hero-app-window"
import { IntegrationsNetwork } from "@/components/integrations-network"
import { ScrollToPlatform } from "@/components/scroll-to-platform"
import { RecentlyViewedFeatures } from "@/components/site/recently-viewed-features"
import { createPageMetadata, defaultSiteDescription } from "@/lib/seo"
import { BackToTop } from "@/components/site/back-to-top"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { AutomationStatusPill } from "@/components/site/automation-status-pill"
import { TryPromptButton } from "@/components/site/try-prompt-button"
import { createSoftwareApplicationJsonLd, serializeJsonLd } from "@/lib/structured-data"
import { highlightCode } from "@/lib/code-highlight"
import {
  CRON_LANGUAGES,
  CRON_SCHEDULES,
  type CronCodeLines,
  type CronLanguageKey,
  type CronScheduleKey,
} from "@/lib/home-cron-snippets"
import type { ThemedToken } from "shiki/types"

export const metadata = createPageMetadata({
  title: "Spindle — One place for all your research",
  description: defaultSiteDescription,
  path: "/",
})

/** Last 10 `tide-sync.py` run durations in seconds (oldest → newest). */
const TIDE_SYNC_RUN_DURATIONS = [38, 45, 41, 52, 47, 36, 43, 49, 40, 42]

function RunSparkline({ data }: { data: number[] }) {
  const width = 72
  const height = 22
  const pad = 3
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data
    .map((value, index) => {
      const x = pad + (index / (data.length - 1)) * (width - pad * 2)
      const y = height - pad - ((value - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  const latest = data[data.length - 1]
  return (
    <span
      className="run-sparkline"
      title={`Last ${data.length} runs: ${data.join("s, ")}s`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="mono">{latest}s</span>
    </span>
  )
}

/**
 * Pre-highlights every schedule × runtime snippet for the homepage cron card
 * at request time. The token lines are plain serializable data, so the client
 * component can switch presets without shipping a syntax highlighter.
 */
async function buildCronCodeLines(): Promise<CronCodeLines> {
  const lines = {} as CronCodeLines

  for (const languageKey of Object.keys(CRON_LANGUAGES) as CronLanguageKey[]) {
    const language = CRON_LANGUAGES[languageKey]
    lines[languageKey] = {} as Record<CronScheduleKey, ThemedToken[][]>

    for (const scheduleKey of Object.keys(CRON_SCHEDULES) as CronScheduleKey[]) {
      const schedule = CRON_SCHEDULES[scheduleKey]
      const cron = await highlightCode(
        `# ${schedule.comment}\n${schedule.fields.join(" ")} ${language.command}`,
        "cron",
      )
      const script = await highlightCode(language.script, language.highlight)
      lines[languageKey][scheduleKey] = [...cron, [], ...script]
    }
  }

  return lines
}

export default async function HomePage() {
  const cronCodeLines = await buildCronCodeLines()
  return (
    <PageTransition>
      {/* SoftwareApplication JSON-LD for the homepage. The shared graph in
          the site layout emits the same entity (@id {siteUrl}/#software) on
          every page; identical @id + content merges cleanly in consumers. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(createSoftwareApplicationJsonLd()),
        }}
      />
      <main id="top" tabIndex={-1}>
        <section className="hero">
          <div className="hero-inner container">
            <HeroBadge />
            <h1 className="hero-title animate-gradient bg-[length:200%_auto] bg-clip-text bg-gradient-to-r from-foreground via-primary to-chart-2 text-transparent">
              One place for all your research
            </h1>
            <p className="hero-subtitle">
              Files, notebooks, search, automations, and your team, organized around the project
              instead of scattered across a dozen tabs.
            </p>
            <div className="hero-actions">
              <HeroActions />
            </div>
            <div className="hero-visual">
              <HeroAppWindow />
            </div>
          </div>
          <ScrollToPlatform />
        </section>
        <section className="integrations" id="integrations">
          <div className="integrations-inner container">
            <div className="integrations-copy">
              <div className="eyebrow">Integrations</div>
              <h2 className="section-title">Your stack, connected</h2>
              <p className="section-desc">
                Spindle plugs into the tools your research already runs on. Notebooks, datasets,
                references, and search stay in sync around the project.
              </p>
              <div className="integrations-meta">
                <i></i> 8 tools · one workspace
              </div>
            </div>
            <IntegrationsNetwork />
          </div>
        </section>
        <section className="section" id="platform">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Platform</div>
              <h2 className="section-title">A home for every project</h2>
              <p className="section-desc">
                Files, notebooks, results, conversations, and automations stay together, even when a
                project runs for years.
              </p>
              <FeatureListPrintButton />
            </div>
            {/* FeatureGrid reads `?topic=` via useSearchParams, which suspends
                to this boundary during prerender; the fallback shows the
                unfiltered cards. */}
            <Suspense
              fallback={
                <div className="feature-grid-block">
                  <div className="feature-grid">
                    <FeatureCards />
                  </div>
                </div>
              }
            >
              <FeatureGrid />
            </Suspense>
            <RecentlyViewedFeatures />
          </div>
        </section>
        <section className="section section--alt" id="automations">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Automations</div>
              <h2 className="section-title">Describe a workflow, or write one yourself</h2>
              <p className="section-desc">
                Two ways to make a project run itself. Both share the same guardrails, run history,
                and logs.
              </p>
            </div>
            <div className="duo-grid">
              <article className="duo-card">
                <div className="duo-badge">
                  <svg className="icon icon--xs">
                    <use href="#i-sparkle" />
                  </svg>{" "}
                  IN PLAIN LANGUAGE
                </div>
                <h3>Automations</h3>
                <p>
                  Tell Spindle what should happen. It turns your sentence into a repeatable workflow
                  with a preview before anything runs.
                </p>
                <ul className="check-list">
                  <li>“Refresh tide data every Monday”</li>
                  <li>“Summarize new sources into notes.md”</li>
                  <li>“Flag rows that look wrong”</li>
                </ul>
                <div className="prompt-card">
                  <p>
                    When a new CSV lands in <strong>/data</strong>, clean it and add a short summary
                    to the project log.
                  </p>
                  <div className="prompt-foot">
                    <span>Spindle drafted 4 steps</span>
                    <span className="prompt-foot-actions">
                      <TryPromptButton />
                      <CopyPromptButton />
                      <span className="prompt-live">
                        <i></i> Ready to review
                      </span>
                    </span>
                  </div>
                </div>
              </article>
              <article className="duo-card">
                <div className="duo-badge duo-badge--amber">
                  <svg className="icon icon--xs">
                    <use href="#i-code" />
                  </svg>{" "}
                  IN CODE
                </div>
                <h3>Cron jobs</h3>
                <p>
                  Write the automation yourself. Schedule any script against your project files,
                  with the runtime and secrets already wired up.
                </p>
                <ul className="check-list">
                  <li>Full cron syntax and timezones</li>
                  <li>Your code, your dependencies</li>
                  <li>Run history and failure alerts</li>
                </ul>
                <CronCommandBuilder
                  codeLines={cronCodeLines}
                  footer={
                    <>
                      <AutomationStatusPill />
                      <RunSparkline data={TIDE_SYNC_RUN_DURATIONS} />
                    </>
                  }
                />
              </article>
            </div>
          </div>
        </section>
        <section className="section" id="lab">
          <div className="split-grid container">
            <div className="split-copy">
              <div className="eyebrow">The lab</div>
              <h2 className="section-title">Your tools, already running</h2>
              <p className="section-desc">
                Every project has a Lab tab. Open the environment you already know, with your files
                mounted and your packages waiting.
              </p>
              <ul className="feature-list">
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Preinstalled stacks</strong>
                    <small>Python, R, Julia, and common research libraries</small>
                  </span>
                </li>
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Snapshots per run</strong>
                    <small>Rewind a notebook or analysis to any point</small>
                  </span>
                </li>
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Shared kernels</strong>
                    <small>Pair on an analysis like it's a document</small>
                  </span>
                </li>
              </ul>
              <a href="/lab" className="text-link">
                Explore the full Lab{" "}
                <svg className="icon icon--xs">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
            </div>
            <div className="product-window lab-window">
              <div className="window-bar">
                <div className="traffic-lights" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
                <span className="window-bar-title" id="labWindowTitle">
                  coastal-resilience / lab
                </span>
                <span className="window-bar-status">
                  <i></i> <span id="labWindowStatus">Kernel idle</span>
                </span>
              </div>
              <div className="lab-tabs" role="tablist" aria-label="Lab environments">
                <button
                  className="lab-tab is-active"
                  id="lab-tab-rstudio"
                  role="tab"
                  aria-selected="true"
                  aria-controls="lab-panel-rstudio"
                  data-lab-tab="rstudio"
                  data-lab-title="coastal-resilience / lab"
                  data-lab-status="Kernel idle"
                >
                  RStudio
                </button>
                <button
                  className="lab-tab"
                  id="lab-tab-jupyter"
                  role="tab"
                  aria-selected="false"
                  aria-controls="lab-panel-jupyter"
                  tabIndex={-1}
                  data-lab-tab="jupyter"
                  data-lab-title="coastal-resilience / analysis.ipynb"
                  data-lab-status="Python 3.12 · idle"
                >
                  JupyterLab
                </button>
                <button
                  className="lab-tab"
                  id="lab-tab-vscode"
                  role="tab"
                  aria-selected="false"
                  aria-controls="lab-panel-vscode"
                  tabIndex={-1}
                  data-lab-tab="vscode"
                  data-lab-title="coastal-resilience / clean_data.py"
                  data-lab-status="Workspace open"
                >
                  VS Code
                </button>
                <button
                  className="lab-tab"
                  id="lab-tab-terminal"
                  role="tab"
                  aria-selected="false"
                  aria-controls="lab-panel-terminal"
                  tabIndex={-1}
                  data-lab-tab="terminal"
                  data-lab-title="coastal-resilience — zsh"
                  data-lab-status="Shell ready"
                >
                  Terminal
                </button>
              </div>
              <div className="lab-screen">
                <div
                  className="lab-panel is-active"
                  id="lab-panel-rstudio"
                  data-lab-panel="rstudio"
                  role="tabpanel"
                  aria-labelledby="lab-tab-rstudio"
                >
                  <div className="rstudio-layout">
                    <div className="rstudio-editor">
                      <div className="rstudio-tab">analysis.R</div>
                      <pre>
                        <span className="tok-com">{"# read project data directly"}</span>
                        {"\nsurvey <- read_parquet("}
                        <span className="tok-str">{'"data/survey.parquet"'}</span>
                        {")\n\n"}
                        <span className="tok-fn">{"ggplot"}</span>
                        {"(survey, "}
                        <span className="tok-fn">{"aes"}</span>
                        {"(x = salinity, y = turbidity)) +\n  "}
                        <span className="tok-fn">{"geom_point"}</span>
                        {"(alpha = "}
                        <span className="tok-num">{"0.7"}</span>
                        {") +\n  "}
                        <span className="tok-fn">{"theme_minimal"}</span>
                        {"()"}
                      </pre>
                    </div>
                    <div className="rstudio-plot">
                      <div className="plot-title">salinity vs. turbidity</div>
                      <svg viewBox="0 0 200 110" preserveAspectRatio="none">
                        <path
                          d="M0 96H200M0 72H200M0 48H200M0 24H200"
                          stroke="rgba(255,255,255,.07)"
                        />
                        <g fill="#bfe389">
                          <circle cx="32" cy="78" r="3" />
                          <circle cx="58" cy="66" r="3" />
                          <circle cx="76" cy="72" r="3" />
                          <circle cx="98" cy="52" r="3" />
                          <circle cx="118" cy="58" r="3" />
                          <circle cx="142" cy="38" r="3" />
                          <circle cx="166" cy="44" r="3" />
                          <circle cx="184" cy="26" r="3" />
                        </g>
                      </svg>
                    </div>
                  </div>
                </div>
                <div
                  className="lab-panel"
                  id="lab-panel-jupyter"
                  data-lab-panel="jupyter"
                  role="tabpanel"
                  aria-labelledby="lab-tab-jupyter"
                  hidden
                >
                  <div className="jupyter-shell">
                    <div className="jupyter-menu" aria-hidden="true">
                      <span>File</span>
                      <span>Edit</span>
                      <span>Run</span>
                      <span>Kernel</span>
                      <span>Tabs</span>
                      <span className="jupyter-kernel">
                        <i></i> <span id="labMenuKernelName">Python 3.12</span>
                      </span>
                    </div>
                    <div className="jupyter-kernel-bar">
                      <label className="kernel-picker">
                        <span className="kernel-picker-label">Kernel</span>
                        <select
                          className="kernel-select"
                          data-kernel-select
                          data-kernel-status="labKernelStatusText"
                          data-kernel-mirror="labMenuKernelName"
                          aria-label="Select kernel"
                          defaultValue="Python 3.12"
                        >
                          <option value="Python 3.12">Python 3.12</option>
                          <option value="R 4.4">R 4.4</option>
                          <option value="Julia 1.10">Julia 1.10</option>
                        </select>
                      </label>
                      <span className="jupyter-kernel-status">
                        <i></i> <span id="labKernelStatusText">Python 3.12 · idle</span>
                      </span>
                    </div>
                    <div className="notebook notebook--large">
                      <div className="notebook-cell">
                        <span className="cell-in">[1]</span>
                        <code>
                          <span className="tok-key">import</span> geopandas{" "}
                          <span className="tok-key">as</span> gpd
                          <br />
                          sites = gpd.read_file(
                          <span className="tok-str">'data/sites.geojson'</span>)
                        </code>
                      </div>
                      <div className="notebook-out">
                        <span className="cell-out">out</span>
                        <span>17 features loaded · CRS EPSG:4326</span>
                      </div>
                      <div className="notebook-cell">
                        <span className="cell-in">[2]</span>
                        <code>
                          sites.plot(column=<span className="tok-str">'recovery'</span>, cmap=
                          <span className="tok-str">'YlGn'</span>, legend=
                          <span className="tok-key">True</span>)
                        </code>
                      </div>
                      <div className="notebook-map" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="lab-panel"
                  id="lab-panel-vscode"
                  data-lab-panel="vscode"
                  role="tabpanel"
                  aria-labelledby="lab-tab-vscode"
                  hidden
                >
                  <div className="vscode-layout">
                    <div className="vscode-tree" aria-hidden="true">
                      <span className="tree-head">EXPLORER</span>
                      <span>v</span> coastal-resilience
                      <br />
                      <span className="indent">v data</span>
                      <br />
                      <span className="indent indent--2">tidal-2026.csv</span>
                      <br />
                      <span className="indent indent--2">survey.parquet</span>
                      <br />
                      <span className="indent">v notebooks</span>
                      <br />
                      <span className="indent indent--2">analysis.ipynb</span>
                      <br />
                      <span className="indent">clean_data.py</span>
                    </div>
                    <div className="vscode-editor">
                      <div className="vscode-tabs" role="tablist" aria-label="VS Code file tabs">
                        <button
                          className="vscode-tab is-active"
                          role="tab"
                          aria-selected="true"
                          data-vscode-file="clean_data.py"
                          data-vscode-breadcrumb="data › clean_data.py › tidy()"
                          data-vscode-code={
                            '<span class="tok-key">from</span> spindle <span class="tok-key">import</span> project\n\ndf = project.data.load(<span class="tok-str">&quot;tidal-2026.csv&quot;</span>)\ndf = df.dropna(subset=[<span class="tok-str">&quot;salinity&quot;</span>])\ndf[<span class="tok-str">&quot;salinity&quot;</span>] = df[<span class="tok-str">&quot;salinity&quot;</span>].round(<span class="tok-num">2</span>)\nproject.data.save(df, <span class="tok-str">&quot;output/clean.csv&quot;</span>)'
                          }
                        >
                          clean_data.py
                        </button>
                        <button
                          className="vscode-tab"
                          role="tab"
                          aria-selected="false"
                          tabIndex={-1}
                          data-vscode-file="tide_sync.py"
                          data-vscode-breadcrumb="scripts › tide_sync.py › sync()"
                          data-vscode-code={
                            '<span class="tok-com"># every weekday at 06:00</span>\n<span class="tok-com"># 0 6 * * 1-5 python tide-sync.py</span>\n\n<span class="tok-key">from</span> spindle <span class="tok-key">import</span> project\n<span class="tok-key">import</span> pandas <span class="tok-key">as</span> pd\n\n<span class="tok-com"># Fetch latest tide data from NOAA API</span>\ntide_data = project.external.fetch(<span class="tok-str">&quot;noaa-tides&quot;</span>, station=<span class="tok-str">&quot;8454000&quot;</span>)\n\n<span class="tok-com"># Merge with existing data</span>\nexisting = project.data.load(<span class="tok-str">&quot;data/tides.csv&quot;</span>)\nmerged = pd.concat([existing, tide_data]).drop_duplicates()\n\n<span class="tok-com"># Save back</span>\nproject.data.save(merged, <span class="tok-str">&quot;data/tides.csv&quot;</span>)'
                          }
                        >
                          tide_sync.py
                        </button>
                      </div>
                      <div className="vscode-breadcrumb" id="vscodeBreadcrumb">
                        data › clean_data.py › tidy()
                      </div>
                      <pre id="vscodeCode">
                        <span className="tok-key">from</span> spindle{" "}
                        <span className="tok-key">import</span> project df = project.data.load(
                        <span className="tok-str">"tidal-2026.csv"</span>) df = df.dropna(subset=[
                        <span className="tok-str">"salinity"</span>]) df[
                        <span className="tok-str">"salinity"</span>] = df[
                        <span className="tok-str">"salinity"</span>].round(
                        <span className="tok-num">2</span>) project.data.save(df,{" "}
                        <span className="tok-str">"output/clean.csv"</span>)
                      </pre>
                      <div className="vscode-status">
                        <span>⑂ main</span>
                        <span>Python 3.12 · UTF-8</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="lab-panel"
                  id="lab-panel-terminal"
                  data-lab-panel="terminal"
                  role="tabpanel"
                  aria-labelledby="lab-tab-terminal"
                  hidden
                >
                  <div className="terminal-card-body terminal-card-body--lab">
                    <div>
                      <span className="term-prompt">➜</span>{" "}
                      <span className="term-dir">coastal-resilience</span>{" "}
                      <span className="term-branch">git:(main)</span> spindle lab start --kernel
                      python
                    </div>
                    <div className="term-dim">◐ Mounting project files…</div>
                    <div className="term-success">✓ Python 3.12 · 24 packages ready</div>
                    <div>
                      <span className="term-prompt">➜</span>{" "}
                      <span className="term-dir">coastal-resilience</span>{" "}
                      <span className="term-branch">git:(main)</span> ls data
                    </div>
                    <div className="term-dim">tidal-2026.csv  survey.parquet  sites.geojson</div>
                    <div>
                      <span className="term-prompt">➜</span>{" "}
                      <span className="term-dir">coastal-resilience</span>{" "}
                      <span className="term-branch">git:(main)</span>{" "}
                      <span className="term-caret"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="section section--alt" id="search">
          <div className="split-grid split-grid--reverse container">
            <div className="product-window search-console">
              <div className="window-bar">
                <div className="traffic-lights" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
                <span className="window-bar-title">search / coastal-resilience</span>
                <span className="window-bar-status">
                  <i></i> LOCAL
                </span>
              </div>
              <div className="console-body">
                <div className="segmented" role="group" aria-label="Search mode">
                  <button
                    className="segment is-active"
                    data-search-mode="academic"
                    aria-pressed="true"
                  >
                    Academic
                  </button>
                  <button className="segment" data-search-mode="basic" aria-pressed="false">
                    Basic
                  </button>
                </div>
                <div className="console-query">
                  <svg className="icon icon--sm">
                    <use href="#i-search" />
                  </svg>
                  <input
                    id="searchInput"
                    type="search"
                    defaultValue="salt marsh restoration blue carbon"
                    placeholder="Search papers, datasets, notes…"
                    aria-label="Search query"
                    enterKeyHint="search"
                    autoComplete="off"
                  />
                  <button
                    className="console-go"
                    id="searchGo"
                    type="button"
                    aria-label="Run search (preview)"
                  >
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </button>
                </div>
                <div className="engine-row" id="engineRow" aria-label="Search engines in this mode">
                  <button type="button" className="engine-chip is-active" data-engine="BASE" aria-pressed="true">BASE</button>
                  <button type="button" className="engine-chip is-active" data-engine="arXiv" aria-pressed="true">arXiv</button>
                  <button type="button" className="engine-chip is-active" data-engine="Crossref" aria-pressed="true">Crossref</button>
                  <button type="button" className="engine-chip is-active" data-engine="Semantic Scholar" aria-pressed="true">Semantic Scholar</button>
                  <button type="button" className="engine-chip is-active" data-engine="OpenAlex" aria-pressed="true">OpenAlex</button>
                </div>
                <div className="results-head">
                  <span data-results-count aria-live="polite">
                    Preview results
                  </span>
                  <span className="mono" id="resultsMode">
                    ACADEMIC MODE
                  </span>
                </div>
                <div className="results-list" id="resultsList" aria-live="polite">
                  <article className="result-item">
                    <span className="result-index">01</span>
                    <div>
                      <span className="result-title">
                        Blue carbon sequestration in restored tidal marshes
                      </span>
                      <p>Journal of Environmental Management · 2024</p>
                      <span className="result-tag">BASE · open access</span>
                    </div>
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>
                  </article>
                  <article className="result-item">
                    <span className="result-index">02</span>
                    <div>
                      <span className="result-title">
                        Remote sensing of coastal vegetation recovery
                      </span>
                      <p>arXiv · Physics · 2023</p>
                      <span className="result-tag">arXiv · preprint</span>
                    </div>
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>
                  </article>
                  <article className="result-item">
                    <span className="result-index">03</span>
                    <div>
                      <span className="result-title">
                        Long-term sediment accretion after rewetting
                      </span>
                      <p>OpenAlex · 2025 · 118 citations</p>
                      <span className="result-tag">OpenAlex · cited by</span>
                    </div>
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>
                  </article>
                </div>
                <div
                  className="results-pager"
                  id="searchPager"
                  role="navigation"
                  aria-label="Search result pages"
                  hidden
                >
                  <button type="button" className="pager-btn" id="searchPrevPage" disabled>
                    ← Previous
                  </button>
                  <span className="pager-status" id="searchPageStatus" aria-live="polite"></span>
                  <button type="button" className="pager-btn" id="searchNextPage" disabled>
                    Next →
                  </button>
                </div>
                <div className="console-foot" id="searchFoot">
                  Preview only — results come from a small local demo index.
                </div>
                <div className="search-alert-row">
                  <button
                    type="button"
                    className="search-alert-btn"
                    id="searchAlertBtn"
                    aria-pressed="false"
                  >
                    <svg className="icon icon--sm" aria-hidden="true">
                      <use href="#i-bell" />
                    </svg>
                    <span data-alert-label>Create search alert</span>
                  </button>
                  <span className="search-alert-status" id="searchAlertStatus" aria-live="polite">
                    Get an email when this search has new results.
                  </span>
                </div>
              </div>
            </div>
            <div className="split-copy">
              <div className="eyebrow">Search</div>
              <h2 className="section-title">Academic depth, basic speed</h2>
              <p className="section-desc">
                Search runs through a SearXNG instance local to Spindle. Flip between modes without
                leaving the project. Results, citations, and notes land next to your files.
              </p>
              <div className="mode-explain" role="group" aria-label="Choose a search mode">
                <button
                  type="button"
                  className="mode-explain-item is-active"
                  data-search-mode="academic"
                  aria-pressed="true"
                >
                  <span className="mode-icon mode-icon--academic">
                    <svg className="icon icon--xs">
                      <use href="#i-layers" />
                    </svg>
                  </span>
                  <span>
                    <strong>Academic</strong>
                    <p>
                      BASE, arXiv, Crossref, Semantic Scholar, and OpenAlex for papers and
                      citations.
                    </p>
                  </span>
                </button>
                <button
                  type="button"
                  className="mode-explain-item"
                  data-search-mode="basic"
                  aria-pressed="false"
                >
                  <span className="mode-icon mode-icon--basic">
                    <svg className="icon icon--xs">
                      <use href="#i-globe" />
                    </svg>
                  </span>
                  <span>
                    <strong>Basic</strong>
                    <p>
                      Mojeek, Brave, and DuckDuckGo for the wider web, news, and practical
                      references.
                    </p>
                  </span>
                </button>
              </div>
              <LocalSearchNote />
            </div>
          </div>
        </section>
        <section className="section" id="files">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Files</div>
              <h2 className="section-title">A file manager built for research data</h2>
              <p className="section-desc">
                Upload, organize, and preview 100+ formats inline, including datasets and notebooks.
                5 GB free from day one.
              </p>
            </div>
            <div className="files-layout">
              <div className="product-window file-manager">
                <div className="window-bar">
                  <div className="traffic-lights" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <span className="window-bar-title">
                    <svg className="icon icon--xs">
                      <use href="#i-folder" />
                    </svg>{" "}
                    coastal-resilience / data
                  </span>
                  <span className="window-bar-status" id="fmCount">
                    128 items
                  </span>
                </div>
                <div className="fm-toolbar">
                  <label className="fm-search" htmlFor="fileSearch">
                    <svg className="icon icon--xs">
                      <use href="#i-search" />
                    </svg>
                    <input
                      id="fileSearch"
                      type="search"
                      placeholder="Search this project"
                      aria-label="Search this project"
                      autoComplete="off"
                    />
                  </label>
                  <span>
                    <FileActions />
                  </span>
                  <button className="fm-btn fm-btn--solid" id="fmUpload" type="button">
                    <svg className="icon icon--xs">
                      <use href="#i-upload" />
                    </svg>{" "}
                    Upload
                  </button>
                  <input id="fmUploadInput" type="file" multiple hidden />
                </div>
                <div className="fm-columns">
                  <span>Name</span>
                  <span>Detected as</span>
                  <span>Modified</span>
                  <span>Size</span>
                </div>
                <div className="fm-list" id="fileList">
                  <button
                    className="fm-row is-selected"
                    data-name="tidal-2026.csv"
                    data-format="CSV · tabular"
                    data-kind="csv"
                    data-meta="2.4 MB · modified 2 min ago"
                  >
                    <span className="fm-name">
                      <span className="file-ext file-ext--csv">CSV</span> tidal-2026.csv
                    </span>
                    <span className="fm-type">Comma-separated values</span>
                    <span className="fm-date">2 min ago</span>
                    <span className="fm-size">2.4 MB</span>
                  </button>
                  <button
                    className="fm-row"
                    data-name="survey.parquet"
                    data-format="Parquet · columnar"
                    data-kind="parquet"
                    data-meta="86 MB · modified yesterday"
                  >
                    <span className="fm-name">
                      <span className="file-ext file-ext--parquet">PQ</span> survey.parquet
                    </span>
                    <span className="fm-type">Apache Parquet</span>
                    <span className="fm-date">Yesterday</span>
                    <span className="fm-size">86 MB</span>
                  </button>
                  <button
                    className="fm-row"
                    data-name="analysis.ipynb"
                    data-format="Jupyter notebook"
                    data-kind="ipynb"
                    data-meta="410 KB · modified 4 hours ago"
                  >
                    <span className="fm-name">
                      <span className="file-ext file-ext--ipynb">IPY</span> analysis.ipynb
                    </span>
                    <span className="fm-type">Jupyter Notebook</span>
                    <span className="fm-date">4 hours ago</span>
                    <span className="fm-size">410 KB</span>
                  </button>
                  <button
                    className="fm-row"
                    data-name="site-photos.pdf"
                    data-format="PDF · document"
                    data-kind="pdf"
                    data-meta="18 MB · modified Mar 12"
                  >
                    <span className="fm-name">
                      <span className="file-ext file-ext--pdf">PDF</span> site-photos.pdf
                    </span>
                    <span className="fm-type">Portable Document Format</span>
                    <span className="fm-date">Mar 12</span>
                    <span className="fm-size">18 MB</span>
                  </button>
                  <button
                    className="fm-row"
                    data-name="marsh-core.tif"
                    data-format="TIFF · raster image"
                    data-kind="image"
                    data-meta="34 MB · modified Mar 09"
                  >
                    <span className="fm-name">
                      <span className="file-ext file-ext--tif">TIF</span> marsh-core.tif
                    </span>
                    <span className="fm-type">GeoTIFF image</span>
                    <span className="fm-date">Mar 09</span>
                    <span className="fm-size">34 MB</span>
                  </button>
                </div>
                <div className="fm-storage">
                  <div className="fm-storage-label">
                    <span>
                      <svg className="icon icon--xs">
                        <use href="#i-cube" />
                      </svg>{" "}
                      Storage
                    </span>
                    <strong>
                      1.8 GB <span>/ 5 GB free</span>
                    </strong>
                  </div>
                  <div className="fm-storage-track">
                    <StorageProgress />
                  </div>
                </div>
              </div>
              <div className="files-aside">
                <div className="preview-card">
                  <div className="preview-head">
                    <span>
                      <svg className="icon icon--xs">
                        <use href="#i-eye" />
                      </svg>{" "}
                      Inline preview
                    </span>
                    <span className="preview-format" id="previewFormat">
                      CSV · tabular
                    </span>
                  </div>
                  <div className="preview-body" id="previewBody">
                    <div className="preview-title" id="previewName">
                      tidal-2026.csv
                    </div>
                    <div className="preview-table">
                      <span>site_id</span>
                      <span>salinity</span>
                      <span>turbidity</span>
                      <span>date</span>
                      <span>A-01</span>
                      <span>28.4</span>
                      <span>3.1</span>
                      <span>06/02</span>
                      <span>A-02</span>
                      <span>27.9</span>
                      <span>3.4</span>
                      <span>06/02</span>
                    </div>
                    <div className="preview-meta" id="previewMeta">
                      2.4 MB · modified 2 min ago
                    </div>
                  </div>
                  <div className="preview-foot">
                    <span>Detected automatically</span>
                    <span className="mono">100+ FORMATS</span>
                  </div>
                </div>
                <div className="format-support">
                  <h3>One viewer, almost anything</h3>
                  <p>
                    Documents, spreadsheets, datasets, images, media, archives, code, and notebooks,
                    opened in place.
                  </p>
                  <div className="format-chips">
                    <span>PDF</span>
                    <span>DOCX</span>
                    <span>XLSX</span>
                    <span>CSV</span>
                    <span>Parquet</span>
                    <span>JSON</span>
                    <span>IPYNB</span>
                    <span>TIFF</span>
                    <span>MP4</span>
                    <span>ZIP</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="section section--alt" id="agent">
          <div className="split-grid container">
            <div className="split-copy">
              <div className="eyebrow">Agent</div>
              <h2 className="section-title">An agent that knows the project</h2>
              <p className="section-desc">
                Ask it to clean a dataset, refactor a folder, or update a spreadsheet. Every change
                is reviewable before it lands.
              </p>
              <div className="allowance">
                <div className="allowance-main">
                  <span className="allowance-num">20</span>
                  <span className="allowance-unit">
                    agent requests
                    <br />
                    every day
                  </span>
                </div>
                <div className="allowance-bonus">
                  <span className="bonus-plus">+50</span>
                  <p>more requests, one time, when a friend joins with your referral.</p>
                </div>
              </div>
              <div className="agent-actions">
                <a href="/sign-up" className="text-link">
                  Use your first request{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a href="/agent" className="text-link">
                  Explore the agent{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div className="product-window agent-window">
              <div className="window-bar">
                <div className="traffic-lights" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
                <span className="window-bar-title">
                  <svg className="icon icon--xs">
                    <use href="#i-sparkle" />
                  </svg>{" "}
                  Agent · coastal-resilience
                </span>
                <span className="window-bar-status">
                  <i></i> 14 / 20 left
                </span>
              </div>
              <div className="agent-body">
                <div className="agent-prompt-label">REQUEST</div>
                <div className="agent-prompt" id="agentPrompt">
                  Refactor the data pipeline and update results.csv with the new columns.
                </div>
                <div className="agent-suggestions" role="group" aria-label="Example agent requests">
                  <button className="suggestion is-active" data-agent-example="refactor">
                    Refactor files
                  </button>
                  <button className="suggestion" data-agent-example="spreadsheet">
                    Edit a spreadsheet
                  </button>
                  <button className="suggestion" data-agent-example="summarize">
                    Summarize sources
                  </button>
                </div>
                <div className="agent-trace" id="agentTrace">
                  <div className="trace-row is-done">
                    <span className="trace-icon">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      Read 12 files in <strong>/data</strong> and <strong>/notebooks</strong>
                    </span>
                    <time>0.4s</time>
                  </div>
                  <div className="trace-row is-done">
                    <span className="trace-icon">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      Split cleaning logic into <strong>clean_data.py</strong>
                    </span>
                    <time>1.2s</time>
                  </div>
                  <div className="trace-row is-running">
                    <span className="trace-icon">
                      <span className="trace-pulse"></span>
                    </span>
                    <span>
                      Updating <strong>results.csv</strong> — added 3 columns
                    </span>
                    <time>2.8s</time>
                  </div>
                  <div className="trace-row">
                    <span className="trace-icon trace-icon--empty"></span>
                    <span>Write a short summary to project log</span>
                    <time>—</time>
                  </div>
                </div>
                <div className="agent-diff">
                  <span>
                    <i className="diff-add"></i> +84 lines
                  </span>
                  <span>
                    <i className="diff-del"></i> −19 lines
                  </span>
                  <span className="agent-diff-note">Nothing applied until you review</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="section" id="chat">
          <div className="split-grid split-grid--reverse container">
            <div className="product-window chat-window">
              <div className="chat-layout">
                <aside className="chat-sidebar">
                  <div className="chat-workspace">
                    coastal-resilience{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-chevron-down" />
                    </svg>
                  </div>
                  <div className="chat-section-label">CHANNELS</div>
                  <button
                    type="button"
                    className="chat-channel is-active"
                    data-chat-channel="field-notes"
                  >
                    <span>#</span> field-notes
                  </button>
                  <button type="button" className="chat-channel" data-chat-channel="data-cleaning">
                    <span>#</span> data-cleaning
                  </button>
                  <button type="button" className="chat-channel" data-chat-channel="writing">
                    <span>#</span> writing
                  </button>
                  <button type="button" className="chat-channel" data-chat-channel="random">
                    <span>#</span> random
                  </button>
                  <div className="chat-section-label chat-section-label--spaced">DIRECT</div>
                  <button type="button" className="chat-channel" data-chat-channel="mara">
                    <span className="presence-dot"></span> Mara{" "}
                    <span className="chat-you">you</span>
                  </button>
                  <button type="button" className="chat-channel" data-chat-channel="theo">
                    <span className="presence-dot presence-dot--away"></span> Theo
                  </button>
                  <button className="anon-toggle" id="anonToggle" aria-pressed="false" hidden>
                    <span className="anon-switch">
                      <i></i>
                    </span>
                    <span>
                      <strong>Anonymous mode</strong>
                      <small id="anonStatus">Off · normal project chat</small>
                    </span>
                  </button>
                  <AnonymousSwitch />
                </aside>
                <div className="chat-main">
                  <div className="chat-head">
                    <span>
                      <span className="chat-hash" id="chatHash">
                        #
                      </span>{" "}
                      <span id="chatChannelName">field-notes</span>
                    </span>
                    <span className="chat-head-meta" id="chatRoute">
                      8 members · project channel
                    </span>
                  </div>
                  <div className="chat-messages" id="chatMessages" aria-live="polite">
                    <div className="chat-msg">
                      <span className="mini-avatar mini-avatar--a">MR</span>
                      <div>
                        <strong>
                          Mara <time>09:14</time>
                        </strong>
                        <p>
                          New survey batch is in /data. The viewer detected it as Parquet right
                          away.
                        </p>
                      </div>
                    </div>
                    <div className="chat-msg">
                      <span className="mini-avatar mini-avatar--b">JL</span>
                      <div>
                        <strong>
                          Jules <time>09:18</time>
                        </strong>
                        <p>
                          Nice. I kicked off the cron refresh and the lab still has the kernel from
                          yesterday.
                        </p>
                      </div>
                    </div>
                    <form className="chat-composer" id="chatComposer">
                      <input
                        id="chatInput"
                        type="text"
                        placeholder="Message #field-notes"
                        aria-label="Message #field-notes"
                        autoComplete="off"
                      />
                      <button type="submit" className="chat-send" aria-label="Send message">
                        <svg className="icon icon--xs">
                          <use href="#i-arrow-right" />
                        </svg>
                      </button>
                    </form>
                  </div>
                </div>
              </div>
              <div className="route-strip" id="routeStrip" aria-hidden="true">
                <span>YOU</span>
                <i></i>
                <span className="route-node"></span>
                <i></i>
                <span className="route-node"></span>
                <i></i>
                <span className="route-node"></span>
                <i></i>
                <span>PROJECT</span>
              </div>
            </div>
            <div className="split-copy">
              <div className="eyebrow">Team chat</div>
              <h2 className="section-title">Talk where the work happens</h2>
              <p className="section-desc">
                Channels live inside each project, like Discord or Slack, but the conversation stays
                next to the files and decisions it belongs to.
              </p>
              <div className="privacy-note">
                <div className="privacy-note-head">
                  <svg className="icon icon--xs">
                    <use href="#i-shield" />
                  </svg>{" "}
                  ANONYMOUS MODE
                </div>
                <p>
                  Anonymous mode posts under a pseudonymous display name in the thread. Routing
                  through the Nym Mixnet, which hides the patterns your communications leave behind,
                  is planned.
                </p>
                <a href="https://nym.com/" target="_blank" rel="noopener noreferrer">
                  Learn about Nym{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-up-right" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </section>
        <section className="section collab-section" id="collaboration">
          <div className="split-grid collab-grid container">
            <div className="split-copy">
              <div className="eyebrow">Collaboration</div>
              <h2 className="section-title">One project, everyone in sync</h2>
              <p className="section-desc">
                Work in the same notebook at the same time. See cursors as they move, edit side by
                side, and leave comments right where the data lives. No exports, no{" "}
                <span className="mono">final_v3</span> copies.
              </p>
              <ul className="feature-list">
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Live cursors and presence</strong>
                    <small>See who is in the project and where they are working</small>
                  </span>
                </li>
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Real-time editing</strong>
                    <small>
                      Pair on notebooks, notes, and data the way you would in a document
                    </small>
                  </span>
                </li>
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Comments in context</strong>
                    <small>Keep feedback next to the file, cell, or row it refers to</small>
                  </span>
                </li>
                <li>
                  <span className="feature-check">
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span>
                    <strong>Shared history</strong>
                    <small>Every change is attributable and easy to rewind</small>
                  </span>
                </li>
              </ul>
              <div className="collab-cta-links">
                <a href="/sign-up" className="text-link">
                  Bring your team in{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a href="/collaboration" className="text-link">
                  Explore live collaboration{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div
              className="globe-visual"
              role="img"
              aria-label="Animated globe showing teammates editing and commenting together in real time"
            >
              <span className="globe-glow globe-glow--wide" aria-hidden="true"></span>
              <span className="globe-glow" aria-hidden="true"></span>
              <svg className="globe-orbit" viewBox="0 0 560 560" aria-hidden="true">
                <ellipse
                  className="orbit-line"
                  cx="280"
                  cy="280"
                  rx="252"
                  ry="106"
                  transform="rotate(-22 280 280)"
                />
                <ellipse
                  className="orbit-line orbit-line--flow"
                  cx="280"
                  cy="280"
                  rx="252"
                  ry="106"
                  transform="rotate(-22 280 280)"
                  pathLength={100}
                />
                <ellipse
                  className="orbit-line orbit-line--soft"
                  cx="280"
                  cy="280"
                  rx="232"
                  ry="150"
                  transform="rotate(26 280 280)"
                />
                <circle className="orbit-point" cx="52" cy="338" r="3" />
                <circle className="orbit-point orbit-point--soft" cx="474" cy="216" r="2" />
              </svg>
              <div className="globe-sphere">
                <div className="globe-mount" aria-hidden="true">
                  <Globe />
                </div>
              </div>
              <div className="globe-tags" aria-hidden="true">
                <div className="globe-tag globe-tag--edit">
                  <span className="globe-avatar">
                    <PresenceAvatar />
                  </span>
                  <span>
                    Mara is editing <strong>analysis.ipynb</strong>
                  </span>
                </div>
                <div className="globe-tag globe-tag--presence">
                  <span className="tag-dots">
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <span>
                    <strong>3</strong> teammates online
                  </span>
                </div>
                <div className="globe-tag globe-tag--cursor">
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-up-right" />
                  </svg>
                  <span>
                    Theo's cursor · <strong>row 42</strong>
                  </span>
                </div>
                <div className="globe-tag globe-tag--comment">
                  <svg className="icon icon--xs">
                    <use href="#i-message" />
                  </svg>
                  <span>
                    2 comments on <strong>survey.parquet</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="section section--alt" id="pricing">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Pricing</div>
              <h2 className="section-title">Start free, bring a project</h2>
              <p className="section-desc">
                The full workspace, 5 GB of storage, and 20 agent requests a day. No credit card.
              </p>
            </div>
            <div className="stats-grid">
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
                <p>Formats detected inline</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  <span className="counter" data-target="50">
                    50
                  </span>
                </div>
                <p>Extra requests by referral</p>
              </div>
            </div>
            <div className="plan-cards">
              <PlanCards />
            </div>
            <div className="referral-note">
              <svg className="icon icon--xs">
                <use href="#i-users" />
              </svg>{" "}
              Refer a friend and get <strong>+50 agent requests</strong>, one time, when they create
              an account with your link.{" "}
              <a href="/referral">
                Get your link{" "}
                <svg className="icon icon--xs">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
            </div>
          </div>
        </section>
        <section className="cta-section" id="get-started">
          <div className="container">
            <div className="cta-box">
              <h2>Give your research a place to live</h2>
              <p>
                Start with 5 GB, a lab, local search, and 20 agent requests a day. Bring the project
                and we'll keep it together.
              </p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create a free workspace
                </a>
                <a href="/about#contact" className="btn btn--ghost btn--lg">
                  Talk to us
                </a>
              </div>
            </div>
          </div>
        </section>
        <BackToTop />
      </main>
    </PageTransition>
  )
}
