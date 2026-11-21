// Read-only verification of milestone sequencing and dependencies.
//   node scripts/linear/verify-sequence.mjs
import { gql } from "./linear-client.mjs"

const PROJECT_ID = "401484f6-2999-428d-88ae-e922a3f666be"

const datasets = await Promise.all(
  ["01-distributed", "02-security", "03-performance", "04-ui", "05-testing"].map((f) =>
    import(`./data/${f}.mjs`),
  ),
)
const specs = datasets.flatMap((d) => d.issues.map((i) => ({ ...i })))
const specByTitle = new Map(specs.map((s) => [s.title, s]))

const milestoneData = await gql(
  `query($id: String!) {
    project(id: $id) {
      milestones: projectMilestones(first: 50) { nodes { id name sortOrder targetDate } }
    }
  }`,
  { id: PROJECT_ID },
)
const milestones = milestoneData.project.milestones.nodes.sort((a, b) => a.sortOrder - b.sortOrder)

const issues = []
let after = null
for (;;) {
  const page = await gql(
    `query($id: String!, $after: String) {
      project(id: $id) {
        issues(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title
            projectMilestone { id }
            relations { nodes { type relatedIssue { id } } }
          }
        }
      }
    }`,
    { id: PROJECT_ID, after },
  )
  issues.push(...page.project.issues.nodes)
  if (!page.project.issues.pageInfo.hasNextPage) break
  after = page.project.issues.pageInfo.endCursor
}

const backlog = issues.filter((i) => specByTitle.has(i.title))
const backlogIds = new Set(backlog.map((i) => i.id))
const problems = []

console.log(`Milestones: ${milestones.length}; backlog issues found: ${backlog.length}/150`)

for (const milestone of milestones) {
  const count = backlog.filter((i) => i.projectMilestone?.id === milestone.id).length
  console.log(
    `  ${milestone.sortOrder}. ${milestone.name.padEnd(48)} ${String(count).padStart(3)} issues` +
      `${milestone.targetDate ? `  target ${milestone.targetDate}` : ""}`,
  )
  if (count === 0) problems.push(`milestone "${milestone.name}" is empty`)
}

const phaseOf = new Map()
for (const issue of backlog) {
  if (!issue.projectMilestone) problems.push(`${issue.identifier} has no milestone`)
  const phase = milestones.find((m) => m.id === issue.projectMilestone?.id)
  if (phase) phaseOf.set(issue.id, phase.sortOrder)
}

const blocks = []
for (const issue of backlog) {
  for (const rel of issue.relations.nodes) {
    if (rel.type === "blocks" && backlogIds.has(rel.relatedIssue.id)) {
      blocks.push([issue.id, rel.relatedIssue.id])
    }
  }
}

const seen = new Set()
for (const [from, to] of blocks) {
  const key = `${from}:${to}`
  if (seen.has(key)) problems.push(`duplicate blocks relation ${key}`)
  seen.add(key)
  if (from === to) problems.push(`self dependency ${from}`)
  const a = phaseOf.get(from)
  const b = phaseOf.get(to)
  if (a != null && b != null && a > b) problems.push(`blocker in phase ${a} blocks phase ${b} issue`)
}

console.log(`Blocks relations between backlog issues: ${blocks.length}`)
console.log(`Unsequenced backlog issues: ${backlog.filter((i) => !i.projectMilestone).length}`)

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  problems.slice(0, 30).forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}
console.log("\nMilestone and dependency checks passed.")
