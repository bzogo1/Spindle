import { Fragment, type ReactNode } from "react"

import type { LegalDocument, LegalInline, LegalParagraph } from "@/content/legal/types"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
})

function formatDate(isoDate: string) {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

function InlineContent({ content }: { content: LegalParagraph }) {
  const parts: LegalInline[] = Array.isArray(content) ? content : [content]

  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <a key={index} href={part.href}>
            {part.text}
          </a>
        ),
      )}
    </>
  )
}

/**
 * Shared long-form legal layout: one readable prose column, a sticky table of
 * contents on desktop, version and effective date at the top, and a contact
 * block. The privacy policy reuses this component with its own content file.
 */
export function LegalPage({
  content,
  children,
}: {
  content: LegalDocument
  /** Extra blocks rendered inside the article, after the document sections. */
  children?: ReactNode
}) {
  const tocEntries = [
    ...content.sections.map((section) => ({ id: section.id, title: section.title })),
    { id: "previous-versions", title: "Previous versions" },
    { id: "contact", title: "Contact" },
  ]

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero legal-hero">
          <div className="container">
            <div className="eyebrow">{content.eyebrow}</div>
            <h1 className="page-title">{content.title}</h1>
            <p className="page-lede">{content.lede}</p>
            <dl className="legal-meta">
              <div>
                <dt>Version</dt>
                <dd>{content.version}</dd>
              </div>
              <div>
                <dt>Effective date</dt>
                <dd>
                  <time dateTime={content.effectiveDate}>{formatDate(content.effectiveDate)}</time>
                </dd>
              </div>
            </dl>
            {content.downloads && content.downloads.length > 0 && (
              <ul className="legal-downloads">
                {content.downloads.map((download) => (
                  <li key={download.href} className="legal-download">
                    <div className="legal-download-copy">
                      <span className="legal-download-label">{download.label}</span>
                      <p>{download.description}</p>
                      <span className="legal-download-meta">
                        {download.meta} · Version {download.version}, effective{" "}
                        <time dateTime={download.effectiveDate}>
                          {formatDate(download.effectiveDate)}
                        </time>
                      </span>
                    </div>
                    <a className="legal-download-action" href={download.href} download>
                      Download template
                      <svg className="icon icon--xs" aria-hidden="true">
                        <use href="#i-arrow-down" />
                      </svg>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="section legal-body">
          <div className="legal-layout container">
            <aside className="legal-toc" aria-label="On this page">
              <h2 className="legal-toc-title">On this page</h2>
              <nav aria-label={`${content.title} sections`}>
                {tocEntries.map((entry) => (
                  <a key={entry.id} href={`#${entry.id}`}>
                    {entry.title}
                  </a>
                ))}
              </nav>
            </aside>

            <article className="legal-content">
              {content.summary && (
                <div className="legal-summary">
                  <h2>{content.summary.title}</h2>
                  <ul>
                    {content.summary.bullets.map((bullet, index) => (
                      <li key={index}>
                        <InlineContent content={bullet} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {content.sections.map((section) => (
                <section key={section.id} id={section.id} className="legal-block">
                  <h2>{section.title}</h2>
                  {section.paragraphs?.map((paragraph, index) => (
                    <p key={index}>
                      <InlineContent content={paragraph} />
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="legal-bullets">
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>
                          <InlineContent content={bullet} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.subsections?.map((subsection) => (
                    <div key={subsection.title} className="legal-subsection">
                      <h3>{subsection.title}</h3>
                      {subsection.paragraphs.map((paragraph, index) => (
                        <p key={index}>
                          <InlineContent content={paragraph} />
                        </p>
                      ))}
                      {subsection.bullets && (
                        <ul className="legal-bullets">
                          {subsection.bullets.map((bullet, index) => (
                            <li key={index}>
                              <InlineContent content={bullet} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {section.table && (
                    <div className="legal-table-wrap">
                      <table className="legal-table" aria-label={section.table.caption}>
                        <thead>
                          <tr>
                            {section.table.columns.map((column) => (
                              <th key={column} scope="col">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {row.map((cell, cellIndex) => (
                                <td key={cellIndex}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {section.closingParagraphs?.map((paragraph, index) => (
                    <p key={index}>
                      <InlineContent content={paragraph} />
                    </p>
                  ))}
                </section>
              ))}

              {children}

              <section id="previous-versions" className="legal-block">
                <h2>Previous versions</h2>
                <p>
                  <InlineContent content={content.previousVersions.intro} />
                </p>
                <ul className="legal-version-list">
                  {content.previousVersions.entries.map((version) => (
                    <li key={version.version} className="legal-version">
                      <span className="legal-version-name">Version {version.version}</span>
                      <span className="legal-version-date">
                        {formatDate(version.effectiveDate)}
                      </span>
                      {version.note && <span className="legal-version-note">{version.note}</span>}
                      {version.href ? (
                        <a className="legal-version-link" href={version.href}>
                          Read version {version.version}
                        </a>
                      ) : (
                        <span className="legal-version-current">Current</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section id="contact" className="legal-block">
                <h2>Contact</h2>
                <p>{content.contact.intro}</p>
                <ul className="legal-contact">
                  {content.contact.emails.map((email) => (
                    <li key={email.address}>
                      <span>{email.label}</span>
                      <a href={`mailto:${email.address}`}>{email.address}</a>
                    </li>
                  ))}
                </ul>
              </section>
            </article>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
