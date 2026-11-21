// Verifies the backlog was created correctly.
//   node scripts/linear/verify-issues.mjs
import { gql } from "./linear-client.mjs"

const PROJECT_ID = "401484f6-2999-428d-88ae-e922a3f666be"
const OWNER = "Bogdan Zogovic"

const datasets = await Promise.all(
  ["01-distributed", "02-security", "03-performance", "04-ui", "05-testing"].map((f) =>
    import(`./data/${f}.mjs`),
  ),
)
const specs = datasets.flatMap((d) =>
  d.issues.map((issue) => ({ ...issue, categoryLabel: d.categoryLabel, group: d.group })),
)

const issues = []
let after = null
for (;;) {
  const page = await gql(
    `query($projectId: String!, $after: String) {
      project(id: $projectId) {
        issues(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title url description
            state { name type }
            priority estimate
            assignee { name }
            labels { nodes { name } }
            project { id }
          }
        }
      }
    }`,
    { projectId: PROJECT_ID, after },
  )
  issues.push(...page.project.issues.nodes)
  if (!page.project.issues.pageInfo.hasNextPage) break
  after = page.project.issues.pageInfo.endCursor
}

const byTitle = new Map()
for (const issue of issues) byTitle.set(issue.title, [...(byTitle.get(issue.title) ?? []), issue])

const problems = []
const rows = []

for (const spec of specs) {
  const matches = byTitle.get(spec.title) ?? []
  if (matches.length === 0) {
    problems.push(`#${spec.n}: missing "${spec.title}"`)
    continue
  }
  if (matches.length > 1) problems.push(`#${spec.n}: ${matches.length} copies of "${spec.title}"`)
  const issue = matches[0]

  if (issue.state.name !== "Todo") problems.push(`#${spec.n}: state is ${issue.state.name}`)
  if (issue.priority !== spec.priority) problems.push(`#${spec.n}: priority ${issue.priority} != ${spec.priority}`)
  if (issue.estimate !== spec.estimate) problems.push(`#${spec.n}: estimate ${issue.estimate} != ${spec.estimate}`)

  const expectedLabels = new Set(
    [spec.categoryLabel, ...spec.labels].map((l) => l.toLowerCase()),
  )
  const actualLabels = new Set(issue.labels.nodes.map((l) => l.name.toLowerCase()))
  const missingLabels = [...expectedLabels].filter((l) => !actualLabels.has(l))
  if (missingLabels.length) problems.push(`#${spec.n}: missing labels ${missingLabels.join(",")}`)

  const assignee = issue.assignee?.name ?? null
  if (spec.frontend && assignee !== OWNER) problems.push(`#${spec.n}: frontend but assignee ${assignee}`)
  if (!spec.frontend && assignee) problems.push(`#${spec.n}: backend but assigned to ${assignee}`)

  if (!issue.description.includes("## Summary")) problems.push(`#${spec.n}: no Summary section`)
  if (!issue.description.includes("## Implementation notes")) problems.push(`#${spec.n}: no notes section`)
  if (!issue.description.includes("## Acceptance criteria")) problems.push(`#${spec.n}: no acceptance section`)
  if (!issue.description.includes(spec.file)) problems.push(`#${spec.n}: target module not in description`)

  rows.push({ n: spec.n, id: issue.identifier, p: issue.priority, e: issue.estimate, owner: assignee ?? "—" })
}

console.log(`Project issues: ${issues.length}. Backlog issues matched: ${rows.length}/150.`)
const assigned = rows.filter((r) => r.owner !== "—").length
console.log(`Assigned: ${assigned}, unassigned: ${rows.length - assigned}.`)
const ptTotal = rows.reduce((sum, r) => sum + (r.e || 0), 0)
console.log(`Estimates: ${rows.filter((r) => r.e != null).length}/150 set, ${ptTotal} points total.`)
console.log(`Priorities: ${[...new Set(rows.map((r) => r.p))].sort().join(", ")}`)

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  problems.slice(0, 40).forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}
console.log("\nAll checks passed.")
