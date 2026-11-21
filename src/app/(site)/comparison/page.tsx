import "../../styles/pages.css"

import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Comparison — Spindle",
  description:
    "How Spindle stacks up against Deepnote, Coda, Hex, CoCalc, and Benchling across storage, collaboration, compute, and AI agent allowances.",
  path: "/comparison",
})

type Cell = "yes" | "no" | "partial" | string

const providers = ["Deepnote", "Coda", "Hex", "CoCalc", "Benchling"] as const

const rows: { label: string; hint: string; values: Cell[] }[] = [
  {
    label: "Free plan",
    hint: "A usable tier that costs nothing",
    values: ["yes", "yes", "no", "yes", "partial"],
  },
  {
    label: "Free storage",
    hint: "Included on the free tier",
    values: ["5 GB", "unlimited*", "—", "unlimited*", "—"],
  },
  {
    label: "Workspaces / projects",
    hint: "Separate spaces per project",
    values: ["unlimited", "unlimited", "unlimited", "1 active", "unlimited"],
  },
  {
    label: "Real-time collaboration",
    hint: "Live cursors and simultaneous editing",
    values: ["yes", "yes", "no", "yes", "partial"],
  },
  {
    label: "Hosted compute labs",
    hint: "Bootable environments with project files",
    values: ["yes", "no", "yes", "partial", "no"],
  },
  {
    label: "AI agent requests / day",
    hint: "Daily allowance for the built-in agent",
    values: ["20", "10", "—", "—", "30"],
  },
  {
    label: "Version history",
    hint: "Rollback and audit trail for files",
    values: ["partial", "yes", "yes", "yes", "yes"],
  },
  {
    label: "Search across sources",
    hint: "Academic and web search in one place",
    values: ["no", "partial", "no", "no", "yes"],
  },
  {
    label: "Team seats on free tier",
    hint: "How many people can join for free",
    values: ["1", "unlimited", "—", "unlimited", "1"],
  },
  {
    label: "Open API",
    hint: "Programmatic access to workspace data",
    values: ["partial", "yes", "yes", "no", "yes"],
  },
]

function CellMark({ value }: { value: Cell }) {
  if (value === "yes") {
    return (
      <span className="compare-mark compare-mark--yes" aria-label="Yes">
        <svg className="icon icon--sm" aria-hidden="true">
          <use href="#i-check" />
        </svg>
      </span>
    )
  }
  if (value === "no") {
    return (
      <span className="compare-mark compare-mark--no" aria-label="No">
        <svg className="icon icon--sm" aria-hidden="true">
          <use href="#i-close" />
        </svg>
      </span>
    )
  }
  if (value === "partial") {
    return (
      <span className="compare-mark compare-mark--partial" aria-label="Partial">
        –
      </span>
    )
  }
  return <span className="compare-value">{value}</span>
}

export default function ComparisonPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Comparison</div>
            <h1 className="page-title">How Spindle compares.</h1>
            <p className="page-lede">
              A feature-by-feature look at Spindle next to the tools research and team
              workspaces are often measured against.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="compare-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th className="compare-table__corner" scope="col">
                      Capability
                    </th>
                    {providers.map((provider) => (
                      <th key={provider} scope="col" className="compare-table__provider">
                        {provider}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.label}>
                      <th scope="row" className="compare-table__row-label">
                        <span className="compare-table__row-name">{row.label}</span>
                        <span className="compare-table__row-hint">{row.hint}</span>
                      </th>
                      {providers.map((provider, j) => (
                        <td key={provider} className={i % 2 ? "compare-table__cell--alt" : ""}>
                          <CellMark value={row.values[j]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="compare-note">* “Unlimited” subject to fair-use limits.</p>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
