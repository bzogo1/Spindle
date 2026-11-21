import "../../styles/search.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Search — Spindle",
  description:
    "Spindle search runs on a SearXNG instance hosted on Spindle servers. Two modes — Academic for papers and citations, Basic for the open web — with results landing next to your project files.",
  path: "/search",
})

const basicEngines = [
  {
    name: "DuckDuckGo",
    desc: "Privacy-focused general web results, images, and news.",
  },
  {
    name: "Mojeek",
    desc: "An independent crawler with its own index — not a Google wrapper.",
  },
  {
    name: "Brave",
    desc: "An independent index with strong news, video, and local coverage.",
  },
]

const academicEngines = [
  {
    name: "BASE",
    desc: "Bielefeld Academic Search Engine — broad coverage of open-access research.",
  },
  {
    name: "arXiv",
    desc: "Preprints across physics, mathematics, computer science, and q-bio.",
  },
  {
    name: "Crossref",
    desc: "DOI metadata and citation links across scholarly publishers.",
  },
  {
    name: "Semantic Scholar",
    desc: "AI-curated papers with citation counts and influential-citation data.",
  },
  {
    name: "OpenAlex",
    desc: "An open catalog of works, authors, venues, and institutions.",
  },
]

export default function SearchPage() {
  return (
    <PageTransition>
      <div className="search-page">
        <main id="top" tabIndex={-1}>
          <section className="section" id="how-it-runs" aria-labelledby="how-title">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">How it runs</div>
                <h1 id="how-title" className="section-title">
                  A SearXNG instance, hosted alongside your workspace.
                </h1>
                <p className="section-desc">
                  Spindle doesn't proxy your queries through a commercial search API tied to your
                  account. Instead, each deployment runs its own SearXNG metasearch engine on
                  Spindle servers. Your query fans out to the engines enabled for the active mode,
                  results are aggregated and deduplicated, and the merged list comes back into the
                  project — ready to cite, annotate, or file.
                </p>
              </div>
              <div className="feature-grid">
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-search" />
                    </svg>
                  </span>
                  <h3>One query, many engines</h3>
                  <p>
                    SearXNG forwards your search to every enabled engine for the mode and merges
                    the responses, so a single search covers the open web or the scholarly
                    literature without you managing a single upstream account.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-server" />
                    </svg>
                  </span>
                  <h3>Hosted on Spindle servers</h3>
                  <p>
                    The instance runs on Spindle infrastructure next to your workspace. There's
                    nothing to install, no API keys to configure, and no third party sitting
                    between your query and the results.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-folder" />
                    </svg>
                  </span>
                  <h3>Results stay in the project</h3>
                  <p>
                    Hits land beside your files, notebooks, and notes. Save a paper to the project
                    tree, cite it in a document, or hand it to the agent — the search context
                    doesn't leave the workspace.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <section className="section section--alt" id="searxng" aria-labelledby="searxng-title">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">The engine</div>
                <h2 id="searxng-title" className="section-title">
                  What is SearXNG?
                </h2>
                <p className="section-desc">
                  SearXNG is a free, open-source metasearch engine. Instead of indexing the web
                  itself, it queries a configurable set of upstream engines — general web indexes,
                  academic databases, package registries, and more — then merges, deduplicates, and
                  ranks the combined results for you.
                </p>
              </div>
              <div className="feature-grid">
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-shield" />
                    </svg>
                  </span>
                  <h3>Privacy by design</h3>
                  <p>
                    SearXNG doesn't track users, build profiles, or serve ads. Queries go to the
                    upstream engines without cookies or identifiers attached, which is why Spindle
                    chose it as the search layer.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-layers" />
                    </svg>
                  </span>
                  <h3>One interface, dozens of engines</h3>
                  <p>
                    A single SearXNG deployment can aggregate results from hundreds of supported
                    engines. Spindle curates two presets — Academic and Basic — so each mode only
                    queries the sources that matter for the job.
                  </p>
                </article>
                <article className="feature-card">
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-code" />
                    </svg>
                  </span>
                  <h3>Open and self-hostable</h3>
                  <p>
                    SearXNG is open source and designed to run on your own infrastructure. Spindle
                    hosts it for you; if you ever want to run your own instance, the same engine
                    and engine set are available.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <section className="section" id="modes" aria-labelledby="modes-title">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Two modes</div>
                <h2 id="modes-title" className="section-title">
                  Pick the depth your question needs.
                </h2>
                <p className="section-desc">
                  The mode switch sits next to the search box. Flip between them without leaving
                  the project — the engines behind each mode are all SearXNG-supported sources.
                </p>
              </div>

              <div className="search-mode">
                <h3 className="search-mode-title">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-globe" />
                  </svg>{" "}
                  Basic mode
                </h3>
                <p className="search-mode-desc">
                  For the wider web — documentation, news, datasets, practical references, and
                  everything in between.
                </p>
                <div className="feature-grid search-engine-grid">
                  {basicEngines.map((engine) => (
                    <article className="feature-card" key={engine.name}>
                      <h4>{engine.name}</h4>
                      <p>{engine.desc}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="search-mode">
                <h3 className="search-mode-title">
                  <svg className="icon icon--sm" aria-hidden="true">
                    <use href="#i-layers" />
                  </svg>{" "}
                  Academic mode
                </h3>
                <p className="search-mode-desc">
                  For papers, preprints, citations, and the scholarly record — the engines
                  researchers actually need.
                </p>
                <div className="feature-grid search-engine-grid">
                  {academicEngines.map((engine) => (
                    <article className="feature-card" key={engine.name}>
                      <h4>{engine.name}</h4>
                      <p>{engine.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="section section--alt" aria-labelledby="search-cta-title">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Get started</div>
                <h2 id="search-cta-title" className="section-title">
                  Search is included in every workspace.
                </h2>
                <p className="section-desc">
                  The free plan includes the full platform — files, the lab, search, automations,
                  and 20 agent requests a day. No card, no trial clock.
                </p>
              </div>
              <div className="search-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Start free{" "}
                  <svg className="icon icon--xs">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <a href="/pricing" className="btn btn--ghost btn--lg">
                  See pricing
                </a>
              </div>
            </div>
          </section>
        </main>
      </div>
    </PageTransition>
  )
}
