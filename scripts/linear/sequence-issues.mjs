// Sequences the backlog into phased milestones and records blocking relations.
//
//   node scripts/linear/sequence-issues.mjs --dry-run
//   node scripts/linear/sequence-issues.mjs
//
// Idempotent: milestones match by name, issues are only updated when their
// milestone differs, and existing blocks relations are not duplicated.
import { gql } from "./linear-client.mjs"

const PROJECT_ID = "401484f6-2999-428d-88ae-e922a3f666be"
const DRY_RUN = process.argv.includes("--dry-run")

const MILESTONES = [
  {
    name: "Phase 1 — Platform foundations",
    order: 1,
    description:
      "Primitives every later phase builds on: distributed locking, retry/timeout/breaker/load-shedding, streaming buffers, webhook delivery, baseline security headers and input encoding, secret storage with a tamper-evident audit trail, scanner foundations, query and asset caching, and the worker/service-worker shells.\n\n**Exit criteria:** each primitive ships with unit tests, typed result/error shapes, and a module header documenting its trade-offs; no later phase depends on an unbuilt primitive.",
    numbers: [7, 8, 9, 10, 11, 12, 13, 15, 17, 25, 33, 34, 35, 36, 37, 46, 47, 61, 63, 87, 88],
  },
  {
    name: "Phase 2 — Data and platform operations",
    order: 2,
    description:
      "Data-plane work: event sourcing and sagas, replication and pool health, slow-query and deadlock analysis, cache warming, backup/restore verification, WAL archiving, account protection, data classification, field encryption, token storage, vulnerability tracking, and retention enforcement.\n\n**Exit criteria:** backups are restored and validated on a schedule; replication lag and pool saturation are observable; sensitive columns are encrypted and classified; retention runs in dry-run everywhere and is enforced only where approved.",
    numbers: [14, 18, 19, 21, 22, 23, 24, 26, 27, 28, 29, 30, 39, 40, 41, 42, 52, 59, 60],
  },
  {
    name: "Phase 3 — Realtime collaboration and identity",
    order: 3,
    description:
      "Collaborative editing and realtime delivery: CRDT store and document, presence, offline queue, conflict resolution, differential sync, external feed subscriptions, PubSubHubbub, session-hijack detection, passkeys, biometric unlock, and the zero-trust request proxy.\n\n**Exit criteria:** two clients converge under concurrent edits and reconnect; offline mutations replay idempotently; every realtime path has backpressure and a bounded buffer.",
    numbers: [1, 2, 3, 4, 5, 6, 16, 20, 38, 43, 44, 45],
  },
  {
    name: "Phase 4 — Security assurance and compliance",
    order: 4,
    description:
      "Security assurance and compliance: nonce-based CSP and SRI, container/network/pentest scanning, bug-bounty intake, incident response and forensics, threat intel, the posture dashboard, compliance checks, privacy impact assessments, and the data-rights workflows.\n\n**Exit criteria:** scanners run in CI with triaged findings; incidents have an executable playbook; compliance reports show gaps with named owners and evidence.",
    numbers: [31, 32, 48, 49, 50, 51, 53, 54, 55, 56, 57, 58],
  },
  {
    name: "Phase 5 — Performance and delivery",
    order: 5,
    description:
      "Performance and delivery: CDN page caching, prefetch/lazy loading, image/font/CSS optimization, bundle analysis and budgets, real-user and synthetic monitoring, Web Vitals attribution, long-task/layout-shift/resource-timing analysis, network adaptation, memory/CPU/rendering/scroll/animation profiling, background sync, and push notifications.\n\n**Exit criteria:** budgets gate pull requests; RUM reports p75 by route; every optimization has a before/after measurement.",
    numbers: [62, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 89, 90],
  },
  {
    name: "Phase 6 — Product UI",
    order: 6,
    description:
      "Product UI surfaces: drag-and-drop, grids, overlay primitives, tabs/split panes, carousel, tree, data grid, charts/maps/timeline/Gantt/calendar/Kanban, file and document viewers, code/rich text/Markdown/math/diagram renderers, media players, diff, and annotations.\n\n**Exit criteria:** each surface meets the keyboard and screen-reader contract, virtualizes above the agreed threshold, and is covered by a Storybook story plus an interaction test.",
    numbers: [91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120],
  },
  {
    name: "Phase 7 — QA and accessibility",
    order: 7,
    description:
      "Quality engineering: fuzzing, property and mutation testing, load and chaos testing, security test runners, axe-based accessibility automation, visual regression, performance regression, browser/device/OS matrices, screen-reader and keyboard suites, plus touch, voice, print, high-contrast, reduced-motion, dark-mode, RTL, translation, currency, date, number, and unit coverage.\n\n**Exit criteria:** suites run in CI with stable baselines; failures identify the affected engine, locale, or profile; every known exception is documented with an owner.",
    numbers: [121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150],
  },
]

// [blocker, blocked] — the blocker must ship before the blocked issue.
const DEPENDENCIES = [
  [10, 9], [9, 17], [8, 17], [11, 6], [15, 13], [15, 5], [13, 5],
  [7, 27], [7, 29], [7, 42], [25, 12],
  [37, 36], [37, 41], [36, 41], [36, 42],
  [61, 22], [23, 22], [23, 24], [21, 27],
  [28, 29], [29, 30], [18, 19],
  [40, 58], [40, 60], [59, 60],
  [52, 51], [52, 56], [57, 56], [37, 57],
  [53, 54], [31, 70], [63, 32],
  [72, 73], [74, 77], [74, 129], [76, 129],
  [3, 89], [88, 89], [3, 20], [1, 20], [2, 20],
  [6, 16], [43, 44], [38, 45],
  [91, 92], [91, 100], [91, 107], [91, 97],
  [101, 117], [111, 112], [111, 113], [116, 120],
  [87, 109], [66, 108], [17, 14],
  [127, 137], [127, 138], [127, 142], [127, 143],
  [128, 144], [130, 135], [131, 139], [131, 134],
  [145, 146], [149, 150], [122, 123],
]

// --- load specs and validate the sequence ---------------------------------
const datasets = await Promise.all(
  ["01-distributed", "02-security", "03-performance", "04-ui", "05-testing"].map((f) =>
    import(`./data/${f}.mjs`),
  ),
)
const specs = datasets.flatMap((d) => d.issues.map((issue) => ({ ...issue })))
const specByNumber = new Map(specs.map((s) => [s.n, s]))

const assigned = new Map()
const problems = []
for (const milestone of MILESTONES) {
  for (const n of milestone.numbers) {
    if (!specByNumber.has(n)) problems.push(`milestone "${milestone.name}" references unknown #${n}`)
    if (assigned.has(n)) problems.push(`#${n} is in both "${assigned.get(n)}" and "${milestone.name}"`)
    assigned.set(n, milestone.name)
  }
}
for (let n = 1; n <= 150; n += 1) if (!assigned.has(n)) problems.push(`#${n} has no milestone`)

for (const [blocker, blocked] of DEPENDENCIES) {
  if (!specByNumber.has(blocker) || !specByNumber.has(blocked)) problems.push(`bad dependency ${blocker}->${blocked}`)
  const from = MILESTONES.find((m) => m.numbers.includes(blocker))
  const to = MILESTONES.find((m) => m.numbers.includes(blocked))
  if (from && to && from.order > to.order) {
    problems.push(`#${blocker} (${from.name}) blocks #${blocked} (${to.name}) but ships later`)
  }
}

if (problems.length) {
  console.error(`Sequence validation failed (${problems.length}):`)
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}

console.log(
  `Validated ${assigned.size} issues across ${MILESTONES.length} milestones and ${DEPENDENCIES.length} dependencies.`,
)

if (DRY_RUN) {
  for (const m of MILESTONES) console.log(`  ${m.order}. ${m.name}: ${m.numbers.length} issues`)
  process.exit(0)
}

// --- load issues ----------------------------------------------------------
const issues = []
let after = null
for (;;) {
  const page = await gql(
    `query($projectId: String!, $after: String) {
      project(id: $projectId) {
        issues(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title
            projectMilestone { id name }
            relations { nodes { id type relatedIssue { id } } }
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

const byTitle = new Map(issues.map((i) => [i.title, i]))
const missing = specs.filter((s) => !byTitle.has(s.title))
if (missing.length) {
  console.error(`Missing ${missing.length} issue(s) in Linear, run create-issues.mjs first.`)
  process.exit(1)
}

const issueByNumber = new Map(
  specs.map((s) => [s.n, byTitle.get(s.title)]),
)

// --- milestones -----------------------------------------------------------
const existing = await gql(
  `query($projectId: String!) { project(id: $projectId) { projectMilestones(first: 50) { nodes { id name sortOrder description } } } }`,
  { projectId: PROJECT_ID },
)
const milestoneByName = new Map(existing.project.projectMilestones.nodes.map((m) => [m.name, m]))

for (const milestone of MILESTONES) {
  const current = milestoneByName.get(milestone.name)
  if (current) {
    if (current.sortOrder !== milestone.order || current.description !== milestone.description) {
      await gql(
        `mutation($id: String!, $input: ProjectMilestoneUpdateInput!) {
          projectMilestoneUpdate(id: $id, input: $input) { success }
        }`,
        { id: current.id, input: { sortOrder: milestone.order, description: milestone.description } },
      )
      console.log(`Updated milestone "${milestone.name}"`)
    }
    continue
  }
  const created = await gql(
    `mutation($input: ProjectMilestoneCreateInput!) {
      projectMilestoneCreate(input: $input) { success projectMilestone { id name } }
    }`,
    {
      input: {
        projectId: PROJECT_ID,
        name: milestone.name,
        description: milestone.description,
        sortOrder: milestone.order,
      },
    },
  )
  const node = created.projectMilestoneCreate.projectMilestone
  milestoneByName.set(milestone.name, node)
  console.log(`Created milestone "${milestone.name}"`)
}

// --- assign issues to milestones -----------------------------------------
let moved = 0
let already = 0
for (const milestone of MILESTONES) {
  for (const n of milestone.numbers) {
    const issue = issueByNumber.get(n)
    if (issue.projectMilestone?.id === milestoneByName.get(milestone.name).id) {
      already += 1
      continue
    }
    await gql(
      `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
      { id: issue.id, input: { projectMilestoneId: milestoneByName.get(milestone.name).id } },
    )
    moved += 1
    if (moved % 25 === 0) console.log(`  assigned ${moved} issues...`)
  }
}
console.log(`Milestone assignment: ${moved} updated, ${already} already correct.`)

// --- relations ------------------------------------------------------------
const existingRelations = new Set()
for (const issue of issues) {
  for (const rel of issue.relations?.nodes ?? []) {
    if (rel.type === "blocks") existingRelations.add(`${issue.id}:${rel.relatedIssue.id}`)
  }
}

let related = 0
let relatedSkipped = 0
let relatedFailed = 0
for (const [blocker, blocked] of DEPENDENCIES) {
  const from = issueByNumber.get(blocker)
  const to = issueByNumber.get(blocked)
  if (existingRelations.has(`${from.id}:${to.id}`)) {
    relatedSkipped += 1
    continue
  }
  try {
    await gql(
      `mutation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) { success }
      }`,
      { input: { issueId: from.id, relatedIssueId: to.id, type: "blocks" } },
    )
    existingRelations.add(`${from.id}:${to.id}`)
    related += 1
  } catch (error) {
    relatedFailed += 1
    console.error(`! relation #${blocker} -> #${blocked}: ${error.message}`)
  }
}
console.log(`Dependencies: ${related} created, ${relatedSkipped} already present, ${relatedFailed} failed.`)

if (relatedFailed) process.exit(1)
console.log("\nSequencing complete.")
