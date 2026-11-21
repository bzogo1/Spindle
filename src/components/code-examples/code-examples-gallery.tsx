import { CodeBlock } from "@/components/site/code-block"

import { groupExamplesByCategory, type CodeExample } from "./examples"
import { labRunHref } from "./run-in-lab"

export type CodeExamplesGalleryProps = {
  /** Restrict the gallery to a subset of examples (defaults to all). */
  examples?: CodeExample[]
  /** Render only this category when provided. */
  category?: string
}

/**
 * Categorized, syntax-highlighted gallery of API/SDK usage examples.
 *
 * Server component: highlighting happens at build/request time through the
 * shared `CodeBlock`, and the only client JS is each block's copy button.
 */
export async function CodeExamplesGallery({ examples, category }: CodeExamplesGalleryProps = {}) {
  const groups = groupExamplesByCategory(examples).filter(
    (group) => !category || group.category === category,
  )

  return (
    <div className="code-examples-gallery" data-code-examples-gallery>
      {groups.map((group) => (
        <section key={group.category} className="code-examples-group">
          <h3 className="code-examples-group-title">{group.category}</h3>
          <div className="code-examples-list">
            {group.examples.map((example) => (
              <article key={example.id} className="code-example" id={example.id}>
                <header className="code-example-head">
                  <h4 className="code-example-title">{example.title}</h4>
                  {example.description ? (
                    <p className="code-example-desc">{example.description}</p>
                  ) : null}
                </header>
                <CodeBlock code={example.code} language={example.language} title={example.title} />
                <p className="code-example-actions">
                  <a className="btn btn--ghost btn--sm" href={labRunHref(example)}>
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-flask" />
                    </svg>{" "}
                    Run this code in the Lab
                  </a>
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
