import "../../../styles/pages.css"

import { AppAnalyticsStats } from "@/components/apps/app-analytics-stats"
import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Analytics — Spindle Developers",
  description:
    "Track events from your app and read aggregate stats. Includes a live demo of the analytics client.",
  path: "/developers/analytics",
})

export default function AnalyticsPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Analytics</div>
            <h1 className="page-title">Know what your app does.</h1>
            <p className="page-lede">
              Apps record named events with optional properties. Stats aggregate per event name and
              are stored locally — no third-party tracker required for development.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Model</div>
              <h2 className="section-title">Events in, stats out.</h2>
            </div>
            <div className="doc-content">
              <ul>
                <li>
                  <strong>initAppAnalytics(appId)</strong> returns a client with{" "}
                  <code>track(name, properties)</code>, <code>getStats()</code>, and{" "}
                  <code>listEvents()</code>.
                </li>
                <li>
                  Events persist to <code>localStorage</code> under a per-app key and are capped at
                  1,000 entries (oldest dropped first).
                </li>
                <li>
                  Stats include total events, per-name counts, and first/last timestamps — enough
                  for a dashboard without a backend.
                </li>
              </ul>
              <pre>
                <code>{`import { initAppAnalytics } from "@/lib/apps/analytics"

const analytics = initAppAnalytics("my-app")
analytics.track("app_open", { source: "portal" })
analytics.track("feature_used", { feature: "export" })

console.log(analytics.getStats())`}</code>
              </pre>
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Live demo</div>
              <h2 className="section-title">Stats for the portal-demo app.</h2>
              <p className="section-desc">Events you record here persist in this browser only.</p>
            </div>
            <AppAnalyticsStats appId="portal-demo" demo />
            <div className="page-actions">
              <a href="/developers/playground" className="btn btn--primary">
                Next: API playground
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
