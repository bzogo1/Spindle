import "../../styles/lab-notebook-preview.css"

import { LabNotebookPreview } from "@/components/lab-notebook-preview/lab-notebook-preview"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Lab notebook preview — Spindle",
  description:
    "A live, in-browser simulation of the Spindle Lab: a Python editor, a Jupyter notebook, an RStudio session, and a secure SSH terminal mounted on the same project.",
  path: "/lab-notebook-preview",
})

const highlights = [
  "Editor · VS Code",
  "Notebook · JupyterLab",
  "Console · RStudio",
  "Shell · SSH over TLS 1.3",
]

export default function LabNotebookPreviewPage() {
  return (
    <PageTransition>
      <div className="lnp-page">
        <main id="top" tabIndex={-1}>
          <section className="lnp-intro container" aria-labelledby="lnp-title">
            <div className="eyebrow">Lab notebook preview</div>
            <h1 id="lnp-title" className="section-title">
              Your lab, open in a browser tab.
            </h1>
            <p className="lnp-intro-lede">
              This is a working simulation of the Spindle Lab. Switch between the editor, the
              notebook, an RStudio session, and a secure shell — all mounted on the same fictional
              project, <code>coastal-resilience</code>. Run files, re-run cells, type R, or drive
              the terminal. Nothing is uploaded and no account is needed.
            </p>
            <div className="lnp-intro-meta">
              <span className="is-live">
                <span className="lnp-status-dot" aria-hidden="true" /> live simulation
              </span>
              {highlights.map((highlight) => (
                <span key={highlight}>{highlight}</span>
              ))}
            </div>
          </section>

          <div className="lnp-stage">
            <LabNotebookPreview />
          </div>

          <div className="lnp-stage-note">
            <span>
              Everything here is simulated in your browser. The project, data, and team are
              fictional; no network requests leave this page.
            </span>
            <span>
              Tip: type <code>help</code> in the SSH tab, or <code>nrow(survey)</code> in the R
              console.
            </span>
          </div>
        </main>
      </div>
    </PageTransition>
  )
}
