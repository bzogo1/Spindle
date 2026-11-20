import "../../styles/pages.css"
import "../../styles/legal.css"
import "../../styles/security.css"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Security and trust centre — Spindle",
  description:
    "How Spindle encrypts your work in transit and at rest, isolates workspaces, handles sessions, backups, and incidents, and which security certifications we do — and do not — hold.",
  path: "/security",
})

const sectionLinks = [
  { id: "architecture", title: "Architecture" },
  { id: "encryption", title: "Encryption" },
  { id: "isolation", title: "Tenant isolation" },
  { id: "authentication", title: "Authentication and sessions" },
  { id: "logging", title: "Logging and monitoring" },
  { id: "backups", title: "Backups and retention" },
  { id: "agent-lab", title: "Agent and lab boundaries" },
  { id: "incident-response", title: "Incident response" },
  { id: "disclosure", title: "Vulnerability disclosure" },
  { id: "compliance", title: "Compliance" },
  { id: "availability", title: "Availability and status" },
  { id: "contact", title: "Contact" },
]

export default function SecurityPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main security-page">
        <section className="page-hero security-hero">
          <div className="container">
            <div className="eyebrow">Security &amp; trust</div>
            <h1 className="page-title">Security we can show you.</h1>
            <p className="page-lede">
              How Spindle protects your research on the way in, at rest, between workspaces, and
              when something goes wrong. This page describes the system we actually run — not a
              certification we hope to hold one day.
            </p>
            <dl className="security-facts">
              <div>
                <dt>Last reviewed</dt>
                <dd>
                  <time dateTime="2026-11-19">19 November 2026</time>
                </dd>
              </div>
              <div>
                <dt>Certifications</dt>
                <dd>None held — see compliance</dd>
              </div>
              <div>
                <dt>Disclosure</dt>
                <dd>
                  <a href="mailto:security@spindle.example">security@spindle.example</a>
                </dd>
              </div>
            </dl>
            <div className="page-actions">
              <a
                href="mailto:security@spindle.example?subject=Security%20report"
                className="btn btn--primary"
              >
                Report a vulnerability
              </a>
              <a href="#architecture" className="btn btn--ghost">
                See the architecture
              </a>
            </div>
          </div>
        </section>

        <section className="section legal-body">
          <div className="legal-layout container">
            <aside className="legal-toc" aria-label="On this page">
              <h2 className="legal-toc-title">On this page</h2>
              <nav aria-label="Security and trust centre sections">
                {sectionLinks.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <article className="legal-content security-content">
              <div className="legal-summary">
                <h2>The short version</h2>
                <ul>
                  <li>
                    Traffic to Spindle is encrypted with TLS before it reaches the application, and
                    the origin is reachable only through an outbound-only Cloudflare Tunnel.
                  </li>
                  <li>
                    Project files live in private Backblaze B2 buckets with server-side encryption
                    at rest. There are no public bucket URLs.
                  </li>
                  <li>
                    Workspace membership and roles are checked on every request, and the agent is
                    confined to the project it was opened in.
                  </li>
                  <li>
                    We hold no SOC 2 or ISO/IEC 27001 certification today, and we display no badges
                    for either.
                  </li>
                  <li>
                    Report a vulnerability to{" "}
                    <a href="mailto:security@spindle.example">security@spindle.example</a>. The same
                    contact is published in{" "}
                    <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
                  </li>
                </ul>
              </div>

              <section id="architecture" className="legal-block">
                <h2>Architecture</h2>
                <p>
                  Every request follows the same path. This is the production topology, not a
                  whiteboard sketch, and it deliberately leaves out internal service names and host
                  addresses.
                </p>
                <figure className="security-architecture">
                  <ol className="security-flow">
                    <li>
                      <span className="security-flow-icon">
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href="#i-globe" />
                        </svg>
                      </span>
                      <span className="security-flow-kicker">01 · Client</span>
                      <strong className="security-flow-name">Browser</strong>
                      <span className="security-flow-control">
                        HTTPS / TLS before any data moves
                      </span>
                    </li>
                    <li>
                      <span className="security-flow-icon">
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href="#i-shield" />
                        </svg>
                      </span>
                      <span className="security-flow-kicker">02 · Edge</span>
                      <strong className="security-flow-name">Cloudflare</strong>
                      <span className="security-flow-control">
                        TLS termination, Turnstile, WAF, DDoS absorption
                      </span>
                    </li>
                    <li>
                      <span className="security-flow-icon">
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href="#i-lock" />
                        </svg>
                      </span>
                      <span className="security-flow-kicker">03 · Private link</span>
                      <strong className="security-flow-name">Cloudflare Tunnel</strong>
                      <span className="security-flow-control">
                        Encrypted, outbound-only; no inbound origin port
                      </span>
                    </li>
                    <li>
                      <span className="security-flow-icon">
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href="#i-cube" />
                        </svg>
                      </span>
                      <span className="security-flow-kicker">04 · Application</span>
                      <strong className="security-flow-name">Spindle core</strong>
                      <span className="security-flow-control">
                        Session and workspace role checked per request
                      </span>
                    </li>
                    <li>
                      <span className="security-flow-icon">
                        <svg className="icon icon--sm" aria-hidden="true">
                          <use href="#i-folder" />
                        </svg>
                      </span>
                      <span className="security-flow-kicker">05 · Storage</span>
                      <strong className="security-flow-name">Backblaze B2</strong>
                      <span className="security-flow-control">
                        Private bucket, server-side encryption, scoped credentials
                      </span>
                    </li>
                  </ol>
                  <figcaption className="security-caption">
                    Production request path for Spindle. The full interactive version, with the
                    privacy rationale for each hop, is on the{" "}
                    <a href="/infrastructure">infrastructure page</a>.
                  </figcaption>
                </figure>
                <ul className="legal-bullets">
                  <li>
                    TLS terminates at Cloudflare&rsquo;s edge, and traffic from the edge to Spindle
                    travels over an encrypted Cloudflare Tunnel.
                  </li>
                  <li>
                    No inbound origin port is exposed to the internet, and the origin IP is not
                    published.
                  </li>
                  <li>
                    Spindle checks the session and the workspace before it reads a project object,
                    so a valid sign-in is not enough on its own.
                  </li>
                  <li>
                    Project objects are reached through the application with scoped credentials, not
                    through a public bucket URL.
                  </li>
                </ul>
              </section>

              <section id="encryption" className="legal-block">
                <h2>Encryption</h2>
                <h3>In transit</h3>
                <ul className="legal-bullets">
                  <li>
                    HTTPS/TLS protects the path between your browser and Spindle. The TLS session is
                    negotiated before any project data moves.
                  </li>
                  <li>
                    Cloudflare terminates TLS at the edge and applies its bot, firewall, and
                    denial-of-service protections before traffic reaches the application.
                  </li>
                  <li>
                    The connection from Cloudflare to Spindle runs through an encrypted,
                    outbound-only Cloudflare Tunnel. There is no open inbound port to our origin.
                  </li>
                </ul>
                <h3>At rest</h3>
                <ul className="legal-bullets">
                  <li>
                    Project objects are stored in private Backblaze B2 buckets with server-side
                    encryption at rest.
                  </li>
                  <li>
                    Buckets are not public. Access is scoped to the service that needs the object,
                    and objects are not addressed by guessable public URLs.
                  </li>
                  <li>
                    Deleting a workspace removes its data from active storage within 7 days of a
                    verified request, and from encrypted backups within 30 days.
                  </li>
                </ul>
              </section>

              <section id="isolation" className="legal-block">
                <h2>Tenant isolation</h2>
                <p>
                  A workspace is the authorization boundary. Everything inside it — files, notes,
                  saved searches, automations, lab runs, and agent runs — is addressed through that
                  workspace and the member&rsquo;s role in it.
                </p>
                <ul className="legal-bullets">
                  <li>
                    Membership and role are checked on the server for every request, not only hidden
                    in the interface.
                  </li>
                  <li>
                    Project objects are kept in private buckets behind scoped credentials. There is
                    no shared public bucket and no public object URL.
                  </li>
                  <li>
                    The agent sees only the project it was invoked in, and cannot reach another
                    workspace or the host filesystem.
                  </li>
                  <li>Production access is limited to the people who need it and is logged.</li>
                  <li>
                    Invites, role changes, and anonymous-mode changes appear in the project&rsquo;s
                    access history.
                  </li>
                </ul>
              </section>

              <section id="authentication" className="legal-block">
                <h2>Authentication and sessions</h2>
                <ul className="legal-bullets">
                  <li>
                    Passwords are stored as one-way hashes. We do not keep the plaintext password.
                  </li>
                  <li>
                    Sessions are carried in the cookies and local-storage keys documented in our{" "}
                    <a href="/cookies">Cookie Policy</a>. Every request proves the session and
                    re-checks the workspace role.
                  </li>
                  <li>
                    Workspaces use four roles — owner, manager, editor, and viewer. Owners control
                    billing and deletion. Changing a role or removing a member is recorded in the
                    access history.
                  </li>
                  <li>
                    SSO, SAML, and SCIM are not available in this build. We do not advertise or
                    imply them on the pricing page.
                  </li>
                </ul>
                <p className="security-note">
                  Session replays captured by Sentry mask all text and media. The search, chat,
                  invite, and sign-in fields are masked or blocked entirely, so a replay is a
                  diagnostic record rather than a recording of your work.
                </p>
              </section>

              <section id="logging" className="legal-block">
                <h2>Logging and monitoring</h2>
                <ul className="legal-bullets">
                  <li>
                    Crashes, error events, performance traces, and masked session replays go to
                    Sentry.
                  </li>
                  <li>
                    Error events and replays are kept for 30 days. Server and security logs are kept
                    for 30 days, then deleted or aggregated.
                  </li>
                  <li>
                    Access changes are visible in the project&rsquo;s access history, including who
                    changed a role and when.
                  </li>
                  <li>
                    Access to production systems is limited to the people who need it and is logged.
                  </li>
                </ul>
                <p>
                  We do not sell diagnostic data, and we do not use it to build advertising
                  profiles. See the <a href="/privacy#what-we-collect">Privacy Policy</a> for the
                  full list of what is collected and why.
                </p>
              </section>

              <section id="backups" className="legal-block">
                <h2>Backups and retention</h2>
                <ul className="legal-bullets">
                  <li>
                    Backblaze B2 stores redundant copies of each project object, so a single disk or
                    host failure does not take your work with it.
                  </li>
                  <li>
                    Account and workspace content is kept for as long as the workspace exists. Lab
                    session state ends when the session stops; files the session wrote stay in the
                    project.
                  </li>
                  <li>
                    Support correspondence is kept for 24 months after the last reply. Error events
                    and server logs follow the 30-day windows above.
                  </li>
                  <li>
                    When a retention period ends, we delete the data or turn it into aggregated
                    statistics that no longer identify you.
                  </li>
                </ul>
                <p>
                  The full schedule is in <a href="/privacy#retention">How long we keep data</a>. We
                  do not publish recovery point or recovery time targets on this page: they are
                  being formalised with the infrastructure owners and will be listed here with a
                  review date once they are signed off.
                </p>
              </section>

              <section id="agent-lab" className="legal-block">
                <h2>Agent and lab boundaries</h2>
                <p>
                  The agent and the lab work inside the project you opened. They are not a shell
                  with your whole workspace attached.
                </p>
                <ul className="legal-bullets">
                  <li>
                    Agent runs are scoped to one project. It sees the project it was invoked in and
                    nothing else in the workspace.
                  </li>
                  <li>
                    File writes stay inside the project. Overwrites, folder-wide moves, and
                    destructive actions pause at approval gates instead of guessing.
                  </li>
                  <li>
                    Every change arrives as a diff you can inspect, approve, or discard. Each run
                    keeps its inputs, file changes, and output, so an earlier version can be
                    restored.
                  </li>
                  <li>
                    A lab session starts from the project&rsquo;s files. Session state is discarded
                    when the session stops, while files the session wrote remain in the project.
                  </li>
                  <li>
                    Escaping a lab container, probing the service without written permission, or
                    uploading malware is prohibited by the{" "}
                    <a href="/acceptable-use">Acceptable Use Policy</a>.
                  </li>
                </ul>
              </section>

              <section id="incident-response" className="legal-block">
                <h2>Incident response</h2>
                <p>
                  Report a suspected incident to{" "}
                  <a href="mailto:security@spindle.example">security@spindle.example</a> and
                  suspected abuse to{" "}
                  <a href="mailto:abuse@spindle.example">abuse@spindle.example</a>, with what you
                  observed, when it happened, and any request or workspace identifier. We contain
                  the issue first, then investigate and keep the affected workspace owners informed.
                </p>
                <ul className="legal-bullets">
                  <li>
                    When we confirm an incident that affects customer data, we contain it, rotate
                    affected credentials, and notify the affected workspace owners.
                  </li>
                  <li>
                    Notification window: as soon as we confirm that an incident affects a
                    customer&rsquo;s data, and no later than the deadline required by applicable
                    law. We do not publish a blanket 24-hour or 72-hour promise, because the legal
                    deadline depends on jurisdiction and the data involved.
                  </li>
                  <li>
                    After affected customers have been told, we publish a short post-incident
                    summary for confirmed incidents that exposed customer data.
                  </li>
                  <li>
                    Suspected abuse, a compromised account, or a lost device is also an incident.
                    Contact us rather than waiting for confirmation.
                  </li>
                </ul>
              </section>

              <section id="disclosure" className="legal-block">
                <h2>Vulnerability disclosure</h2>
                <p>
                  We welcome good-faith security research. Send reports to{" "}
                  <a href="mailto:security@spindle.example">security@spindle.example</a> with a
                  description, reproduction steps, the affected URL, and any proof of concept. If
                  you need to encrypt the report, ask for our key first and do not send the details
                  until you have it.
                </p>
                <p className="security-note">
                  Safe harbour: if you make a good-faith effort to follow this policy — stay within
                  your own accounts, do not access other people&rsquo;s data, do not disrupt the
                  service, and give us a reasonable window to fix the issue before publishing — we
                  will not pursue legal action or report you to law enforcement for your research.
                  If a third party asks us about your research, we will say that you acted under
                  this policy.
                </p>
                <h3>What is in scope</h3>
                <ul className="legal-bullets">
                  <li>
                    Spindle&rsquo;s production application, workspace services, and this website.
                  </li>
                  <li>
                    Authentication, session handling, workspace authorization, and the agent and lab
                    boundaries described on this page.
                  </li>
                </ul>
                <h3>What is out of scope</h3>
                <ul className="legal-bullets">
                  <li>
                    Cloudflare, Backblaze, Resend, Sentry, the LLM provider, and other
                    subprocessors. Report issues in their services to them; we will help route a
                    report if needed.
                  </li>
                  <li>
                    Social engineering, physical access, denial of service, spam, and automated
                    scanning that degrades the service.
                  </li>
                  <li>Accessing, changing, or exfiltrating data that is not yours.</li>
                </ul>
                <p>
                  We aim to acknowledge a report within two business days, tell you whether we can
                  reproduce it, and keep you updated until it is fixed. We will credit you if you
                  want the acknowledgement. We do not run a paid bounty today.
                </p>
                <p>
                  This policy is published at{" "}
                  <a href="/.well-known/security.txt">/.well-known/security.txt</a> with a future
                  expiry date, so automated scanners can find the same contact.
                </p>
              </section>

              <section id="compliance" className="legal-block">
                <h2>Compliance</h2>
                <p>
                  We hold no security certifications today. This table is the complete list: if a
                  framework is not here, we are not certified for it.
                </p>
                <div className="legal-table-wrap">
                  <table className="legal-table" aria-label="Spindle compliance status">
                    <thead>
                      <tr>
                        <th scope="col">Framework</th>
                        <th scope="col">Status</th>
                        <th scope="col">What that means</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>SOC 2 Type II</td>
                        <td>
                          <span className="security-status security-status--none">
                            Not certified
                          </span>
                        </td>
                        <td>
                          No audit report or bridge letter exists. If an audit is completed, its
                          scope and date will be listed here.
                        </td>
                      </tr>
                      <tr>
                        <td>ISO/IEC 27001</td>
                        <td>
                          <span className="security-status security-status--none">
                            Not certified
                          </span>
                        </td>
                        <td>
                          No certificate is held. Nothing on this site should be read as an ISO/IEC
                          27001 claim.
                        </td>
                      </tr>
                      <tr>
                        <td>GDPR</td>
                        <td>
                          <span className="security-status security-status--yes">Applies</span>
                        </td>
                        <td>
                          Personal data is processed under the Privacy Policy and our data
                          processing terms, with Standard Contractual Clauses for transfers outside
                          the EEA or UK.
                        </td>
                      </tr>
                      <tr>
                        <td>PCI DSS</td>
                        <td>
                          <span className="security-status security-status--na">
                            Not applicable
                          </span>
                        </td>
                        <td>
                          This build does not take card payments or store card data, so there is no
                          cardholder environment to certify.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  You will not find SOC 2 or ISO badges on this site, because we do not hold either
                  certification. When that changes, the badge will link to the audit scope and date
                  rather than to a logo alone.
                </p>
              </section>

              <section id="availability" className="legal-block">
                <h2>Availability and status</h2>
                <p>
                  The free plan does not carry an uptime commitment; a dedicated SLA is discussed as
                  part of an Enterprise agreement, as described on the{" "}
                  <a href="/pricing">pricing page</a>.
                </p>
                <p>
                  If an incident affects your workspace, we tell the affected workspace owners
                  directly rather than relying on a status page alone.
                </p>
              </section>

              <section id="contact" className="legal-block">
                <h2>Contact</h2>
                <p>
                  Security questions, vulnerability reports, and incident reports go to the security
                  address. Data requests go to privacy, and signed DPAs go to legal. The processing
                  terms and the current subprocessor list are published in the{" "}
                  <a href="/dpa">Data Processing Addendum</a>.
                </p>
                <ul className="legal-contact">
                  <li>
                    <span>Security and disclosure</span>
                    <a href="mailto:security@spindle.example">security@spindle.example</a>
                  </li>
                  <li>
                    <span>Abuse reports</span>
                    <a href="mailto:abuse@spindle.example?subject=Abuse%20report">
                      abuse@spindle.example
                    </a>
                  </li>
                  <li>
                    <span>Privacy and data requests</span>
                    <a href="mailto:privacy@spindle.example">privacy@spindle.example</a>
                  </li>
                  <li>
                    <span>Legal and DPAs</span>
                    <a href="mailto:legal@spindle.example">legal@spindle.example</a>
                  </li>
                </ul>
                <p>
                  If a claim on this page cannot be traced to shipped code or a written runbook,
                  tell us and we will correct the page. That is the standard this page is held to.
                </p>
              </section>
            </article>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
