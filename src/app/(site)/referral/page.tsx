import "../../styles/pages.css"
import "../../styles/referral.css"

import { ReferralShare } from "@/components/site/referral-share"
import { ReferralTracker } from "@/components/site/referral-tracker"
import { siteUrl } from "@/lib/changelog"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const description =
  "Refer a colleague to Spindle and earn 50 extra agent requests — one time, never expiring. Share your link and both of you get a full research workspace to start."

export const metadata = createPageMetadata({
  title: "Referral program — Spindle",
  description,
  path: "/referral",
})

const faqItems = [
  {
    question: "What do I get for referring someone?",
    answer:
      "50 extra agent requests, added to your plan one time when a new user creates an account with your link. Unlike the daily twenty, they never expire — they're spent after your daily requests run out.",
  },
  {
    question: "What does the person I invite get?",
    answer:
      "The same free plan everyone starts with: 5 GB of storage, the lab, local search, files, chat, and 20 agent requests a day. No credit card, no trial clock.",
  },
  {
    question: "How does the bonus get counted?",
    answer:
      "One request is one task, however many steps it takes. Reviewing diffs, approving changes, and rolling back are free. Your referral requests sit in a separate balance and are used only after the day's twenty run out.",
  },
  {
    question: "Can I refer more than one person?",
    answer:
      "Yes — each eligible new account created with your link adds another 50 requests, once per referral. Accounts must be genuine: creating multiple accounts or workspaces to farm referral credits is against the acceptable use policy.",
  },
  {
    question: "When does the bonus arrive?",
    answer:
      "When your invitee finishes creating their account. The 50 requests appear next to your daily balance right away and stay there until a busy week needs them.",
  },
  {
    question: "Do referral requests expire?",
    answer:
      "No. The daily twenty reset every day and unused ones don't carry over — that's exactly why the referral bonus is kept separate. Your 50 are added once and kept until you spend them.",
  },
]

export default function ReferralPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main referral-page">
        {/* Captures inbound ?ref= codes for the auth flow. */}
        <ReferralTracker />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Referrals</div>
            <h1 className="page-title">Bring a colleague. Keep 50 requests.</h1>
            <p className="page-lede">
              Spindle is free for one researcher — 5 GB of storage and 20 agent requests a day. Send
              your link to someone starting a project, and when they create an account you earn 50
              extra requests of your own.
            </p>
            <div className="page-actions">
              <a href="#your-link" className="btn btn--primary btn--lg">
                Get your link
              </a>
              <a href="/sign-up" className="btn btn--ghost btn--lg">
                Create a workspace first
              </a>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">
                  50<span className="stat-suffix"> requests</span>
                </div>
                <p>Extra agent requests per referral</p>
              </div>
              <div className="stat">
                <div className="stat-value">1×</div>
                <p>One-time bonus per new account</p>
              </div>
              <div className="stat">
                <div className="stat-value">
                  ∞<span className="stat-suffix"> expiry</span>
                </div>
                <p>Referral requests never expire</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="how-it-works">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">How it works</div>
              <h2 className="section-title">Three steps, no paperwork.</h2>
              <p className="section-desc">
                Your link does the talking. The bonus lands the moment a new user finishes signing
                up with it.
              </p>
            </div>
            <ol className="referral-steps">
              <li className="referral-step">
                <div>
                  <strong>Copy your link</strong>
                  <small>
                    Every visitor gets a personal link on this page — share it anywhere.
                  </small>
                </div>
              </li>
              <li className="referral-step">
                <div>
                  <strong>They create an account</strong>
                  <small>
                    A new user signs up through your link and gets the full free workspace: 5 GB,
                    the lab, search, and 20 agent requests a day.
                  </small>
                </div>
              </li>
              <li className="referral-step">
                <div>
                  <strong>50 requests land</strong>
                  <small>
                    Added once to your balance, never expire, and are spent after your daily
                    requests run out.
                  </small>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="section" id="rewards">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">The mechanics</div>
              <h2 className="section-title">What the bonus actually buys.</h2>
              <p className="section-desc">
                Agent requests are spent on whole tasks — the edits, the moves, the lab run, and the
                summary at the end. Reviewing and approving is always free.
              </p>
            </div>
            <div className="referral-cards">
              <article className="referral-card" data-reveal>
                <div className="eyebrow">For you</div>
                <div className="referral-big">
                  +50<small>agent requests</small>
                </div>
                <h3>One time, per referral</h3>
                <p>
                  Each eligible new account adds another 50. They sit in a separate balance and are
                  used only after your daily twenty run out.
                </p>
              </article>
              <article className="referral-card" data-reveal data-reveal-delay="80">
                <div className="eyebrow">For them</div>
                <div className="referral-big">
                  20<small>requests / day</small>
                </div>
                <h3>The full free plan</h3>
                <p>
                  Your invitee starts with 5 GB of storage, the lab, local search, files, chat, and
                  20 agent requests every day — no card required.
                </p>
              </article>
              <article className="referral-card" data-reveal data-reveal-delay="160">
                <div className="eyebrow">The fine print</div>
                <div className="referral-big">
                  Never<small>expires</small>
                </div>
                <h3>Kept until you need it</h3>
                <p>
                  Daily requests reset every day and don't accumulate. Referral requests are the
                  opposite: added once, kept forever, spent last.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="your-link">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Your link</div>
              <h2 className="section-title">Copy it. Send it. Done.</h2>
              <p className="section-desc">
                Post it, message it, or email it — the link carries your code through to signup.
              </p>
            </div>
            <ReferralShare siteUrl={siteUrl} />
          </div>
        </section>

        <section className="section" id="rules">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">The rules</div>
              <h2 className="section-title">Keep it honest.</h2>
              <p className="section-desc">
                The program is for real introductions — the same people you'd actually recommend
                Spindle to.
              </p>
            </div>
            <div className="referral-rules">
              <article className="referral-rule">
                <h3>New accounts only</h3>
                <p>
                  The bonus applies the first time a new user creates an account with your link.
                  Existing users and repeat signups from the same person don't count twice.
                </p>
              </article>
              <article className="referral-rule">
                <h3>No self-referrals</h3>
                <p>
                  Creating multiple accounts or workspaces to collect referral credits is against
                  the <a href="/acceptable-use">acceptable use policy</a> and can void the bonus.
                </p>
              </article>
              <article className="referral-rule">
                <h3>One bonus per signup</h3>
                <p>
                  50 requests are added once per eligible referral — they don't stack on the same
                  account and they never expire once they land.
                </p>
              </article>
              <article className="referral-rule">
                <h3>Spending order</h3>
                <p>
                  Referral requests are spent after the day's twenty run out, so your earned balance
                  carries forward untouched until a busy week needs it.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section section--alt" id="faq">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Questions</div>
              <h2 className="section-title">The practical details.</h2>
            </div>
            <div className="referral-faq">
              {faqItems.map((item) => (
                <details key={item.question}>
                  <summary>
                    {item.question}{" "}
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-plus" />
                    </svg>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-box">
              <h2>Know someone starting a project?</h2>
              <p>
                Send them your link above — or create your workspace first and come back for it.
              </p>
              <div className="cta-actions">
                <a href="#your-link" className="btn btn--primary btn--lg">
                  Get your referral link
                </a>
                <a href="/sign-up" className="btn btn--ghost btn--lg">
                  Create free workspace
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
