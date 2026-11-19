import type { Metadata } from "next"
import "../../styles/pages.css"

export const metadata: Metadata = {
  title: "Pricing — Spindle",
  description:
    "Spindle is free for one researcher with 5 GB of storage. Labs and teams can talk to us about shared workspaces and central billing.",
}

export default function PricingPage() {
  return (
    <main id="top" className="page-main">
      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">Pricing</div>
          <h1 className="page-title">Start free. Bring a project.</h1>
          <p className="page-lede">
            The full workspace, 5 GB of storage, and 20 agent requests a day — no credit card.
            Bigger research groups can talk to us about shared controls.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-value">
                5<span className="stat-suffix"> GB</span>
              </div>
              <p>Storage per account</p>
            </div>
            <div className="stat">
              <div className="stat-value">20</div>
              <p>Agent requests every day</p>
            </div>
            <div className="stat">
              <div className="stat-value">
                100<span className="stat-suffix">+</span>
              </div>
              <p>Formats detected inline</p>
            </div>
            <div className="stat">
              <div className="stat-value">50</div>
              <p>Extra requests by referral</p>
            </div>
          </div>
          <div className="plan-cards">
            <div className="plan-card plan-card--free">
              <div className="plan-head">
                <span className="plan-name">Hobby</span> <span className="plan-price">$0</span>
              </div>
              <p>For a single researcher or a project that's just getting started.</p>
              <ul>
                <li>5 GB storage</li>
                <li>Lab, Search, Files, Agent, and Chat</li>
                <li>Automations and cron jobs</li>
                <li>20 agent requests per day</li>
              </ul>
              <a href="/#get-started" className="btn btn--primary btn--full">
                Create your workspace
              </a>
            </div>
            <div className="plan-card">
              <div className="plan-head">
                <span className="plan-name">Enterprise</span>
                <span className="plan-tag">TALK TO US</span>
              </div>
              <p>Custom features, dedicated support, and anything your organization needs.</p>
              <ul>
                <li>Custom integrations and workflows</li>
                <li>Dedicated infrastructure and SLA</li>
                <li>Onboarding and training for your team</li>
                <li>
                  Countersigned <a href="/dpa">DPA and subprocessor list</a>
                </li>
              </ul>
              <a href="/about#contact" className="btn btn--primary btn--full">
                Contact us
              </a>
              <a className="text-link plan-security-link" href="/security">
                Security and trust centre{" "}
                <svg className="icon icon--xs" aria-hidden="true">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
            </div>
          </div>
          <div className="referral-note">
            <svg className="icon icon--xs" aria-hidden="true">
              <use href="#i-users" />
            </svg>{" "}
            Refer a friend and get <strong>+50 agent requests</strong>, one time, when they create
            an account with your link.{" "}
            <a href="/docs/quickstart">
              See how to start{" "}
              <svg className="icon icon--xs" aria-hidden="true">
                <use href="#i-arrow-right" />
              </svg>
            </a>
          </div>
        </div>
      </section>
      <section className="cta-section">
        <div className="container">
          <div className="cta-box">
            <h2>Give your research a place to live.</h2>
            <p>Start with 5 GB, a lab, local search, and 20 agent requests a day.</p>
            <div className="cta-actions">
              <a href="/#get-started" className="btn btn--primary btn--lg">
                Create free workspace
              </a>
              <a href="/about#contact" className="btn btn--ghost btn--lg">
                Talk to us
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
