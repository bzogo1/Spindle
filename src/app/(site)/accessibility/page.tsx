import "../../styles/pages.css"
import "../../styles/legal.css"
import "../../styles/accessibility.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Accessibility statement — Spindle",
  description:
    "Spindle's accessibility target, what we have tested, the known gaps on this site, how to get the same information another way, and how to report a barrier.",
  path: "/accessibility",
})

const sectionLinks = [
  { id: "commitment", title: "Our commitment" },
  { id: "conformance", title: "Conformance status" },
  { id: "testing", title: "How we tested" },
  { id: "known-limitations", title: "Known limitations" },
  { id: "alternatives", title: "Alternative formats" },
  { id: "feedback", title: "Report a barrier" },
  { id: "maintenance", title: "Review and maintenance" },
]

const conformanceRows = [
  {
    area: "Site shell and navigation",
    status: "partial",
    statusLabel: "Partial",
    note: "Landmarks, a single h1 per page, a skip link to the main content, visible focus, and an accessible mobile toggle. Mobile menu focus is not moved or restored.",
  },
  {
    area: "Marketing and legal pages",
    status: "partial",
    statusLabel: "Partial",
    note: "Server-rendered text, labelled controls, alt text on images, and reduced-motion handling. Not yet checked with a screen reader.",
  },
  {
    area: "Documentation",
    status: "partial",
    statusLabel: "Partial",
    note: "Content is plain HTML with a keyboard-operable search and table of contents. Not yet checked with a screen reader.",
  },
  {
    area: "Animated previews",
    status: "open",
    statusLabel: "Known gaps",
    note: "Canvas and WebGL demos are decorative, stop under prefers-reduced-motion, and are described in adjacent text. The globes only rotate with a pointer.",
  },
  {
    area: "Changelog",
    status: "partial",
    statusLabel: "Partial",
    note: "Text releases and alt text on screenshots. The one release video has no captions or transcript.",
  },
  {
    area: "Independent audit",
    status: "open",
    statusLabel: "Not completed",
    note: "No third-party accessibility audit has been commissioned, so this statement makes no full-conformance claim.",
  },
]

function statusClass(status: string) {
  if (status === "pass") return "a11y-status a11y-status--yes"
  if (status === "open") return "a11y-status a11y-status--open"
  return "a11y-status a11y-status--partial"
}

export default function AccessibilityPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main accessibility-page">
        <section className="page-hero a11y-hero">
          <div className="container">
            <div className="eyebrow">Accessibility</div>
            <h1 className="page-title">Accessibility statement.</h1>
            <p className="page-lede">
              This statement covers where this site stands against WCAG 2.2 Level AA, what we have
              actually tested, and the gaps we already know about. It describes the site as it is
              today — not the state we are working toward.
            </p>
            <dl className="a11y-facts">
              <div>
                <dt>Conformance target</dt>
                <dd>WCAG 2.2 Level AA</dd>
              </div>
              <div>
                <dt>Current status</dt>
                <dd>Partial — not independently audited</dd>
              </div>
              <div>
                <dt>Effective date</dt>
                <dd>
                  <time dateTime="2026-11-19">19 November 2026</time>
                </dd>
              </div>
              <div>
                <dt>Last reviewed</dt>
                <dd>
                  <time dateTime="2026-11-19">19 November 2026</time>
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>Design and frontend</dd>
              </div>
              <div>
                <dt>Report a barrier</dt>
                <dd>
                  <a href="mailto:accessibility@spindle.example">accessibility@spindle.example</a>
                </dd>
              </div>
            </dl>
            <div className="page-actions">
              <a
                href="mailto:accessibility@spindle.example?subject=Accessibility%20barrier"
                className="btn btn--primary"
              >
                Report a barrier
              </a>
              <a href="#known-limitations" className="btn btn--ghost">
                Read the known gaps
              </a>
            </div>
          </div>
        </section>

        <section className="section legal-body">
          <div className="legal-layout container">
            <aside className="legal-toc" aria-label="On this page">
              <h2 className="legal-toc-title">On this page</h2>
              <nav aria-label="Accessibility statement sections">
                {sectionLinks.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <article className="legal-content a11y-content">
              <div className="legal-summary">
                <h2>The short version</h2>
                <ul>
                  <li>
                    We aim for WCAG 2.2 Level AA. We do not claim full conformance, and no
                    independent accessibility audit has been completed.
                  </li>
                  <li>
                    Pages are server-rendered HTML with one h1 each, landmark regions, labelled
                    controls, visible focus, alt text, and reduced-motion handling.
                  </li>
                  <li>
                    The animated canvas previews are decorative: they carry no information you
                    cannot get from the text around them, and they stop when you ask for reduced
                    motion.
                  </li>
                  <li>
                    No screen-reader testing (VoiceOver, NVDA, JAWS) has been recorded yet. That is
                    the largest open gap in this statement.
                  </li>
                  <li>
                    Report a barrier to{" "}
                    <a href="mailto:accessibility@spindle.example">accessibility@spindle.example</a>
                    . We reply within three business days and give blocking issues a fix or a
                    workaround within ten business days.
                  </li>
                </ul>
              </div>

              <section id="commitment" className="legal-block">
                <h2>Our commitment</h2>
                <p>
                  Spindle is a research tool, and research is not a visual-only activity. The site
                  is built to be operated with a keyboard and read by assistive technology, and we
                  treat a barrier as a defect rather than a feature request.
                </p>
                <ul className="legal-bullets">
                  <li>
                    We design and build against WCAG 2.2 Level AA. This statement is measured
                    against that target, not against a lower internal bar.
                  </li>
                  <li>
                    Accessibility is part of the frontend review for a new page or flow, not a
                    separate pass before launch.
                  </li>
                  <li>
                    We publish the gaps we know about on this page. A known gap with a workaround is
                    more useful to you than a claim of full conformance.
                  </li>
                  <li>
                    Where the site falls short, we will tell you what we are doing about it and when
                    we expect to have it fixed.
                  </li>
                </ul>
              </section>

              <section id="conformance" className="legal-block">
                <h2>Conformance status</h2>
                <p>
                  The site is <strong>partially conformant</strong> with WCAG 2.2 Level AA: some
                  parts of the content fully meet the target, and the areas below do not yet meet
                  it. Partial conformance describes the whole site, not a partial effort — the gaps
                  are listed honestly and tracked.
                </p>
                <div className="legal-table-wrap">
                  <table className="legal-table" aria-label="Accessibility conformance by area">
                    <thead>
                      <tr>
                        <th scope="col">Area</th>
                        <th scope="col">Status</th>
                        <th scope="col">What that means</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conformanceRows.map((row) => (
                        <tr key={row.area}>
                          <td>{row.area}</td>
                          <td>
                            <span className={statusClass(row.status)}>{row.statusLabel}</span>
                          </td>
                          <td>{row.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  We do not hold an accessibility certification, and we do not display an
                  accessibility badge. When an audit is completed, its scope, date, and the assessor
                  will be listed here.
                </p>
              </section>

              <section id="testing" className="legal-block">
                <h2>How we tested</h2>
                <p>
                  This section states exactly what has been checked, because a statement is only
                  useful if you can tell how it was produced. The last review was on{" "}
                  <time dateTime="2026-11-19">19 November 2026</time>.
                </p>
                <h3>Checked</h3>
                <ul className="legal-bullets">
                  <li>
                    Source review of every route for landmarks, heading order, one h1 per page, form
                    labels, link text, and alt text on images.
                  </li>
                  <li>
                    Focus styles: every interactive element shows a visible 2 px focus outline
                    rather than relying on the browser default alone.
                  </li>
                  <li>
                    Reduced motion: the stylesheet collapses transitions and animations, and the
                    animation scripts check <code>prefers-reduced-motion</code> before starting
                    continuous loops.
                  </li>
                  <li>
                    The mobile menu toggle exposes <code>aria-expanded</code>,{" "}
                    <code>aria-controls</code>, and an updated label, and closes on Escape and on a
                    click outside the panel.
                  </li>
                  <li>
                    The dialogs, dropdowns, tabs, accordions, and tooltips are built on Radix
                    primitives, which provide focus handling and ARIA wiring for those patterns.
                  </li>
                </ul>
                <h3>Assistive technology and browsers tested</h3>
                <div className="legal-table-wrap">
                  <table
                    className="legal-table"
                    aria-label="Assistive technology and browser coverage"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Combination</th>
                        <th scope="col">Status</th>
                        <th scope="col">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Chromium on Linux</td>
                        <td>
                          <span className="a11y-status a11y-status--yes">Checked</span>
                        </td>
                        <td>
                          Layout and keyboard checks during development at 320 px, 768 px, and 1280
                          px widths, with no assistive technology attached.
                        </td>
                      </tr>
                      <tr>
                        <td>Firefox and Safari</td>
                        <td>
                          <span className="a11y-status a11y-status--open">Not yet checked</span>
                        </td>
                        <td>
                          Expected to behave the same, but this is not verified for this statement.
                        </td>
                      </tr>
                      <tr>
                        <td>VoiceOver, NVDA, JAWS</td>
                        <td>
                          <span className="a11y-status a11y-status--open">Not yet checked</span>
                        </td>
                        <td>
                          No screen-reader pass has been recorded. This is the next item on the
                          audit plan.
                        </td>
                      </tr>
                      <tr>
                        <td>Automated axe checks</td>
                        <td>
                          <span className="a11y-status a11y-status--open">Not yet automated</span>
                        </td>
                        <td>
                          Axe is not yet part of the browser test suite, so a regression can ship
                          without failing CI.
                        </td>
                      </tr>
                      <tr>
                        <td>Independent audit</td>
                        <td>
                          <span className="a11y-status a11y-status--open">Not completed</span>
                        </td>
                        <td>
                          No third-party audit has been run. Nothing on this site should be read as
                          third-party verified.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section id="known-limitations" className="legal-block">
                <h2>Known limitations</h2>
                <p>
                  These are the gaps we can name today. Each one has a workaround, and each one is
                  on the accessibility worklist.
                </p>

                <div className="legal-subsection">
                  <h3>Animated and canvas previews</h3>
                  <ul className="legal-bullets">
                    <li>
                      The dither fields, collaboration globes, infrastructure trace, and lab demos
                      draw into a <code>canvas</code>. Canvas content has no text alternative of its
                      own.
                    </li>
                    <li>
                      The previews are illustrative: the same claim is written in the heading and
                      body copy next to them, and no workflow depends on reading the animation.
                    </li>
                    <li>
                      Under <code>prefers-reduced-motion: reduce</code> the continuous loops stop
                      and the page keeps all of its content, but a static frame is still not a text
                      alternative.
                    </li>
                  </ul>
                </div>

                <div className="legal-subsection">
                  <h3>Globe rotation</h3>
                  <ul className="legal-bullets">
                    <li>
                      The collaboration globes rotate by dragging with a pointer. There is no
                      keyboard control for rotation.
                    </li>
                    <li>
                      The presence and cursor labels shown beside the globe are repeated in the
                      surrounding text, so nothing is available only through the rotation.
                    </li>
                  </ul>
                </div>

                <div className="legal-subsection">
                  <h3>Site shell and mobile navigation</h3>
                  <ul className="legal-bullets">
                    <li>
                      Every layout opens with a skip-to-content link as the first focusable element,
                      so keyboard users can jump past the header and its menus straight to the main
                      content.
                    </li>
                    <li>
                      The mobile menu closes on Escape, an outside click, or a link, and keeps{" "}
                      <code>aria-expanded</code> accurate — but focus is not moved into the panel
                      when it opens, and it is not returned to the toggle when the panel closes.
                    </li>
                    <li>
                      The desktop navigation is a Radix menu. Opening a group with a pointer and
                      then switching to the keyboard is supported, but it has not been verified with
                      a screen reader.
                    </li>
                  </ul>
                </div>

                <div className="legal-subsection">
                  <h3>Changelog media</h3>
                  <ul className="legal-bullets">
                    <li>
                      The release video in the changelog has no captions and no text transcript. The
                      release body describes the change in writing.
                    </li>
                  </ul>
                </div>

                <div className="legal-subsection">
                  <h3>Verification gaps</h3>
                  <ul className="legal-bullets">
                    <li>
                      No screen-reader testing has been recorded, so this statement cannot comment
                      on announcement order, verbosity, or virtual-cursor behaviour.
                    </li>
                    <li>
                      No automated accessibility tests run in CI yet, so the list above is
                      maintained by review rather than enforced by a failing build.
                    </li>
                  </ul>
                </div>
              </section>

              <section id="alternatives" className="legal-block">
                <h2>Alternative formats and ways to get the same information</h2>
                <p>
                  If a visual or animated part of the site is the only way you can reach something
                  you need, you do not have to work around it. Ask us and we will provide the
                  content another way.
                </p>
                <ul className="legal-bullets">
                  <li>
                    Written descriptions of product previews, screenshots, and demos on request.
                  </li>
                  <li>
                    Any page in plain text, large print, or a screen-reader-friendly document within
                    five business days.
                  </li>
                  <li>
                    Product documentation is already available as HTML text at{" "}
                    <a href="/docs">spindle.app/docs</a>, and the pricing, security, and legal pages
                    are readable without JavaScript.
                  </li>
                  <li>
                    A walkthrough of a flow by email or a call if the interface is blocking you from
                    evaluating Spindle.
                  </li>
                </ul>
              </section>

              <section id="feedback" className="legal-block">
                <h2>Report a barrier</h2>
                <p>
                  Email{" "}
                  <a href="mailto:accessibility@spindle.example">accessibility@spindle.example</a>{" "}
                  with the page, what you were trying to do, what happened instead, and the browser
                  or assistive technology you use. A screenshot or recording helps, but do not send
                  anything you would not want stored in our support inbox.
                </p>
                <ul className="legal-bullets">
                  <li>
                    <strong>Reply:</strong> within three business days, from a person, with either a
                    fix timeline or a workaround you can use now.
                  </li>
                  <li>
                    <strong>Remediation:</strong> a barrier that stops you completing a task is
                    treated as a bug. We aim to fix it or ship a workaround within ten business
                    days; if that is not possible, we tell you the date we are working toward.
                  </li>
                  <li>
                    <strong>No account needed:</strong> you can report a barrier without signing in
                    or identifying yourself.
                  </li>
                  <li>
                    <strong>Escalation:</strong> if a reply does not resolve the issue, say so in
                    the same thread and it is raised to the maintainer who owns this statement.
                  </li>
                </ul>
                <p className="a11y-note">
                  The address is monitored by the design and frontend team, not a shared support
                  queue, so a report does not get lost between teams.
                </p>
              </section>

              <section id="maintenance" className="legal-block">
                <h2>Review and maintenance</h2>
                <ul className="legal-bullets">
                  <li>
                    <strong>Owner:</strong> design and frontend. The owner is responsible for
                    keeping this page accurate.
                  </li>
                  <li>
                    <strong>Cadence:</strong> reviewed at least once a quarter, and after any
                    accessibility audit or a change to a major flow such as sign-in, navigation, or
                    the documentation search.
                  </li>
                  <li>
                    <strong>Updates:</strong> when a review changes what this statement says, the
                    effective date and the &ldquo;last reviewed&rdquo; date change with it. Fixes
                    that remove a limitation are reflected here rather than only in a changelog.
                  </li>
                  <li>
                    <strong>Open work:</strong> mobile menu focus handling, the screen-reader pass,
                    axe checks in CI, and the changelog captions are the next items on the worklist.
                  </li>
                </ul>
                <p>
                  If a claim on this page cannot be traced to the shipped site or a recorded review,
                  tell us and we will correct the page. That is the standard this statement is held
                  to.
                </p>
              </section>
            </article>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
