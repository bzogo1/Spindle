import "../../styles/pages.css"

import { CodeExamplesGallery } from "@/components/code-examples/code-examples-gallery"
import { TutorialDemo } from "@/components/tutorials/tutorial-demo"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Tutorials & examples — Spindle",
  description:
    "Interactive product tours, a generated API SDK, and copy-paste code examples for the Spindle REST API.",
  path: "/tutorials",
})

export default function TutorialsPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Interactive demos</div>
            <h1 className="page-title">Learn Spindle by doing it.</h1>
            <p className="page-lede">
              Step-through product tours, a typed client generated from the API routes, and
              ready-to-paste snippets for every surface. Nothing here leaves your browser — tour
              progress is stored locally.
            </p>
            <div className="page-actions">
              <a href="#tours" className="btn btn--primary">
                Try the tours
              </a>
              <a href="#examples" className="btn btn--ghost">
                Browse code examples
              </a>
              <a href="/tutorials/videos" className="btn btn--ghost">
                Video guides
              </a>
            </div>
          </div>
        </section>

        <section id="tours" className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Interactive tutorials</div>
              <h2 className="section-title">Guided tours of the workspace.</h2>
              <p className="section-desc">
                The engine spotlights elements by CSS selector, walks forward and back through
                steps, and remembers completion in localStorage. Start a tour, then use Skip or
                Escape to exit early.
              </p>
            </div>
            <TutorialDemo />
          </div>
        </section>

        <section id="examples" className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Code examples</div>
              <h2 className="section-title">Call the API your way.</h2>
              <p className="section-desc">
                Raw HTTP, the generated TypeScript client, or plain fetch — pick the surface that
                fits. The SDK is produced by <code>npx tsx scripts/generate-sdk.ts</code> from the
                route handlers themselves.
              </p>
            </div>
            <CodeExamplesGallery />
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
