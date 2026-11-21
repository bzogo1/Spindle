import "../../styles/files.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Files — Spindle",
  description:
    "Spindle Files is the file manager at the center of every project — drag-and-drop uploads, a real folder tree, 100+ detected formats, inline previews, share links, and 5 GB free.",
  path: "/files",
})

const capabilities = [
  {
    icon: "i-upload",
    title: "Upload anything",
    body: "Drag files onto the tree or queue a multi-file upload and watch each one land. Folders, renames, and moves are all first-class — nothing gets flattened into a pile of downloads.",
    meta: "DRAG · DROP · QUEUE",
  },
  {
    icon: "i-eye",
    title: "Preview 100+ formats",
    body: "Images, PDFs, video, audio, markdown, tables, and code open in a side drawer without leaving the file list. Copy contents or download straight from the preview.",
    meta: "DRAWER · COPY · DOWNLOAD",
  },
  {
    icon: "i-folder",
    title: "Organize properly",
    body: "A real folder tree with breadcrumbs, list and grid views, sorting by name, type, owner, date, or size, and multi-select moves. Rename an export and every reference stays intact.",
    meta: "TREE · GRID · SORT",
  },
  {
    icon: "i-users",
    title: "Share a file or folder",
    body: "Generate a link, pick workspace members, and choose view or edit access per person. Revoke any grant without touching the rest of the project.",
    meta: "VIEW · EDIT · REVOKE",
  },
  {
    icon: "i-search",
    title: "Find it fast",
    body: "Filter the current folder as you type, or search across the whole project. The file you need is one keystroke away, not three folders deep.",
    meta: "FILTER · PROJECT SEARCH",
  },
  {
    icon: "i-git",
    title: "See what changed",
    body: "When the project is under version control, git status badges appear right on the files and folders — modified, added, untracked, conflicted.",
    meta: "M · A · ?? · !",
  },
]

const formatGroups = [
  {
    title: "Tabular data",
    formats: "CSV · TSV · Parquet · XLSX · JSON",
    body: "Spreadsheets and datasets are detected by type and rendered as readable tables — no export-to-PDF round trip to check a column.",
  },
  {
    title: "Documents & papers",
    formats: "PDF · Markdown · TXT · LaTeX-adjacent notes",
    body: "Papers and write-ups preview inline, so a citation or a methods section is one click from the dataset it describes.",
  },
  {
    title: "Images & media",
    formats: "PNG · JPG · TIFF · GeoTIFF · MP4 · MP3 · WAV",
    body: "Field photos, rasters, and recordings render in place — including the geospatial formats research projects accumulate.",
  },
  {
    title: "Code & notebooks",
    formats: "IPYNB · PY · R · SQL · SH",
    body: "Notebooks and scripts get syntax-aware previews. Open one in the Lab when reading isn't enough — the file stays put.",
  },
]

const integrations = [
  {
    icon: "i-flask",
    title: "The Lab reads the same tree",
    body: "RStudio, JupyterLab, VS Code, and the terminal mount the project files directly. Save in the lab, see it in Files — instantly.",
    href: "/lab",
    cta: "Explore the lab",
  },
  {
    icon: "i-sparkle",
    title: "The agent edits in place",
    body: "Hand the agent a reorganization or a cleanup task. It moves files, renames exports, and repairs references — as reviewable diffs.",
    href: "/agent",
    cta: "Meet the agent",
  },
  {
    icon: "i-bolt",
    title: "Automations watch the folders",
    body: "Cron jobs and plain-language workflows read and write project files on a schedule. New exports land where the pipeline expects them.",
    href: "/automations",
    cta: "See automations",
  },
]

export default function FilesPage() {
  return (
    <PageTransition>
      <div className="files-page">
        <main id="top" tabIndex={-1}>
          <section className="files-hero" aria-labelledby="files-hero-title">
            <div className="files-hero-grid-bg" aria-hidden="true"></div>
            <div className="files-hero-inner container">
              <div className="files-hero-copy" data-reveal>
                <div className="files-kicker">
                  <i aria-hidden="true"></i> FILES · 5 GB FREE
                </div>
                <h1 id="files-hero-title">
                  Every file,
                  <br />
                  <span>where the work happens.</span>
                </h1>
                <p className="files-subtitle">
                  Upload, organize, and preview your project files without leaving Spindle. A real
                  folder tree, 100+ detected formats, inline previews, and share links — the same
                  tree the Lab and the agent work in.
                </p>
                <div className="files-hero-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Start free with 5 GB{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="#capabilities" className="btn btn--ghost btn--lg">
                    See what it does
                  </a>
                </div>
                <div className="files-hero-foot">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    100+ formats detected
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Drag-and-drop upload
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Share links with view/edit access
                  </span>
                </div>
              </div>
              <div className="files-hero-visual" data-reveal data-reveal-delay="100">
                <div className="visual-halo" aria-hidden="true"></div>
                <div className="product-window files-window">
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
                      coastal-resilience / files
                    </span>
                    <span className="window-bar-status">
                      <i></i> 1.8 / 5 GB
                    </span>
                  </div>
                  <div className="files-window-body">
                    <div className="fm-columns" aria-hidden="true">
                      <span>Name</span>
                      <span>Detected as</span>
                      <span>Modified</span>
                      <span>Size</span>
                    </div>
                    <div className="fm-list files-window-list">
                      <div className="fm-row is-selected">
                        <span className="fm-name">
                          <span className="file-ext file-ext--csv">CSV</span> tidal-2026.csv
                        </span>
                        <span className="fm-type">Comma-separated values</span>
                        <span className="fm-date">2 min ago</span>
                        <span className="fm-size">2.4 MB</span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--parquet">PQ</span> survey.parquet
                        </span>
                        <span className="fm-type">Apache Parquet</span>
                        <span className="fm-date">Yesterday</span>
                        <span className="fm-size">86 MB</span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--ipynb">IPY</span> analysis.ipynb
                        </span>
                        <span className="fm-type">Jupyter Notebook</span>
                        <span className="fm-date">4 hours ago</span>
                        <span className="fm-size">410 KB</span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--pdf">PDF</span> site-photos.pdf
                        </span>
                        <span className="fm-type">Portable Document</span>
                        <span className="fm-date">Mar 12</span>
                        <span className="fm-size">18 MB</span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--tif">TIF</span> marsh-core.tif
                        </span>
                        <span className="fm-type">GeoTIFF image</span>
                        <span className="fm-date">Mar 09</span>
                        <span className="fm-size">34 MB</span>
                      </div>
                    </div>
                  </div>
                  <div className="files-window-foot">
                    <span className="mono">128 ITEMS · 4 FOLDERS</span>
                    <span>
                      <i className="files-dot files-dot--modified"></i> modified
                      <i className="files-dot files-dot--added"></i> added
                      <i className="files-dot files-dot--untracked"></i> untracked
                    </span>
                  </div>
                </div>
                <div className="floating-note files-float" aria-hidden="true">
                  <span className="note-icon">
                    <svg className="icon icon--xs">
                      <use href="#i-eye" />
                    </svg>
                  </span>
                  <span>
                    <strong>tidal-2026.csv</strong>
                    <small>Previewing inline · CSV · tabular</small>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="capabilities">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">What it does</div>
                <h2 className="section-title">A file manager that treats research files as first-class.</h2>
                <p className="section-desc">
                  Not a sync folder with a web UI bolted on — a file manager designed around how
                  projects actually accumulate data, notebooks, papers, and exports.
                </p>
              </div>
              <div className="feature-grid files-cap-grid">
                {capabilities.map((cap, i) => (
                  <article
                    className="feature-card"
                    key={cap.title}
                    data-reveal
                    data-reveal-delay={i * 60}
                  >
                    <span className="card-icon">
                      <svg className="icon" aria-hidden="true">
                        <use href={`#${cap.icon}`} />
                      </svg>
                    </span>
                    <h3>{cap.title}</h3>
                    <p>{cap.body}</p>
                    <span className="files-card-meta">{cap.meta}</span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="section section--alt" id="preview">
            <div className="container">
              <div className="files-split">
                <div className="files-split-copy" data-reveal>
                  <div className="eyebrow">Preview in place</div>
                  <h2 className="section-title">Check a file without opening a tab.</h2>
                  <p className="section-desc">
                    Click any file and a preview drawer slides in beside the list. Images render,
                    PDFs page through, tables show their columns, markdown reads like a document,
                    and code gets highlighted. When you need the raw bytes, copy or download is one
                    click away.
                  </p>
                  <ul className="feature-list">
                    <li>
                      <span className="feature-check">
                        <svg className="icon icon--xs">
                          <use href="#i-check" />
                        </svg>
                      </span>
                      <span>
                        <strong>Deep-linkable previews</strong>
                        <small>
                          Every preview has a URL — refresh it, share it, or come back to it later.
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
                        <strong>Copy contents directly</strong>
                        <small>
                          Pull text or data out of the preview without downloading the file first.
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
                        <strong>Type detection you can see</strong>
                        <small>
                          Every row shows what Spindle detected — CSV, Parquet, GeoTIFF, notebook —
                          so nothing is a mystery extension.
                        </small>
                      </span>
                    </li>
                  </ul>
                  <a href="#formats" className="text-link">
                    See the formats it recognizes{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                </div>
                <div className="product-window files-preview-window" data-reveal data-reveal-delay="100">
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
                    <span className="window-bar-status">
                      <i></i> Preview open
                    </span>
                  </div>
                  <div className="files-preview-body">
                    <div className="files-preview-list" aria-hidden="true">
                      <div className="fm-row is-selected">
                        <span className="fm-name">
                          <span className="file-ext file-ext--csv">CSV</span> tidal-2026.csv
                        </span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--parquet">PQ</span> survey.parquet
                        </span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--ipynb">IPY</span> analysis.ipynb
                        </span>
                      </div>
                      <div className="fm-row">
                        <span className="fm-name">
                          <span className="file-ext file-ext--pdf">PDF</span> site-photos.pdf
                        </span>
                      </div>
                    </div>
                    <div className="files-preview-drawer" aria-hidden="true">
                      <div className="files-preview-head">
                        <span>
                          <svg className="icon icon--xs">
                            <use href="#i-eye" />
                          </svg>{" "}
                          Preview
                        </span>
                        <span className="files-preview-format">CSV · tabular</span>
                      </div>
                      <div className="files-preview-name">tidal-2026.csv</div>
                      <div className="files-preview-table">
                        <span>site_id</span>
                        <span>salinity</span>
                        <span>turbidity</span>
                        <span>date</span>
                        <span>A-01</span>
                        <span>28.4</span>
                        <span>3.1</span>
                        <span>06/02</span>
                        <span>A-02</span>
                        <span>31.0</span>
                        <span>2.8</span>
                        <span>06/03</span>
                        <span>A-03</span>
                        <span>29.7</span>
                        <span>3.4</span>
                        <span>06/04</span>
                      </div>
                      <div className="files-preview-actions">
                        <span>
                          <svg className="icon icon--xs">
                            <use href="#i-copy" />
                          </svg>{" "}
                          Copy
                        </span>
                        <span>
                          <svg className="icon icon--xs">
                            <use href="#i-arrow-down" />
                          </svg>{" "}
                          Download
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="section" id="formats">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">Formats</div>
                <h2 className="section-title">If it lands in your project, you can probably open it.</h2>
                <p className="section-desc">
                  Spindle detects the type of every file on upload — over 100 formats get a proper
                  label, and the ones you reach for daily get a rich inline preview.
                </p>
              </div>
              <div className="feature-grid files-format-grid">
                {formatGroups.map((group, i) => (
                  <article
                    className="feature-card"
                    key={group.title}
                    data-reveal
                    data-reveal-delay={i * 60}
                  >
                    <h3>{group.title}</h3>
                    <p>{group.body}</p>
                    <span className="files-format-list">{group.formats}</span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="section section--alt" id="together">
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">One tree, everywhere</div>
                <h2 className="section-title">The files are the shared ground.</h2>
                <p className="section-desc">
                  Everything else in Spindle reads and writes the same project tree — which is why
                  organizing once pays off everywhere.
                </p>
              </div>
              <div className="feature-grid files-integrations-grid">
                {integrations.map((item, i) => (
                  <article
                    className="feature-card files-integration"
                    key={item.title}
                    data-reveal
                    data-reveal-delay={i * 60}
                  >
                    <span className="card-icon">
                      <svg className="icon" aria-hidden="true">
                        <use href={`#${item.icon}`} />
                      </svg>
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <a href={item.href} className="text-link">
                      {item.cta}{" "}
                      <svg className="icon icon--xs">
                        <use href="#i-arrow-up-right" />
                      </svg>
                    </a>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="cta-section" id="get-started">
            <div className="container">
              <div className="cta-box files-cta">
                <div className="cta-orbit" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="eyebrow">READY WHEN YOU ARE</div>
                <h2>5 GB is free. Your files shouldn&apos;t wait.</h2>
                <p>
                  Every workspace starts with the full file manager — uploads, previews, sharing,
                  and search — alongside the Lab, the agent, and 20 agent requests a day.
                </p>
                <div className="cta-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Create free workspace{" "}
                    <svg className="icon icon--sm">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="/pricing" className="btn btn--ghost btn--lg">
                    See the pricing
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </PageTransition>
  )
}
