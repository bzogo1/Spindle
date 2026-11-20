import type { CSSProperties } from "react"
import "../../styles/infrastructure.css"
import { PageInteractions } from "@/components/site/page-interactions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Infrastructure — Spindle",
  description:
    "Spindle never sells or tampers with your research data. See how HTTPS/TLS, Cloudflare Turnstile and Tunnels, and private Backblaze B2 storage keep every project secure.",
  path: "/infrastructure",
})

export default function InfrastructurePage() {
  return (
    <PageTransition>
      <div className="infra-page">
        <main id="top" tabIndex={-1} className="page-main">
          <section className="infra-hero" aria-labelledby="infra-hero-title">
            <div className="infra-hero-wash" aria-hidden="true"></div>
            <div className="infra-hero-grid-lines" aria-hidden="true"></div>
            <div className="infra-hero-layout container">
              <div className="infra-hero-copy" data-reveal>
                <div className="infra-kicker">
                  <span className="infra-kicker-dot"></span> INFRASTRUCTURE <span>/</span> PRIVACY
                  FIRST
                </div>
                <h1 id="infra-hero-title">
                  Your data is
                  <br />
                  <span className="infra-gradient-text">not a product.</span>
                </h1>
                <p className="infra-lede">
                  Your files, projects, notes, and searches belong to you. We never sell them, never
                  turn them into advertising profiles, and never quietly alter your work. They stay
                  private, intact, and secure — from sign-in to export.
                </p>
                <div className="infra-hero-actions">
                  <a href="#topology" className="btn btn--primary btn--lg">
                    See the secure path{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="#storage" className="btn btn--ghost btn--lg">
                    How files are stored{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>
                  </a>
                </div>
                <div className="infra-hero-meta">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    No data sales
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    No ad profiling
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    No silent edits
                  </span>
                </div>
              </div>
              <div
                className="infra-seal-stage"
                data-reveal
                data-reveal-delay="100"
                aria-hidden="true"
              >
                <div className="infra-seal-ring infra-seal-ring--outer"></div>
                <div className="infra-seal-ring infra-seal-ring--inner"></div>
                <div className="infra-seal-ticks"></div>
                <div className="infra-seal-core">
                  <svg className="icon">
                    <use href="#i-shield" />
                  </svg>
                  <small>PRIVATE</small>
                  <strong>BY DEFAULT</strong>
                  <span className="infra-seal-core-line"></span>
                </div>
                <span className="infra-seal-satellite infra-seal-satellite--a">NO BROKERS</span>
                <span className="infra-seal-satellite infra-seal-satellite--b">ENCRYPTED</span>
                <span className="infra-seal-satellite infra-seal-satellite--c">YOURS ONLY</span>
              </div>
            </div>
            <div className="container">
              <div className="infra-trust-strip" data-reveal>
                <div>
                  <span className="mono">01</span>
                  <strong>Not for sale</strong>
                  <small>Your research is never inventory.</small>
                </div>
                <div>
                  <span className="mono">02</span>
                  <strong>Not altered</strong>
                  <small>Every change is yours and traceable.</small>
                </div>
                <div>
                  <span className="mono">03</span>
                  <strong>Not public</strong>
                  <small>Only you and your invites get in.</small>
                </div>
              </div>
            </div>
          </section>
          <section
            className="section infra-map-section"
            id="topology"
            aria-labelledby="topology-title"
          >
            <div className="container">
              <div className="section-head infra-section-head" data-reveal>
                <div className="eyebrow">The whole path</div>
                <h2 className="section-title" id="topology-title">
                  Private in transit. Private at rest. In unison.
                </h2>
                <p className="section-desc">
                  Follow one request from your browser to the file it came for. Every handoff is
                  authenticated, encrypted, and designed so no single layer has to trust the open
                  internet.
                </p>
              </div>
              <div className="infra-map-shell" data-reveal data-reveal-delay="80">
                <div className="infra-map-toolbar">
                  <span>
                    <i className="infra-live-dot"></i> LIVE REQUEST TOPOLOGY
                  </span>
                  <span className="infra-map-toolbar-right">
                    TLS 1.3 <b>·</b> EDGE VERIFIED <b>·</b> ORIGIN HIDDEN <b>·</b> BUCKET PRIVATE
                  </span>
                </div>
                <div
                  className="infra-map-stage"
                  id="infraMapStage"
                  role="group"
                  aria-label="Request topology diagram: your browser connects over HTTPS/TLS to the Cloudflare edge, where Turnstile checks bots and edge defenses absorb attacks, then a private Cloudflare Tunnel carries the request to the authenticated Spindle core, which reads files from a private Backblaze B2 bucket."
                >
                  <div className="infra-map-scan" aria-hidden="true"></div>
                  <div className="infra-map-hud infra-map-hud--left" aria-hidden="true">
                    INGRESS <span>ENCRYPTED</span>
                  </div>
                  <div className="infra-map-hud infra-map-hud--right" aria-hidden="true">
                    EGRESS <span>PRIVATE</span>
                  </div>
                  <svg
                    className="infra-map-svg"
                    viewBox="0 0 1120 520"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <filter id="infra-packet-glow" x="-300%" y="-300%" width="700%" height="700%">
                        <feGaussianBlur stdDeviation="5" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path
                      className="infra-route infra-route--flow"
                      data-route="client"
                      d="M202 240 H291"
                    />
                    <path
                      className="infra-route infra-route--flow"
                      data-route="edge"
                      d="M471 240 H560"
                    />
                    <path
                      className="infra-route infra-route--flow"
                      data-route="bot"
                      d="M381 180 V112"
                    />
                    <path
                      className="infra-route infra-route--flow"
                      data-route="bot"
                      d="M381 300 V366"
                    />
                    <path
                      className="infra-route infra-route--flow"
                      data-route="tunnel"
                      d="M740 240 H828"
                    />
                    <path
                      className="infra-route infra-route--flow"
                      data-route="core"
                      d="M918 300 V356"
                    />
                    <circle className="infra-packet" r="4" filter="url(#infra-packet-glow)">
                      <animateMotion
                        dur="7s"
                        repeatCount="indefinite"
                        path="M202 240 H291 M471 240 H560 M740 240 H828 M918 300 V356"
                      />
                    </circle>
                    <circle
                      className="infra-packet infra-packet--soft"
                      r="3"
                      filter="url(#infra-packet-glow)"
                    >
                      <animateMotion
                        dur="7s"
                        begin="-3.5s"
                        repeatCount="indefinite"
                        path="M202 240 H291 M471 240 H560 M740 240 H828 M918 300 V356"
                      />
                    </circle>
                  </svg>
                  <div
                    className="infra-node infra-node--client is-active"
                    data-stage="client"
                    style={{ "--x": "10%", "--y": "46%" } as CSSProperties}
                  >
                    <span className="infra-node-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-globe" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">01 · YOU</span>
                      <strong>Browser</strong>
                      <small>HTTPS / TLS request</small>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--edge"
                    data-stage="edge"
                    style={{ "--x": "34%", "--y": "46%" } as CSSProperties}
                  >
                    <span className="infra-node-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-shield" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">02 · CLOUDFLARE</span>
                      <strong>Edge network</strong>
                      <small>TLS · session check</small>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--satellite infra-node--turnstile"
                    data-stage="bot"
                    style={{ "--x": "34%", "--y": "16%" } as CSSProperties}
                  >
                    <span className="infra-node-icon infra-node-icon--tiny">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">TURNSTILE</span>
                      <strong>Bot check</strong>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--satellite infra-node--attack"
                    data-stage="bot"
                    style={{ "--x": "34%", "--y": "76%" } as CSSProperties}
                  >
                    <span className="infra-node-icon infra-node-icon--tiny">
                      <svg className="icon icon--xs">
                        <use href="#i-bolt" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">EDGE DEFENSE</span>
                      <strong>Attacks absorbed</strong>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--tunnel"
                    data-stage="tunnel"
                    style={{ "--x": "58%", "--y": "46%" } as CSSProperties}
                  >
                    <span className="infra-node-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-lock" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">03 · PRIVATE LINK</span>
                      <strong>Cloudflare Tunnel</strong>
                      <small>Encrypted, outbound-only</small>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--core"
                    data-stage="core"
                    style={{ "--x": "82%", "--y": "46%" } as CSSProperties}
                  >
                    <span className="infra-node-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-cube" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">04 · SPINDLE</span>
                      <strong>Authenticated core</strong>
                      <small>Workspace services</small>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                  <div
                    className="infra-node infra-node--storage"
                    data-stage="storage"
                    style={{ "--x": "82%", "--y": "80%" } as CSSProperties}
                  >
                    <span className="infra-node-icon">
                      <svg className="icon icon--sm">
                        <use href="#i-folder" />
                      </svg>
                    </span>
                    <span className="infra-node-body">
                      <span className="infra-node-kicker">05 · BACKBLAZE B2</span>
                      <strong>Private bucket</strong>
                      <small>Files & projects</small>
                    </span>
                    <i className="infra-node-led"></i>
                  </div>
                </div>
                <div className="infra-trace">
                  <div className="infra-trace-head">
                    <span>
                      <i className="infra-live-dot"></i> REQUEST TRACE
                    </span>
                    <span className="mono" id="infraTraceCount">
                      01 / 06
                    </span>
                  </div>
                  <ol className="infra-trace-steps" id="infraTraceSteps">
                    <li>
                      <button
                        type="button"
                        className="infra-trace-step is-active"
                        data-trace="client"
                        aria-current="step"
                      >
                        <span className="mono">01</span>
                        <strong>Browser</strong>
                        <small>TLS request</small>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="infra-trace-step" data-trace="edge">
                        <span className="mono">02</span>
                        <strong>Cloudflare</strong>
                        <small>TLS + identity</small>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="infra-trace-step" data-trace="bot">
                        <span className="mono">03</span>
                        <strong>Edge defense</strong>
                        <small>Bots + attacks</small>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="infra-trace-step" data-trace="tunnel">
                        <span className="mono">04</span>
                        <strong>Tunnel</strong>
                        <small>Encrypted link</small>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="infra-trace-step" data-trace="core">
                        <span className="mono">05</span>
                        <strong>Spindle</strong>
                        <small>Session verified</small>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="infra-trace-step" data-trace="storage">
                        <span className="mono">06</span>
                        <strong>B2 vault</strong>
                        <small>Private object</small>
                      </button>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </section>
          <section
            className="section section--alt infra-connection-section"
            id="connection"
            aria-labelledby="connection-title"
          >
            <div className="infra-split container">
              <div className="infra-copy" data-reveal>
                <div className="infra-index">
                  <span>01</span>
                  <i></i> THE CONNECTION
                </div>
                <h2 className="section-title" id="connection-title">
                  A protected line, every time you visit.
                </h2>
                <p className="section-desc">
                  When you open Spindle, your browser sends an HTTPS request to our servers. TLS
                  encrypts it in transit, Cloudflare authenticates it at the edge, and only then
                  does it reach the workspace. There is no open-backdoor path to our origin.
                </p>
                <ol className="infra-steps">
                  <li>
                    <strong>Your browser opens the request.</strong>
                    <span>HTTPS negotiates a TLS session before any project data moves.</span>
                  </li>
                  <li>
                    <strong>Cloudflare verifies it.</strong>
                    <span>The edge terminates TLS, checks the request, and applies our rules.</span>
                  </li>
                  <li>
                    <strong>You get the website.</strong>
                    <span>
                      Verified traffic continues; suspicious traffic never reaches Spindle.
                    </span>
                  </li>
                  <li>
                    <strong>The origin stays hidden.</strong>
                    <span>
                      Cloudflare Tunnels connect outward from our servers, so no inbound port has to
                      be exposed.
                    </span>
                  </li>
                </ol>
              </div>
              <div className="infra-console" data-reveal data-reveal-delay="100">
                <div className="infra-console-head">
                  <span>REQUEST TRACE</span>
                  <span className="infra-console-status">
                    <i></i> 200 OK
                  </span>
                </div>
                <div className="infra-console-body">
                  <div className="infra-console-line">
                    <span className="infra-console-prompt">$</span>
                    <code>open https://spindle.app/workspace</code>
                  </div>
                  <div className="infra-console-line" data-log="client">
                    <span>→</span>
                    <code>client handshake</code>
                    <em>TLS 1.3 · encrypted</em>
                  </div>
                  <div className="infra-console-line" data-log="edge">
                    <span>→</span>
                    <code>edge authentication</code>
                    <em>verified</em>
                  </div>
                  <div className="infra-console-line" data-log="bot">
                    <span>→</span>
                    <code>turnstile + waf</code>
                    <em>human traffic only</em>
                  </div>
                  <div className="infra-console-line" data-log="tunnel">
                    <span>→</span>
                    <code>cloudflare tunnel</code>
                    <em>outbound-only</em>
                  </div>
                  <div className="infra-console-line" data-log="core">
                    <span>→</span>
                    <code>session check</code>
                    <em>project access</em>
                  </div>
                  <div className="infra-console-line" data-log="storage">
                    <span>→</span>
                    <code>b2 private object</code>
                    <em>retrieved</em>
                  </div>
                  <div className="infra-console-line infra-console-line--done">
                    <span>✓</span>
                    <code>workspace ready</code>
                    <em>no origin exposed</em>
                  </div>
                  <span className="infra-console-cursor" aria-hidden="true"></span>
                </div>
                <div className="infra-console-foot">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-lock" />
                    </svg>{" "}
                    ENCRYPTED IN TRANSIT
                  </span>
                  <span className="mono">NO PUBLIC ORIGIN IP</span>
                </div>
              </div>
            </div>
          </section>
          <section
            className="section infra-defense-section"
            id="defense"
            aria-labelledby="defense-title"
          >
            <div className="container">
              <div className="section-head infra-section-head" data-reveal>
                <div className="eyebrow">At the edge</div>
                <h2 className="section-title" id="defense-title">
                  Bots stop at the door. Attacks stop at the edge.
                </h2>
                <p className="section-desc">
                  Cloudflare sits in front of Spindle, so hostile traffic is filtered long before it
                  can touch a workspace. Your projects stay reachable without exposing our servers
                  to the internet.
                </p>
              </div>
              <div className="infra-defense-grid">
                <article className="infra-defense-card" data-reveal>
                  <span className="infra-defense-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-check" />
                    </svg>
                  </span>
                  <span className="infra-defense-tag">TURNSTILE</span>
                  <h3>Humans pass. Scripts don't.</h3>
                  <p>
                    Invisible checks separate real people from automated bots before a request is
                    allowed through. No puzzle boxes for you, no free rein for scrapers.
                  </p>
                </article>
                <article className="infra-defense-card" data-reveal data-reveal-delay="60">
                  <span className="infra-defense-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-shield" />
                    </svg>
                  </span>
                  <span className="infra-defense-tag">WAF + RATE LIMITS</span>
                  <h3>Known attacks get dropped.</h3>
                  <p>
                    Malicious patterns and floods are challenged, throttled, or blocked at
                    Cloudflare's edge instead of being handed to our application.
                  </p>
                </article>
                <article className="infra-defense-card" data-reveal data-reveal-delay="120">
                  <span className="infra-defense-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-bolt" />
                    </svg>
                  </span>
                  <span className="infra-defense-tag">DDOS ABSORPTION</span>
                  <h3>The network takes the hit.</h3>
                  <p>
                    Cloudflare absorbs large volumes of hostile traffic across its network, keeping
                    Spindle online when a single server would buckle.
                  </p>
                </article>
                <article className="infra-defense-card" data-reveal data-reveal-delay="180">
                  <span className="infra-defense-icon">
                    <svg className="icon icon--sm">
                      <use href="#i-lock" />
                    </svg>
                  </span>
                  <span className="infra-defense-tag">CLOUDFLARE TUNNELS</span>
                  <h3>No origin to attack.</h3>
                  <p>
                    Our services connect out through encrypted tunnels. There is no public origin IP
                    to scan and no inbound port left open for attackers.
                  </p>
                </article>
              </div>
              <div className="infra-defense-band" data-reveal>
                <div className="infra-defense-flow">
                  <span>INTERNET</span>
                  <i></i>
                  <span className="infra-defense-flow-highlight">CLOUDFLARE EDGE</span>
                  <i></i>
                  <span>SPINDLE CORE</span>
                </div>
                <p>
                  <svg className="icon icon--sm">
                    <use href="#i-shield" />
                  </svg>{" "}
                  Verified requests continue. Bots, scrapes, and floods end at the edge.
                </p>
              </div>
            </div>
          </section>
          <section
            className="section section--alt infra-storage-section"
            id="storage"
            aria-labelledby="storage-title"
          >
            <div className="infra-split infra-split--reverse container">
              <div className="infra-vault" data-reveal data-reveal-delay="100" aria-hidden="true">
                <div className="infra-vault-grid"></div>
                <div className="infra-vault-ring"></div>
                <div className="infra-vault-core">
                  <svg className="icon">
                    <use href="#i-lock" />
                  </svg>
                  <span className="mono">BUCKET: PRIVATE</span>
                  <strong>Backblaze B2</strong>
                  <small>Your files · your projects</small>
                </div>
                <div className="infra-vault-file infra-vault-file--one">
                  <svg className="icon icon--xs">
                    <use href="#i-folder" />
                  </svg>{" "}
                  survey.parquet
                </div>
                <div className="infra-vault-file infra-vault-file--two">
                  <svg className="icon icon--xs">
                    <use href="#i-code" />
                  </svg>{" "}
                  analysis.ipynb
                </div>
                <div className="infra-vault-file infra-vault-file--three">
                  <svg className="icon icon--xs">
                    <use href="#i-layers" />
                  </svg>{" "}
                  field-notes.md
                </div>
                <span className="infra-vault-chip infra-vault-chip--top">ENCRYPTED AT REST</span>
                <span className="infra-vault-chip infra-vault-chip--bottom">NO PUBLIC URLS</span>
              </div>
              <div className="infra-copy" data-reveal>
                <div className="infra-index">
                  <span>02</span>
                  <i></i> THE STORAGE
                </div>
                <h2 className="section-title" id="storage-title">
                  A private vault for your files and projects.
                </h2>
                <p className="section-desc">
                  Spindle stores your files and project data in Backblaze B2, durable object storage
                  built for keeping valuable data safe. Buckets stay private. Access is scoped to
                  Spindle's services. Nothing in your workspace becomes a public link by accident.
                </p>
                <ul className="feature-list infra-feature-list">
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Private buckets only</strong>
                      <small>
                        No open-to-the-internet objects and no guessed URLs into your project.
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
                      <strong>Encrypted in transit and at rest</strong>
                      <small>
                        TLS on the way in, server-side encryption once the object is stored.
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
                      <strong>Scoped access, not shared secrets</strong>
                      <small>Only the service that needs an object can read or write it.</small>
                    </span>
                  </li>
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Made to last</strong>
                      <small>
                        Redundant object storage keeps research intact across projects and seasons.
                      </small>
                    </span>
                  </li>
                </ul>
                <div className="infra-storage-note">
                  <svg className="icon icon--sm">
                    <use href="#i-sparkle" />
                  </svg>
                  <span>
                    Your files are never used to train ad models, broker profiles, or mine your
                    research. They are stored so you can keep working — nothing more.
                  </span>
                </div>
              </div>
            </div>
          </section>
          <section className="section infra-guarantee-section" aria-labelledby="guarantee-title">
            <div className="container">
              <div className="infra-guarantee" data-reveal>
                <div className="eyebrow">The short version</div>
                <h2 id="guarantee-title">Private in transit. Private at rest. Yours throughout.</h2>
                <p>
                  HTTPS/TLS protects the trip. Cloudflare verifies the visitor, filters the bots,
                  absorbs the attacks, and hides the origin. Cloudflare Tunnels carry only
                  authenticated traffic inward. Backblaze B2 keeps the actual files in a private,
                  durable vault.
                </p>
                <div className="infra-guarantee-chips">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Never sold
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Never tampered with
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Never public by default
                  </span>
                </div>
                <a className="text-link infra-guarantee-link" href="/security">
                  Read the security and trust centre{" "}
                  <svg className="icon icon--xs" aria-hidden="true">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
                <p className="infra-guarantee-dpa">
                  Institutions evaluating Spindle can review the{" "}
                  <a href="/dpa">Data Processing Addendum and current subprocessor list</a>,
                  download the template, and ask for a countersigned copy.
                </p>
              </div>
            </div>
          </section>
          <section className="cta-section" id="get-started">
            <div className="container">
              <div className="cta-box" data-reveal>
                <h2>Bring the project. We'll keep it private.</h2>
                <p>
                  Start with 5 GB of secure storage, a lab, local search, and 20 agent requests a
                  day. Your research stays yours.
                </p>
                <div className="cta-actions">
                  <a href="/sign-up" className="btn btn--primary btn--lg">
                    Create free workspace
                  </a>
                  <a href="/docs" className="btn btn--ghost btn--lg">
                    Read the docs
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>

        <PageInteractions page="infrastructure" />
      </div>
    </PageTransition>
  )
}
