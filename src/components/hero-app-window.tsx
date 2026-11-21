"use client"

import { useEffect, useRef, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { HeroStatus, WindowSlugCopy } from "@/components/home-islands"
import { LiveRowCount } from "@/components/site/live-row-count"

/**
 * Hero product mockup. The window-bar toggle previews the app window in
 * either the dark or light palette via local state — independent of the
 * site theme. `data-theme` on `.app-window` re-scopes the theme tokens and
 * the matching rules live at the end of styles.css.
 */
export function HeroAppWindow() {
  const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark")
  const windowRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)

  /* The window body is a heavy static mockup (tree, panels, table). An
     IntersectionObserver with a 200px rootMargin defers mounting it until
     the hero is near the viewport; browsers without IO mount immediately. */
  useEffect(() => {
    const el = windowRef.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: "200px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="app-window" data-theme={previewTheme} ref={windowRef}>
      <div className="window-bar">
        <div className="traffic-lights">
          <span role="img" aria-label="Close window"></span>
          <span role="img" aria-label="Minimize window"></span>
          <span role="img" aria-label="Maximize window"></span>
        </div>
        <div className="window-title">
          <svg className="icon icon--xs">
            <use href="#i-lock" />
          </svg>{" "}
          spindle / coastal-resilience
          <WindowSlugCopy slug="coastal-resilience" />
        </div>
        <button
          type="button"
          className="window-theme-toggle"
          onClick={() => setPreviewTheme((theme) => (theme === "dark" ? "light" : "dark"))}
          aria-pressed={previewTheme === "dark"}
          aria-label={
            previewTheme === "dark"
              ? "Switch window preview to light theme"
              : "Switch window preview to dark theme"
          }
          title={previewTheme === "dark" ? "Light preview" : "Dark preview"}
        >
          {previewTheme === "dark" ? (
            <Sun size={11} aria-hidden="true" />
          ) : (
            <Moon size={11} aria-hidden="true" />
          )}
          <span>{previewTheme === "dark" ? "Dark" : "Light"}</span>
        </button>
      </div>
      <div className="window-body">
        {nearViewport ? (
          <>
        <aside className="win-sidebar">
          <div className="sidebar-label">This project</div>
          <div className="side-project">
            <span className="side-project-mark">CR</span>
            <span>
              <strong>Coastal Resilience</strong>
              <small>Field study · 2026</small>
            </span>
          </div>
          <div className="sidebar-label sidebar-label--spaced">Files</div>
          <div className="file-tree" aria-hidden="true">
            <div className="tree-row">
              <svg className="icon icon--xs">
                <use href="#i-chevron-down" />
              </svg>
              <span className="folder">data</span>
            </div>
            <div className="tree-row tree-row--indent">
              <span className="file-ext file-ext--csv">CSV</span>
              <span>tidal-2026.csv</span>
            </div>
            <div className="tree-row tree-row--indent tree-row--active">
              <span className="file-ext file-ext--parquet">PQ</span>
              <span>survey.parquet</span>
            </div>
            <div className="tree-row">
              <svg className="icon icon--xs">
                <use href="#i-chevron-down" />
              </svg>
              <span className="folder">notebooks</span>
            </div>
            <div className="tree-row tree-row--indent">
              <span className="file-ext file-ext--ipynb">IPY</span>
              <span>analysis.ipynb</span>
            </div>
            <div className="tree-row">
              <svg className="icon icon--xs">
                <use href="#i-chevron-down" />
              </svg>
              <span className="folder">output</span>
            </div>
            <div className="tree-row tree-row--indent">
              <span className="file-ext file-ext--pdf">PDF</span>
              <span>draft.pdf</span>
            </div>
          </div>
          <div className="sidebar-usage">
            <div className="usage-label">
              <span>Storage</span>
              <span>1.8 / 5 GB</span>
            </div>
            {/* Width comes from .usage-track span in styles.css (36% = the
                1.8/5 GB baseline). No inline style attribute: CSP style-src
                nonces/hashes can't cover style attributes, only <style> and
                <script> elements. */}
            <div className="usage-track">
              <span></span>
            </div>
          </div>
        </aside>
        <div className="win-main">
          <div
            className="win-tabs"
            role="tablist"
            aria-label="Workspace views"
            aria-orientation="horizontal"
          >
            <button
              className="win-tab is-active"
              role="tab"
              id="hero-tab-overview"
              aria-selected="true"
              aria-controls="hero-panel-overview"
              tabIndex={0}
              data-hero-tab="overview"
            >
              Overview
            </button>
            <button
              className="win-tab"
              role="tab"
              id="hero-tab-files"
              aria-selected="false"
              aria-controls="hero-panel-files"
              tabIndex={-1}
              data-hero-tab="files"
            >
              Files
            </button>
            <button
              className="win-tab"
              role="tab"
              id="hero-tab-lab"
              aria-selected="false"
              aria-controls="hero-panel-lab"
              tabIndex={-1}
              data-hero-tab="lab"
            >
              Lab
            </button>
            <button
              className="win-tab"
              role="tab"
              id="hero-tab-search"
              aria-selected="false"
              aria-controls="hero-panel-search"
              tabIndex={-1}
              data-hero-tab="search"
            >
              Search
            </button>
          </div>
          <div className="win-content">
            <div
              className="hero-panel is-active"
              id="hero-panel-overview"
              data-hero-panel="overview"
              role="tabpanel"
              aria-labelledby="hero-tab-overview"
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">PROJECT HOME</span>
                  <p className="panel-title">Coastal Resilience</p>
                </div>
                <HeroStatus />
              </div>
              <div className="overview-grid">
                <div className="overview-tile">
                  <span className="tile-label">Files</span>
                  <strong>128</strong>
                  <span className="tile-note">+12 this week</span>
                </div>
                <div className="overview-tile">
                  <span className="tile-label">Lab sessions</span>
                  <strong>04</strong>
                  <span className="tile-note">2 kernels ready</span>
                </div>
                <div className="overview-tile">
                  <span className="tile-label">Automations</span>
                  <strong>03</strong>
                  <span className="tile-note">1 cron job live</span>
                </div>
              </div>
              <div className="activity-card">
                <div className="activity-head">
                  <span>Recent activity</span>
                  <span className="mono">LIVE</span>
                </div>
                <div className="activity-row">
                  <span className="activity-dot activity-dot--lime"></span>
                  <span>
                    <strong>Agent</strong> cleaned 3 columns in tidal-2026.csv
                  </span>
                  <time>2m</time>
                </div>
                <div className="activity-row">
                  <span className="activity-dot activity-dot--teal"></span>
                  <span>
                    <strong>Lab</strong> finished notebook run in 42s
                  </span>
                  <time>18m</time>
                </div>
                <div className="activity-row">
                  <span className="activity-dot activity-dot--amber"></span>
                  <span>
                    <strong>Cron</strong> refreshed tide data at 06:00
                  </span>
                  <time>1h</time>
                </div>
              </div>
            </div>
            <div
              className="hero-panel"
              id="hero-panel-files"
              data-hero-panel="files"
              role="tabpanel"
              aria-labelledby="hero-tab-files"
              hidden
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">FILE MANAGER</span>
                  <p className="panel-title">data / 2026 surveys</p>
                </div>
                <span className="status-pill status-pill--muted">
                  100+ formats detected
                </span>
              </div>
              <div className="mini-filelist">
                <div className="mini-file">
                  <span className="file-ext file-ext--csv">CSV</span>
                  <span className="mini-file-name">tidal-2026.csv</span>
                  <span className="mini-file-meta">2.4 MB · tabular</span>
                </div>
                <div className="mini-file">
                  <span className="file-ext file-ext--parquet">PQ</span>
                  <span className="mini-file-name">survey.parquet</span>
                  <span className="mini-file-meta">86 MB · columnar</span>
                </div>
                <div className="mini-file">
                  <span className="file-ext file-ext--ipynb">IPY</span>
                  <span className="mini-file-name">analysis.ipynb</span>
                  <span className="mini-file-meta">410 KB · notebook</span>
                </div>
                <div className="mini-file">
                  <span className="file-ext file-ext--pdf">PDF</span>
                  <span className="mini-file-name">site-photos.pdf</span>
                  <span className="mini-file-meta">18 MB · document</span>
                </div>
              </div>
              <div className="preview-strip">
                Inline preview — no download, no guessing the format.
              </div>
            </div>
            <div
              className="hero-panel"
              id="hero-panel-lab"
              data-hero-panel="lab"
              role="tabpanel"
              aria-labelledby="hero-tab-lab"
              hidden
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">LAB</span>
                  <p className="panel-title">analysis.ipynb</p>
                </div>
                <div className="panel-head-side">
                  <label className="kernel-picker">
                    <span className="kernel-picker-label">Kernel</span>
                    <select
                      className="kernel-select"
                      data-kernel-select
                      data-kernel-status="heroLabKernelStatus"
                      data-kernel-suffix=" ready"
                      aria-label="Select kernel"
                      defaultValue="Python 3.12"
                    >
                      <option value="Python 3.12">Python 3.12</option>
                      <option value="R 4.4">R 4.4</option>
                      <option value="Julia 1.10">Julia 1.10</option>
                    </select>
                  </label>
                  <span className="status-pill">
                    <i></i> <span id="heroLabKernelStatus">Python 3.12 ready</span>
                  </span>
                </div>
              </div>
              <div className="notebook">
                <div className="notebook-cell">
                  <span className="cell-in">[1]</span>
                  <code>
                    <span className="tok-key">import</span> pandas{" "}
                    <span className="tok-key">as</span> pd
                    <br />
                    df = pd.read_parquet(<span className="tok-str">'survey.parquet'</span>
                    )
                  </code>
                </div>
                <div className="notebook-out">
                  <span className="cell-out">out</span>
                  <LiveRowCount />
                </div>
                <div className="notebook-cell">
                  <span className="cell-in">[2]</span>
                  <code>
                    df.groupby(<span className="tok-str">'site'</span>).mean(numeric_only=
                    <span className="tok-key">True</span>).head()
                  </code>
                </div>
                <div className="notebook-table">
                  <span>site</span>
                  <span>salinity</span>
                  <span>turbidity</span>
                  <span>temp</span>
                </div>
              </div>
            </div>
            <div
              className="hero-panel"
              id="hero-panel-search"
              data-hero-panel="search"
              role="tabpanel"
              aria-labelledby="hero-tab-search"
              hidden
            >
              <div className="panel-head">
                <div>
                  <span className="panel-kicker">SEARCH</span>
                  <p className="panel-title">Find the source, not just a link</p>
                </div>
                <span className="status-pill status-pill--muted">SearXNG · local</span>
              </div>
              <div className="mini-searchbar">
                <svg className="icon icon--sm">
                  <use href="#i-search" />
                </svg>
                <span>salt marsh restoration blue carbon</span>
              </div>
              <div className="mini-results">
                <div className="mini-result">
                  <span className="result-source">BASE</span>
                  <span>
                    <strong>Blue carbon sequestration in restored tidal marshes</strong>
                    <small>Journal of Environmental Management · 2024</small>
                  </span>
                </div>
                <div className="mini-result">
                  <span className="result-source result-source--alt">arXiv</span>
                  <span>
                    <strong>Remote sensing of coastal vegetation recovery</strong>
                    <small>Physics · 2023</small>
                  </span>
                </div>
                <div className="mini-result">
                  <span className="result-source result-source--alt2">OpenAlex</span>
                  <span>
                    <strong>Long-term sediment accretion after rewetting</strong>
                    <small>Open access · 2025</small>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
