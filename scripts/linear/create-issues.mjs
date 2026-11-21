// Creates the 150-issue backlog in the Spindle Linear project.
//
//   node scripts/linear/create-issues.mjs --dry-run   print what would be created
//   node scripts/linear/create-issues.mjs             create the issues
//
// Re-running is safe: issues are matched by exact title inside the project.
import { gql } from "./linear-client.mjs"
import * as d1 from "./data/01-distributed.mjs"
import * as d2 from "./data/02-security.mjs"
import * as d3 from "./data/03-performance.mjs"
import * as d4 from "./data/04-ui.mjs"
import * as d5 from "./data/05-testing.mjs"

const TEAM_ID = "3ac43f9f-0db4-48ad-a4a4-6d2a48b8c4e8"
const PROJECT_ID = "401484f6-2999-428d-88ae-e922a3f666be"
const TODO_STATE_ID = "0bc5a9ed-cf0c-4b08-ba53-280c12ffd2df"
const OWNER_ID = "881e1e49-4f2e-43d1-a129-7226aa9d7402" // Bogdan Zogovic
const DRY_RUN = process.argv.includes("--dry-run")

const PRIORITY_LABEL = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" }

const datasets = [d1, d2, d3, d4, d5]

function buildDescription(issue, group) {
  const lines = [
    "## Summary",
    "",
    issue.summary,
    "",
    `**Target module:** \`${issue.file}\``,
    "",
    "## Implementation notes",
    "",
    ...issue.notes.map((note) => `- ${note}`),
    "",
    "## Acceptance criteria",
    "",
    ...issue.acceptance.map((criterion) => `- [ ] ${criterion}`),
    "",
    "---",
    "",
    `_Part of the ${group} backlog._`,
  ]
  return lines.join("\n")
}

function validate(all) {
  const problems = []
  const seen = new Set()
  const titles = new Set()
  const labels = new Set()

  for (const { issue, group, categoryLabel } of all) {
    const where = `#${issue.n}`
    if (!Number.isInteger(issue.n) || issue.n < 1 || issue.n > 150) problems.push(`${where}: bad issue number`)
    if (seen.has(issue.n)) problems.push(`${where}: duplicate number`)
    seen.add(issue.n)
    if (!issue.title || issue.title.length > 200) problems.push(`${where}: bad title`)
    if (titles.has(issue.title)) problems.push(`${where}: duplicate title "${issue.title}"`)
    titles.add(issue.title)
    if (!issue.file) problems.push(`${where}: missing target module`)
    if (!issue.summary || issue.summary.length < 80) problems.push(`${where}: summary too short`)
    if (!issue.notes?.length || issue.notes.length < 3) problems.push(`${where}: needs at least 3 implementation notes`)
    if (!issue.acceptance?.length || issue.acceptance.length < 3) problems.push(`${where}: needs at least 3 acceptance criteria`)
    if (![1, 2, 3, 4].includes(issue.priority)) problems.push(`${where}: bad priority`)
    if (![1, 2, 3, 5, 8].includes(issue.estimate)) problems.push(`${where}: estimate ${issue.estimate} not on the fibonacci scale`)
    issue.labels.forEach((label) => labels.add(label))
    if (issue.frontend && !OWNER_ID) problems.push(`${where}: frontend issue without an owner`)
  }

  for (let n = 1; n <= 150; n += 1) if (!seen.has(n)) problems.push(`missing issue #${n}`)

  return { problems, labels: [...labels].sort() }
}

const all = datasets.flatMap((dataset) =>
  dataset.issues.map((issue) => ({
    issue,
    group: dataset.group,
    categoryLabel: dataset.categoryLabel,
  })),
)

const { problems, labels } = validate(all)
if (problems.length) {
  console.error(`Validation failed (${problems.length}):`)
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}

console.log(`Validated ${all.length} issues, ${labels.length} distinct labels.`)
if (DRY_RUN) {
  for (const { issue, group } of all) {
    console.log(
      `#${String(issue.n).padStart(3, "0")} [P${issue.priority} / ${issue.estimate}pt] ` +
        `${issue.frontend ? "frontend " : "backend  "} ${group.padEnd(34)} ${issue.title}`,
    )
  }
  process.exit(0)
}

// --- labels ---------------------------------------------------------------
async function fetchLabels() {
  const res = await gql(
    `query($teamId: String!) { team(id: $teamId) { labels(first: 250) { nodes { id name } } } }`,
    { teamId: TEAM_ID },
  )
  return new Map(res.team.labels.nodes.map((l) => [l.name.toLowerCase(), l.id]))
}

let labelIds = await fetchLabels()
for (const name of labels) {
  if (labelIds.has(name.toLowerCase())) continue
  try {
    const created = await gql(
      `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name } } }`,
      { input: { name, teamId: TEAM_ID } },
    )
    if (created.issueLabelCreate?.issueLabel?.id) {
      labelIds.set(name.toLowerCase(), created.issueLabelCreate.issueLabel.id)
      console.log(`Created label "${name}"`)
    }
  } catch (error) {
    // A concurrent create can race us; the re-fetch below resolves it.
    console.log(`Label "${name}" not created (${error.message}); will re-check.`)
  }
}

// Re-fetch so ids come from Linear rather than from mutation payloads.
labelIds = await fetchLabels()
const unresolved = labels.filter((name) => !labelIds.get(name.toLowerCase()))
if (unresolved.length) {
  console.error(`Missing label ids after creation: ${unresolved.join(", ")}`)
  process.exit(1)
}

// --- existing issues ------------------------------------------------------
const projectIssues = await gql(
  `query($projectId: String!) { project(id: $projectId) { issues(first: 250) { nodes { id identifier title } } } }`,
  { projectId: PROJECT_ID },
)
const byTitle = new Map(projectIssues.project.issues.nodes.map((i) => [i.title, i]))

console.log(`Project already has ${byTitle.size} issues; ${all.length} in this backlog.`)

// --- create ---------------------------------------------------------------
const CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url state { name } priority estimate assignee { name } labels { nodes { name } } }
  }
}`

let created = 0
let skipped = 0
let failed = 0

for (const { issue, group, categoryLabel } of all) {
  if (byTitle.has(issue.title)) {
    skipped += 1
    continue
  }

  const input = {
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    stateId: TODO_STATE_ID,
    title: issue.title,
    description: buildDescription(issue, group),
    priority: issue.priority,
    estimate: issue.estimate,
    // Linear rejects duplicate label ids, and a category label can also be
    // listed per issue (for example security/security).
    labelIds: [...new Set([categoryLabel, ...issue.labels].map((n) => n.toLowerCase()))].map((n) =>
      labelIds.get(n),
    ),
  }
  if (issue.frontend) input.assigneeId = OWNER_ID

  if (input.labelIds.some((id) => !id)) {
    throw new Error(`unresolved label id for "${issue.title}"`)
  }

  try {
    const result = await gql(CREATE, { input })
    if (!result.issueCreate.success) throw new Error("issueCreate returned success=false")
    created += 1
    const ref = result.issueCreate.issue
    console.log(
      `+ ${ref.identifier}  P${ref.priority} ${ref.estimate}pt  ${ref.state.name}  ` +
        `${ref.assignee?.name ?? "unassigned"}  ${ref.title}`,
    )
    // Mild pacing keeps us far below the API rate limit.
    if (created % 20 === 0) await new Promise((r) => setTimeout(r, 1000))
  } catch (error) {
    failed += 1
    console.error(`! Failed #${issue.n} "${issue.title}": ${error.message}`)
  }
}

console.log(`\nCreated ${created}, skipped ${skipped} (already present), failed ${failed}.`)
if (failed) process.exit(1)
