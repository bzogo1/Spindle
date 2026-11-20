import "../../styles/collaboration.css"
import { Globe } from "@/components/ui/globe"
import { NymMixnetDiagram } from "@/components/site/nym-mixnet-diagram"
import { PageInteractions } from "@/components/site/page-interactions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Collaboration — Spindle",
  description:
    "Chat in project channels, edit the same document with live cursors, and manage roles and permissions — all at blazingly fast sync speeds. Nym Mixnet routing for anonymous messages is on the roadmap.",
  path: "/collaboration",
})

export default function CollaborationPage() {
  return (
    <PageTransition>
      <div className="collab-page">
        <main id="top" tabIndex={-1}>
          <NymMixnetDiagram />
          <section className="collab-hero" aria-labelledby="collab-hero-title">
            <div className="collab-hero-wash" aria-hidden="true"></div>
            <div className="collab-hero-grid-lines" aria-hidden="true"></div>
            <div className="collab-hero-grid container">
              <div className="collab-hero-copy" data-reveal>
                <div className="collab-kicker">
                  <span className="collab-kicker-dot"></span> COLLABORATION <span>/</span> LIVE
                  EVERYWHERE
                </div>
                <h1 id="collab-hero-title">
                  One project.
                  <br />
                  <span className="collab-gradient-text">Everyone in sync.</span>
                </h1>
                <p className="collab-lede">
                  Talk in channels, type in the same document, and manage who can touch what —
                  without leaving the research. Keystrokes and cursors land in{" "}
                  <strong>under 40 ms</strong>. Blazingly fast is the boring part.
                </p>
                <div className="collab-hero-actions">
                  <a href="#editing" className="btn btn--primary btn--lg">
                    See it live{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                  <a href="#chat" className="btn btn--ghost btn--lg">
                    Explore team chat{" "}
                    <svg className="icon icon--xs">
                      <use href="#i-arrow-up-right" />
                    </svg>
                  </a>
                </div>
                <div className="collab-hero-meta">
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-bolt" />
                    </svg>{" "}
                    CRDTsync engine
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-shield" />
                    </svg>{" "}
                    Optional Nym anonymity (planned)
                  </span>
                  <span>
                    <svg className="icon icon--xs">
                      <use href="#i-check" />
                    </svg>{" "}
                    Roles built in
                  </span>
                </div>
              </div>
              <div
                className="collab-globe-stage"
                data-reveal
                data-reveal-delay="100"
                role="img"
                aria-label="Interactive globe showing collaborators working together"
              >
                <div className="collab-globe-orbit" aria-hidden="true">
                  <svg viewBox="0 0 560 560" aria-hidden="true">
                    <ellipse
                      className="collab-orbit-line"
                      cx="280"
                      cy="280"
                      rx="252"
                      ry="108"
                      transform="rotate(-21 280 280)"
                    />
                    <ellipse
                      className="collab-orbit-line collab-orbit-line--flow"
                      cx="280"
                      cy="280"
                      rx="252"
                      ry="108"
                      transform="rotate(-21 280 280)"
                      pathLength={100}
                    />
                    <ellipse
                      className="collab-orbit-line collab-orbit-line--soft"
                      cx="280"
                      cy="280"
                      rx="232"
                      ry="158"
                      transform="rotate(27 280 280)"
                    />
                    <circle className="collab-orbit-point" cx="45" cy="350" r="3.5" />
                    <circle
                      className="collab-orbit-point collab-orbit-point--soft"
                      cx="490"
                      cy="205"
                      r="2.5"
                    />
                  </svg>
                </div>
                <div className="collab-globe-halo" aria-hidden="true"></div>
                <div className="collab-globe-mount" aria-hidden="true">
                  <Globe />
                </div>
                <div className="presence-float presence-float--one" aria-hidden="true">
                  <span className="presence-avatar presence-avatar--lime">MR</span>
                  <span>
                    <strong>Mara</strong> is editing <b>analysis.ipynb</b>
                  </span>
                </div>
                <div className="presence-float presence-float--two" aria-hidden="true">
                  <span className="presence-stack">
                    <i>TJ</i>
                    <i>JL</i>
                    <i>+2</i>
                  </span>
                  <span>
                    <strong>5 people</strong> in this project
                  </span>
                </div>
                <div className="presence-float presence-float--three" aria-hidden="true">
                  <svg className="icon icon--xs">
                    <use href="#i-pen" />
                  </svg>
                  <span>
                    Theo's cursor · <b>row 42</b>
                  </span>
                </div>
                <div className="latency-chip" aria-hidden="true">
                  <span className="latency-bars">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <strong>38 ms</strong>
                  <small>median sync</small>
                </div>
              </div>
            </div>
            <div className="container">
              <div className="speed-strip" data-reveal>
                <div className="speed-stat">
                  <strong>
                    38<span>ms</span>
                  </strong>
                  <small>p95 keystroke delivery</small>
                </div>
                <div className="speed-stat">
                  <strong>CRDT</strong>
                  <small>conflict-free merges</small>
                </div>
                <div className="speed-stat">
                  <strong>5-hop</strong>
                  <small>Nym Mixnet planned for anonymous</small>
                </div>
                <div className="speed-stat">
                  <strong>0</strong>
                  <small>
                    <span className="mono">final_v3</span> copies
                  </small>
                </div>
              </div>
            </div>
          </section>
          <section
            className="section collab-doc-section"
            id="editing"
            aria-labelledby="editing-title"
          >
            <div className="collab-split container">
              <div className="collab-copy" data-reveal>
                <div className="collab-index">
                  <span>01</span>
                  <i></i> SHARED CANVAS
                </div>
                <h2 id="editing-title" className="section-title">
                  Type together. No merge conflicts.
                </h2>
                <p className="section-desc">
                  Open a note, a notebook cell, or a CSV row and edit it side by side. You see other
                  people's cursors move, selections highlight, and text arrive as it's typed — in
                  the same file, not a copy of it.
                </p>
                <ul className="feature-list collab-feature-list">
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Live cursors and presence</strong>
                      <small>Know who is here and exactly where they are working</small>
                    </span>
                  </li>
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Character-by-character sync</strong>
                      <small>Updates stream over a persistent WebSocket</small>
                    </span>
                  </li>
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Comments in context</strong>
                      <small>Feedback pinned to the cell, row, or sentence</small>
                    </span>
                  </li>
                  <li>
                    <span className="feature-check">
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>
                    </span>
                    <span>
                      <strong>Attributable history</strong>
                      <small>Every change has an author and a rewind button</small>
                    </span>
                  </li>
                </ul>
                <div className="code-card collab-code">
                  <div className="code-card-head">
                    <span>sync.ts</span>
                    <span className="mono">YJS + WEBSOCKET</span>
                  </div>
                  <pre>
                    <span className="tok-com">{"// one CRDT document per project file"}</span>
                    {"\n"}
                    <span className="tok-key">{"const"}</span>
                    {" doc = "}
                    <span className="tok-key">{"new"}</span>{" "}
                    <span className="tok-fn">{"Y.Doc"}</span>
                    {"()\n"}
                    <span className="tok-key">{"const"}</span>
                    {" room = "}
                    <span className="tok-key">{"new"}</span>{" "}
                    <span className="tok-fn">{"WebsocketProvider"}</span>
                    {"(ws, projectId, doc)\n\ndoc.getText("}
                    <span className="tok-str">{"'field-notes'"}</span>
                    {").observe((event) => {\n  room.awareness.setLocalStateField("}
                    <span className="tok-str">{"'cursor'"}</span>
                    {", event.cursor)\n})"}
                  </pre>
                  <div className="code-card-foot">
                    <span className="status-pill status-pill--tiny">
                      <i></i> 3 peers connected
                    </span>
                    <span className="mono">38 MS RTT</span>
                  </div>
                </div>
              </div>
              <div className="collab-visual" data-reveal data-reveal-delay="100">
                <div className="product-window doc-window">
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">
                      <svg className="icon icon--xs">
                        <use href="#i-pen" />
                      </svg>{" "}
                      coastal-resilience / field-notes.md
                    </span>
                    <span className="window-bar-status">
                      <i></i> Synced 12 ms ago
                    </span>
                  </div>
                  <div className="doc-toolbar">
                    <div className="doc-avatars" aria-label="People editing">
                      <span className="presence-avatar presence-avatar--lime" title="Mara">
                        MR
                      </span>
                      <span className="presence-avatar presence-avatar--mint" title="Theo">
                        TJ
                      </span>
                      <span className="presence-avatar presence-avatar--teal" title="Jules">
                        JL
                      </span>
                    </div>
                    <span className="doc-toolbar-note">3 editing now</span>
                    <span className="doc-toolbar-right mono">UTF-8 · MARKDOWN</span>
                  </div>
                  <div className="doc-page" id="docPage">
                    <div className="doc-line">
                      <span className="doc-ln">01</span>
                      <span className="doc-h1">Field notes — transect 04</span>
                    </div>
                    <div className="doc-line">
                      <span className="doc-ln">02</span>
                      <span>
                        Site <strong>A-01</strong>, lower marsh edge. Overcast, light wind from the
                        west.
                      </span>
                    </div>
                    <div className="doc-line">
                      <span className="doc-ln">03</span>
                      <span className="doc-selection">
                        Salinity at the outer station read 28.4 PSU after the tide turned.
                      </span>
                    </div>
                    <div className="doc-line doc-line--active">
                      <span className="doc-ln">04</span>
                      <span>
                        Second sample taken at <strong>14:20</strong> —{" "}
                        <span id="docTyping" className="doc-typing"></span>
                        <span className="doc-caret" aria-hidden="true"></span>
                      </span>
                    </div>
                    <div className="doc-line">
                      <span className="doc-ln">05</span>
                      <span>
                        Need to cross-check the turbidity series with{" "}
                        <strong>tidal-2026.csv</strong>.
                      </span>
                    </div>
                    <div className="doc-line doc-line--blank">
                      <span className="doc-ln">06</span>
                      <span> </span>
                    </div>
                    <div className="doc-line">
                      <span className="doc-ln">07</span>
                      <span className="doc-muted">— Mara, field lead</span>
                    </div>
                    <div className="remote-cursor remote-cursor--mara" aria-hidden="true">
                      <span>Mara</span>
                    </div>
                    <div className="remote-cursor remote-cursor--theo" aria-hidden="true">
                      <span>Theo</span>
                    </div>
                    <div className="comment-pin" aria-hidden="true">
                      <svg className="icon icon--xs">
                        <use href="#i-message" />
                      </svg>
                      <span>2</span>
                    </div>
                  </div>
                  <div className="doc-foot">
                    <span>
                      <svg className="icon icon--xs">
                        <use href="#i-check" />
                      </svg>{" "}
                      All changes saved locally + synced
                    </span>
                    <span className="mono">REV 1,284</span>
                  </div>
                </div>
                <div className="doc-callout" aria-hidden="true">
                  <span className="callout-dot"></span> Theo is typing in the same block
                </div>
              </div>
            </div>
          </section>
          <section
            className="section section--alt collab-chat-section"
            id="chat"
            aria-labelledby="chat-title"
          >
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">02 / Team chat</div>
                <h2 id="chat-title" className="section-title">
                  Talk where the work happens.
                </h2>
                <p className="section-desc">
                  Channels feel like Discord or Slack, but they live inside the project — next to
                  the files, decisions, and people they're about. And when the conversation is
                  sensitive, Anonymous mode is designed to route it through the Nym Mixnet once that
                  integration ships.
                </p>
              </div>
              <div className="chat-grid">
                <div className="chat-window-shell" data-reveal>
                  <div className="product-window chat-window">
                    <div className="chat-layout">
                      <aside className="chat-rail" aria-label="Chat channels">
                        <div className="chat-workspace">
                          <span className="workspace-mark">CR</span> coastal-resilience{" "}
                          <svg className="icon icon--xs">
                            <use href="#i-chevron-down" />
                          </svg>
                        </div>
                        <div className="chat-section-label">CHANNELS</div>
                        <button className="chat-channel is-active" data-channel="field-notes">
                          <span>#</span> field-notes
                        </button>
                        <button className="chat-channel" data-channel="data-cleaning">
                          <span>#</span> data-cleaning
                        </button>
                        <button className="chat-channel" data-channel="writing">
                          <span>#</span> writing
                        </button>
                        <button className="chat-channel" data-channel="random">
                          <span>#</span> random
                        </button>
                        <div className="chat-section-label chat-section-label--spaced">DIRECT</div>
                        <div className="chat-channel chat-channel--dm">
                          <span className="presence-dot"></span> Mara{" "}
                          <span className="chat-you">you</span>
                        </div>
                        <div className="chat-channel chat-channel--dm">
                          <span className="presence-dot presence-dot--away"></span> Theo
                        </div>
                        <button className="anon-toggle" id="anonToggle" aria-pressed="false">
                          <span className="anon-switch">
                            <i></i>
                          </span>
                          <span>
                            <strong>Anonymous mode</strong>
                            <small id="anonStatus">Off · normal project chat</small>
                          </span>
                        </button>
                      </aside>
                      <div className="chat-panel">
                        <div className="chat-head">
                          <span>
                            <span className="chat-hash">#</span>{" "}
                            <span id="chatChannelName">field-notes</span>
                          </span>
                          <span className="chat-head-meta" id="chatRoute">
                            8 members · project channel
                          </span>
                        </div>
                        <div className="chat-messages" id="chatMessages" aria-live="polite">
                          <div className="chat-msg">
                            <span className="chat-avatar chat-avatar--lime">MR</span>
                            <div className="chat-msg-body">
                              <div className="chat-msg-meta">
                                <strong>Mara</strong>
                                <time>09:14</time>
                              </div>
                              <p>
                                New survey batch is in <code>/data</code>. The viewer detected it as
                                Parquet right away.
                              </p>
                            </div>
                          </div>
                          <div className="chat-msg">
                            <span className="chat-avatar chat-avatar--mint">TJ</span>
                            <div className="chat-msg-body">
                              <div className="chat-msg-meta">
                                <strong>Theo</strong>
                                <time>09:18</time>
                              </div>
                              <p>
                                Nice. I kicked off the cron refresh and the lab still has the kernel
                                from yesterday.
                              </p>
                            </div>
                          </div>
                          <div className="chat-msg">
                            <span className="chat-avatar chat-avatar--teal">JL</span>
                            <div className="chat-msg-body">
                              <div className="chat-msg-meta">
                                <strong>Jules</strong>
                                <time>09:21</time>
                              </div>
                              <p>
                                Adding the site IDs to the shared note now — you'll see my cursor in
                                the second block.
                              </p>
                            </div>
                          </div>
                          <div className="chat-msg chat-msg--anon" id="anonMessage" hidden>
                            <span className="chat-avatar chat-avatar--anon">
                              <svg className="icon icon--xs">
                                <use href="#i-shield" />
                              </svg>
                            </span>
                            <div className="chat-msg-body">
                              <div className="chat-msg-meta">
                                <strong>Anonymous</strong>
                                <time>now</time>
                              </div>
                              <p>Posting anonymously in this thread…</p>
                            </div>
                          </div>
                          <div className="chat-typing" id="chatTyping" aria-hidden="true">
                            <span className="chat-avatar chat-avatar--mint">TJ</span>
                            <span className="typing-dots">
                              <i></i>
                              <i></i>
                              <i></i>
                            </span>
                            <span>Theo is typing</span>
                          </div>
                        </div>
                        <form className="chat-composer" id="chatForm">
                          <label className="sr-only" htmlFor="chatInput">
                            Message channel
                          </label>
                          <input
                            id="chatInput"
                            type="text"
                            autoComplete="off"
                            placeholder="Message #field-notes"
                          />
                          <button type="submit" aria-label="Send message">
                            <svg className="icon icon--sm">
                              <use href="#i-arrow-right" />
                            </svg>
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                  <div className="route-strip" id="routeStrip" aria-hidden="true">
                    <span>YOUR LAPTOP</span>
                    <i></i>
                    <span>ENTRY</span>
                    <i></i>
                    <span className="route-node"></span>
                    <i></i>
                    <span className="route-node"></span>
                    <i></i>
                    <span className="route-node"></span>
                    <i></i>
                    <span>EXIT</span>
                    <i></i>
                    <span>PROJECT</span>
                  </div>
                </div>
                <div className="chat-explain" data-reveal data-reveal-delay="90">
                  <h3>Channels, threads, and a quieter mode.</h3>
                  <p>
                    Every project gets its own channels. Messages, links, and decisions stay with
                    the data instead of disappearing into another app.
                  </p>
                  <div className="anon-card" id="anonCard">
                    <div className="anon-card-head">
                      <svg className="icon icon--xs">
                        <use href="#i-shield" />
                      </svg>{" "}
                      ANONYMOUS MODE
                    </div>
                    <p>
                      Working with confidential sources, whistleblower material, or clinical data?
                      Flip on Anonymous mode to post under a pseudonymous display name instead of
                      your own — your real identity stays off the thread.
                    </p>
                    <button type="button" className="anon-card-action" id="anonExplainToggle">
                      Switch Anonymous mode on{" "}
                      <svg className="icon icon--xs">
                        <use href="#i-arrow-right" />
                      </svg>
                    </button>
                  </div>
                  <div className="nym-heading">
                    <div className="eyebrow">Under the hood</div>
                    <h4>How the Nym Mixnet works</h4>
                    <p>
                      Nym Mixnet integration is planned, not yet shipped. Once it lands, anonymity
                      will wrap each message in layers and send it through a decentralized mixnet
                      instead of a normal project route.
                    </p>
                  </div>
                  <ol className="nym-steps">
                    <li>
                      <span className="nym-step-num">01</span>
                      <div>
                        <strong>Your laptop → Sphinx packet</strong>
                        <p>
                          The message is split into fixed-size packets and wrapped in layers of
                          encryption, so no single hop sees both who sent it and where it's going.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span className="nym-step-num">02</span>
                      <div>
                        <strong>Nym Mixnet → three mixing layers</strong>
                        <p>
                          Independent mix nodes reorder packets, add randomized delays, and mix in
                          indistinguishable cover traffic. Timing and volume patterns disappear.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span className="nym-step-num">03</span>
                      <div>
                        <strong>Exit gateway → project</strong>
                        <p>
                          The exit gateway sees only the destination, not the sender. Nothing in the
                          chain can link your account to the conversation.
                        </p>
                      </div>
                    </li>
                  </ol>
                  <figure className="nym-figure">
                    <img
                      src="/assets/nym-mixnet-diagram.png"
                      alt="Nym's Noise Generating Mixnet diagram: a person's laptop sends packets through the Nym protocol and out through exit gateways"
                      loading="lazy"
                    />
                    <figcaption>
                      Planned route: your device → the Nym Mixnet → exits. Diagram from{" "}
                      <a
                        href="https://nym.com/blog/what-is-a-mixnet"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Nym{" "}
                        <svg className="icon icon--xs">
                          <use href="#i-arrow-up-right" />
                        </svg>
                      </a>
                    </figcaption>
                  </figure>
                  <div className="nym-facts">
                    <div>
                      <svg className="icon icon--xs">
                        <use href="#i-lock" />
                      </svg>
                      <span>
                        <strong>Metadata protection</strong>
                        <small>
                          Hides who is talking, when, and how often — not just the content.
                        </small>
                      </span>
                    </div>
                    <div>
                      <svg className="icon icon--xs">
                        <use href="#i-shield" />
                      </svg>
                      <span>
                        <strong>Open source & audited</strong>
                        <small>
                          Nym's code is public and independently reviewed by security firms.
                        </small>
                      </span>
                    </div>
                    <div>
                      <svg className="icon icon--xs">
                        <use href="#i-clock" />
                      </svg>
                      <span>
                        <strong>Honest tradeoff</strong>
                        <small>
                          Once integrated, anonymous messages will take longer: mixing and cover
                          traffic add latency by design.
                        </small>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="section collab-roles-section"
            id="roles"
            aria-labelledby="roles-title"
          >
            <div className="container">
              <div className="section-head">
                <div className="eyebrow">03 / Access control</div>
                <h2 id="roles-title" className="section-title">
                  Invite people. Set the boundaries.
                </h2>
                <p className="section-desc">
                  The project manager adds teammates and decides who can read, comment, edit files,
                  run the lab, or manage the team. Changes are immediate, attributable, and easy to
                  review.
                </p>
              </div>
              <div className="roles-grid">
                <div className="product-window roles-window" data-reveal>
                  <div className="window-bar">
                    <div className="traffic-lights" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="window-bar-title">
                      <svg className="icon icon--xs">
                        <use href="#i-users" />
                      </svg>{" "}
                      coastal-resilience / access
                    </span>
                    <span className="window-bar-status">
                      <i></i> 5 members
                    </span>
                  </div>
                  <form className="invite-bar" id="inviteForm">
                    <div className="invite-field">
                      <label className="sr-only" htmlFor="inviteEmail">
                        Teammate email
                      </label>
                      <input id="inviteEmail" type="email" placeholder="name@lab.edu" required />
                    </div>
                    <div className="invite-select">
                      <label className="sr-only" htmlFor="inviteRole">
                        Role
                      </label>
                      <select id="inviteRole" defaultValue="editor">
                        <option value="manager">Manager</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <svg className="icon icon--xs">
                        <use href="#i-chevron-down" />
                      </svg>
                    </div>
                    <button type="submit" className="btn btn--primary btn--sm">
                      <svg className="icon icon--xs">
                        <use href="#i-plus" />
                      </svg>{" "}
                      Add member
                    </button>
                  </form>
                  <div className="member-head" aria-hidden="true">
                    <span>Member</span>
                    <span>Role</span>
                    <span>Status</span>
                    <span></span>
                  </div>
                  <div className="member-list" id="memberList">
                    <div className="member-row" data-member="Mara Reyes">
                      <span className="member-identity">
                        <span className="member-avatar member-avatar--lime">MR</span>
                        <span>
                          <strong>Mara Reyes</strong>
                          <small>mara@lab.edu</small>
                        </span>
                      </span>
                      <span>
                        <span className="role-pill role-pill--owner">Owner</span>
                      </span>
                      <span className="member-status">
                        <i></i> Active
                      </span>
                      <button
                        className="member-remove"
                        type="button"
                        disabled
                        aria-label="Cannot remove owner"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-trash" />
                        </svg>
                      </button>
                    </div>
                    <div className="member-row" data-member="Theo Jensen">
                      <span className="member-identity">
                        <span className="member-avatar member-avatar--mint">TJ</span>
                        <span>
                          <strong>Theo Jensen</strong>
                          <small>theo@lab.edu</small>
                        </span>
                      </span>
                      <span>
                        <select
                          className="member-role"
                          aria-label="Role for Theo Jensen"
                          defaultValue="editor"
                        >
                          <option value="manager">Manager</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </span>
                      <span className="member-status">
                        <i></i> Active
                      </span>
                      <button
                        className="member-remove"
                        type="button"
                        aria-label="Remove Theo Jensen"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-trash" />
                        </svg>
                      </button>
                    </div>
                    <div className="member-row" data-member="Jules Lemaire">
                      <span className="member-identity">
                        <span className="member-avatar member-avatar--teal">JL</span>
                        <span>
                          <strong>Jules Lemaire</strong>
                          <small>jules@lab.edu</small>
                        </span>
                      </span>
                      <span>
                        <select
                          className="member-role"
                          aria-label="Role for Jules Lemaire"
                          defaultValue="editor"
                        >
                          <option value="manager">Manager</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </span>
                      <span className="member-status">
                        <i></i> Active
                      </span>
                      <button
                        className="member-remove"
                        type="button"
                        aria-label="Remove Jules Lemaire"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-trash" />
                        </svg>
                      </button>
                    </div>
                    <div className="member-row" data-member="Priya Nair">
                      <span className="member-identity">
                        <span className="member-avatar member-avatar--violet">PN</span>
                        <span>
                          <strong>Priya Nair</strong>
                          <small>priya@university.edu</small>
                        </span>
                      </span>
                      <span>
                        <select
                          className="member-role"
                          aria-label="Role for Priya Nair"
                          defaultValue="viewer"
                        >
                          <option value="manager">Manager</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </span>
                      <span className="member-status member-status--pending">
                        <i></i> Invited
                      </span>
                      <button
                        className="member-remove"
                        type="button"
                        aria-label="Remove Priya Nair"
                      >
                        <svg className="icon icon--xs">
                          <use href="#i-trash" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="roles-foot">
                    <span>
                      <svg className="icon icon--xs">
                        <use href="#i-lock" />
                      </svg>{" "}
                      Owner controls billing and deletion
                    </span>
                    <span className="mono">AUDIT LOG ON</span>
                  </div>
                  <p className="role-toast" id="roleToast" role="status" aria-live="polite"></p>
                </div>
                <aside className="roles-side" data-reveal data-reveal-delay="90">
                  <div className="permission-card">
                    <div className="permission-head">
                      <h3>What can they do?</h3>
                      <span className="mono">ROLE MATRIX</span>
                    </div>
                    <div className="role-tabs" role="tablist" aria-label="Roles">
                      <button role="tab" aria-selected="false" data-role-tab="manager">
                        Manager
                      </button>
                      <button
                        role="tab"
                        aria-selected="true"
                        className="is-active"
                        data-role-tab="editor"
                      >
                        Editor
                      </button>
                      <button role="tab" aria-selected="false" data-role-tab="viewer">
                        Viewer
                      </button>
                    </div>
                    <div className="permission-list" id="permissionList"></div>
                  </div>
                  <div className="audit-card">
                    <div className="audit-head">
                      <svg className="icon icon--xs">
                        <use href="#i-clock" />
                      </svg>{" "}
                      RECENT ACCESS CHANGES
                    </div>
                    <div className="audit-row">
                      <span className="audit-dot"></span>
                      <span>
                        <strong>Theo</strong> was given Editor access
                      </span>
                      <time>2h</time>
                    </div>
                    <div className="audit-row">
                      <span className="audit-dot audit-dot--soft"></span>
                      <span>
                        <strong>Priya</strong> was invited as Viewer
                      </span>
                      <time>1d</time>
                    </div>
                    <div className="audit-row">
                      <span className="audit-dot audit-dot--soft"></span>
                      <span>
                        <strong>Mara</strong> enabled Anonymous mode
                      </span>
                      <time>3d</time>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </section>
          <section
            className="collab-globe-cta"
            aria-label="A globe of collaborators working in the same project"
          >
            <div className="collab-globe-cta-glow" aria-hidden="true"></div>
            <div className="collab-globe-cta-orbit" aria-hidden="true">
              <svg viewBox="0 0 560 560" aria-hidden="true">
                <ellipse
                  className="collab-orbit-line"
                  cx="280"
                  cy="280"
                  rx="252"
                  ry="108"
                  transform="rotate(-21 280 280)"
                />
                <ellipse
                  className="collab-orbit-line collab-orbit-line--soft"
                  cx="280"
                  cy="280"
                  rx="232"
                  ry="158"
                  transform="rotate(27 280 280)"
                />
                <circle className="collab-orbit-point" cx="45" cy="350" r="3.5" />
                <circle
                  className="collab-orbit-point collab-orbit-point--soft"
                  cx="490"
                  cy="205"
                  r="2.5"
                />
              </svg>
            </div>
            <div className="collab-globe-cta-mount" aria-hidden="true">
              <Globe />
            </div>
          </section>
        </main>

        <PageInteractions page="collaboration" />
      </div>
    </PageTransition>
  )
}
