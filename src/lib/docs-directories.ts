/**
 * The docs directory tree, in display order. Every entry renders as a
 * collapsible directory in the sidebar — directories without guides yet show
 * an empty state until their pages are written. A guide joins a directory by
 * matching its frontmatter `section` to the directory path (titles joined by
 * " / "), or to a directory title when that title is unique in the tree.
 *
 * Kept in its own module (no manifest import) so client bundles and tests can
 * use the ordering without pulling in the generated docs manifest.
 */

export type DocsDirectoryNode = {
  id: string
  title: string
  children: DocsDirectoryNode[]
}

/** `[title]` is a leaf directory; `[title, [...]]` nests directories inside it. */
type DirSpec = readonly [title: string, children?: readonly DirSpec[]]

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function build(specs: readonly DirSpec[], parentId = ""): DocsDirectoryNode[] {
  return specs.map(([title, children]) => {
    const id = parentId ? `${parentId}/${slugify(title)}` : slugify(title)
    return { id, title, children: children ? build(children, id) : [] }
  })
}

const TREE: readonly DirSpec[] = [
  [
    "Getting started",
    [
      [
        "Accounts & sign-in",
        [
          ["Email sign-up"],
          ["Single sign-on (SSO)"],
          ["Passkeys & passwords"],
          ["Two-factor authentication"],
          ["Session management"],
          ["Workspace invitations"],
        ],
      ],
      [
        "Your first project",
        [
          ["Creating a project"],
          ["Project templates"],
          ["The project dashboard"],
          ["Deleting a project"],
        ],
      ],
      [
        "Interface tour",
        [
          ["Global navigation"],
          ["The command menu"],
          ["Notifications"],
          ["Keyboard shortcuts"],
        ],
      ],
      ["Onboarding checklist"],
      ["Migrating from another tool"],
    ],
  ],
  [
    "Core concepts",
    [
      ["Projects & workspaces"],
      ["Files & versions"],
      ["The lab"],
      ["Sources & citations"],
      ["Automations"],
      ["The agent"],
      ["Search"],
      ["Collaboration"],
      ["Roles & permissions"],
      ["Activity & audit log"],
      ["Storage & quotas"],
      ["Offline mode"],
    ],
  ],
  [
    "Projects",
    [
      [
        "Creating & managing",
        [
          ["Create a project"],
          ["Duplicate a project"],
          ["Archive a project"],
          ["Delete a project"],
          ["Project settings"],
        ],
      ],
      [
        "Organization",
        [
          ["Folders & tags"],
          ["Pinning & favorites"],
          ["Project search"],
          ["Bulk actions"],
        ],
      ],
      [
        "Lifecycle",
        [
          ["Archiving"],
          ["Restoration"],
          ["Retention policies"],
        ],
      ],
    ],
  ],
  [
    "Files & data",
    [
      [
        "File types",
        [
          ["Notebooks"],
          ["Spreadsheets"],
          ["Documents"],
          ["Datasets (CSV / Parquet / Excel)"],
          ["Scripts (R & Python)"],
          ["Images & figures"],
          ["PDFs & papers"],
          ["Presentations"],
          ["Archives"],
        ],
      ],
      [
        "Uploading & importing",
        [
          ["Drag & drop upload"],
          ["Bulk upload"],
          ["Import from URL"],
          ["Import from Zotero"],
          ["Import from Excel"],
          ["Versioned uploads"],
        ],
      ],
      [
        "Previews",
        [
          ["Notebook preview"],
          ["Spreadsheet preview"],
          ["Image preview"],
          ["PDF preview"],
          ["Diff view"],
        ],
      ],
      [
        "Versions & history",
        [
          ["File versioning"],
          ["Restore a version"],
          ["Compare versions"],
          ["Retention policy"],
        ],
      ],
      [
        "Organization",
        [
          ["Folders"],
          ["Tags"],
          ["Rename & move"],
          ["Starred files"],
          ["Recently edited"],
        ],
      ],
      [
        "Exporting",
        [
          ["Export to PDF"],
          ["Export a dataset"],
          ["Export a notebook"],
          ["Shareable links"],
        ],
      ],
    ],
  ],
  [
    "Lab & compute",
    [
      [
        "RStudio",
        [
          [
            "SSH",
            [
              ["Key-based authentication"],
              ["SSH agent forwarding"],
              ["Encryption & ciphers"],
              ["Known hosts"],
              ["Jump hosts & bastions"],
              ["SSH config file"],
              ["Troubleshooting SSH"],
            ],
          ],
          [
            "Encryption",
            [
              ["Disk encryption"],
              ["Encryption in transit"],
              ["Key management"],
              ["Encrypted backups"],
            ],
          ],
          [
            "Packages",
            [
              ["Installing packages"],
              ["CRAN & Bioconductor"],
              ["renv & packrat"],
              ["Package snapshots"],
              ["Private packages"],
            ],
          ],
          [
            "Sessions",
            [
              ["Starting a session"],
              ["Idle timeout"],
              ["Resource limits"],
              ["GPU sessions"],
            ],
          ],
          [
            "The IDE",
            [
              ["Editor tour"],
              ["Running code"],
              ["Environment pane"],
              ["Plots & viewer"],
              ["Git integration"],
            ],
          ],
        ],
      ],
      [
        "Python & Jupyter",
        [
          ["Kernels"],
          ["Conda environments"],
          ["pip & uv"],
          ["JupyterLab"],
          ["VS Code remote"],
        ],
      ],
      [
        "Compute",
        [
          ["CPU & memory sizing"],
          ["GPU acceleration"],
          ["Spot & preemptible instances"],
          ["Queueing jobs"],
          ["Parallel jobs"],
        ],
      ],
      [
        "Storage",
        [
          ["Workspace disk"],
          ["Scratch space"],
          ["Persistent volumes"],
          ["Quotas & limits"],
        ],
      ],
      [
        "Networking",
        [
          ["Egress rules"],
          ["Package mirrors"],
          ["Private registries"],
          ["Air-gapped mode"],
        ],
      ],
      [
        "Monitoring",
        [
          ["Session logs"],
          ["Resource usage graphs"],
          ["Cost tracking"],
        ],
      ],
    ],
  ],
  [
    "Search & sources",
    [
      [
        "Local search",
        [
          ["How indexing works"],
          ["Query syntax"],
          ["Filters & facets"],
          ["Saved searches"],
          ["Search within files"],
        ],
      ],
      [
        "Web search",
        [
          ["SearXNG"],
          ["Provider configuration"],
          ["Rate limits"],
          ["Saving results"],
        ],
      ],
      [
        "Sources",
        [
          ["Adding a source"],
          ["Source types"],
          ["Zotero sync"],
          ["DOI lookup"],
          ["Citations"],
        ],
      ],
      [
        "Indexing internals",
        [
          ["Index architecture"],
          ["Rebuilding the index"],
          ["Index storage"],
        ],
      ],
    ],
  ],
  [
    "Agent",
    [
      ["What the agent can do"],
      ["Agent permissions"],
      ["Approvals & confirmations"],
      [
        "Tasks",
        [
          ["Writing a task"],
          ["Multi-step plans"],
          ["Reviewing diffs"],
          ["Reverting changes"],
        ],
      ],
      [
        "Context",
        [
          ["Project context"],
          ["Agent memory"],
          ["Referencing files"],
        ],
      ],
      [
        "Safety",
        [
          ["Sandboxing"],
          ["Confirmation prompts"],
          ["Audit trail"],
        ],
      ],
    ],
  ],
  [
    "Automations",
    [
      [
        "Creating automations",
        [
          ["Plain-language automations"],
          ["Cron schedules"],
          ["Visual builder"],
          ["Templates"],
        ],
      ],
      [
        "Triggers",
        [
          ["Schedule triggers"],
          ["File-change triggers"],
          ["New-source triggers"],
          ["Agent-event triggers"],
          ["Webhooks"],
        ],
      ],
      [
        "Actions",
        [
          ["Run a script"],
          ["Update files"],
          ["Send a notification"],
          ["Create a task"],
          ["Call an API"],
        ],
      ],
      [
        "Management",
        [
          ["Run history"],
          ["Logs"],
          ["Enable & disable"],
          ["Failure alerts"],
        ],
      ],
    ],
  ],
  [
    "Collaboration",
    [
      [
        "Real-time editing",
        [
          ["CRDT sync"],
          ["Cursors & presence"],
          ["Comments"],
          ["Suggestions"],
        ],
      ],
      [
        "Chat",
        [
          ["Channels"],
          ["Threads"],
          ["Mentions"],
          ["Notifications"],
          ["Anonymous posting"],
        ],
      ],
      [
        "Sharing",
        [
          ["Inviting members"],
          ["Roles & permissions"],
          ["Guest access"],
          ["External collaborators"],
        ],
      ],
    ],
  ],
  [
    "Developers & API",
    [
      [
        "Getting started",
        [
          ["API keys"],
          ["Your first API call"],
          ["Rate limits"],
          ["API versioning"],
        ],
      ],
      [
        "Authentication",
        [
          ["OAuth 2.0 flows"],
          ["API keys"],
          ["Service accounts"],
          ["Token refresh"],
          ["Scopes"],
        ],
      ],
      [
        "Endpoints",
        [
          ["Projects"],
          ["Files"],
          ["Lab sessions"],
          ["Search"],
          ["Automations"],
          ["Agent runs"],
          ["Webhooks"],
          ["Users & workspaces"],
        ],
      ],
      [
        "SDKs",
        [
          ["JavaScript SDK"],
          ["Python SDK"],
          ["R SDK"],
          ["CLI"],
        ],
      ],
      [
        "Webhooks",
        [
          ["Creating webhooks"],
          ["Payload format"],
          ["Retries"],
          ["Verifying signatures"],
        ],
      ],
      [
        "Errors & versioning",
        [
          ["Error codes"],
          ["Rate-limit headers"],
          ["API changelog"],
        ],
      ],
      [
        "Playground",
        [
          ["Using the playground"],
          ["Saving requests"],
        ],
      ],
      [
        "App review",
        [
          ["Submitting an app"],
          ["Review guidelines"],
          ["Approval process"],
        ],
      ],
    ],
  ],
  [
    "Integrations",
    [
      [
        "Reference managers",
        [
          ["Zotero"],
          ["Mendeley"],
          ["EndNote"],
          ["ORCID"],
        ],
      ],
      [
        "Storage",
        [
          ["Google Drive"],
          ["GitHub"],
        ],
      ],
      [
        "Communication",
        [
          ["Slack"],
          ["Email"],
          ["Calendar"],
        ],
      ],
      [
        "Developer tools",
        [
          ["GitHub"],
          ["GitLab"],
        ],
      ],
    ],
  ],
  [
    "Security & privacy",
    [
      [
        "Encryption",
        [
          ["Encryption at rest"],
          ["Encryption in transit"],
          ["Key management"],
          ["Encrypted backups"],
        ],
      ],
      [
        "Privacy",
        [
          ["Data residency"],
          ["Telemetry opt-out"],
          ["Anonymous mode"],
          ["GDPR & data rights"],
        ],
      ],
      [
        "Access control",
        [
          ["SSO / SAML"],
          ["SCIM provisioning"],
          ["IP allowlists"],
          ["Session policies"],
        ],
      ],
      [
        "Auditing",
        [
          ["Audit logs"],
          ["Log retention"],
          ["Exporting logs"],
        ],
      ],
      [
        "Secrets",
        [
          ["Secret storage"],
          ["Environment secrets"],
          ["Secret rotation"],
        ],
      ],
    ],
  ],
  [
    "Deployment & infrastructure",
    [
      [
        "Self-hosting",
        [
          ["Docker Compose"],
          ["Kubernetes"],
          ["System requirements"],
          ["Upgrades"],
        ],
      ],
      [
        "Backups",
        [
          ["Automated backups"],
          ["Restore procedure"],
          ["Backup retention"],
          ["Full data export"],
        ],
      ],
      [
        "Monitoring",
        [
          ["Health endpoints"],
          ["Metrics"],
          ["Alerting"],
          ["Status page"],
        ],
      ],
      [
        "Networking",
        [
          ["Reverse proxy"],
          ["TLS termination"],
          ["Custom domains"],
        ],
      ],
      [
        "Scaling",
        [
          ["Horizontal scaling"],
          ["Database tuning"],
          ["Object storage"],
        ],
      ],
    ],
  ],
  [
    "Account & billing",
    [
      [
        "Plans",
        [
          ["Free tier"],
          ["Pro"],
          ["Team"],
          ["Enterprise"],
          ["Quotas per plan"],
        ],
      ],
      [
        "Billing",
        [
          ["Payment methods"],
          ["Invoices"],
          ["Usage-based billing"],
          ["Canceling"],
        ],
      ],
      [
        "Seats & members",
        [
          ["Inviting seats"],
          ["Seat management"],
          ["Role assignment"],
        ],
      ],
      [
        "Data rights",
        [
          ["Export account data"],
          ["Delete account"],
          ["Workspace deletion"],
        ],
      ],
    ],
  ],
  [
    "Administration",
    [
      [
        "Workspace settings",
        [
          ["General settings"],
          ["Branding"],
          ["Default roles"],
        ],
      ],
      [
        "Members & roles",
        [
          ["Role definitions"],
          ["Permission matrix"],
          ["Bulk import"],
        ],
      ],
      [
        "Policies",
        [
          ["Retention policies"],
          ["Allowed file types"],
          ["Egress policy"],
          ["Mandatory 2FA"],
        ],
      ],
      [
        "Compliance",
        [
          ["SOC 2"],
          ["Data processing agreement"],
          ["Subprocessors"],
        ],
      ],
    ],
  ],
  [
    "Tutorials",
    [
      ["Your first literature review"],
      ["Reproducible analysis"],
      ["Onboarding a team"],
      ["Building a dashboard"],
      ["A literature search pipeline"],
      ["Automating weekly reports"],
      ["Collaborative grant writing"],
    ],
  ],
  [
    "Troubleshooting",
    [
      ["Sign-in issues"],
      ["Upload failures"],
      ["Lab session errors"],
      ["Slow search"],
      ["Sync conflicts"],
      ["Notification issues"],
      ["Common error codes"],
    ],
  ],
  [
    "FAQ",
    [
      ["Pricing questions"],
      ["Data ownership"],
      ["Mobile apps"],
      ["API access"],
      ["Support channels"],
      ["File limits"],
    ],
  ],
  [
    "Reference",
    [
      [
        "Keyboard shortcuts",
        [
          ["Global shortcuts"],
          ["Editor shortcuts"],
          ["Notebook shortcuts"],
        ],
      ],
      ["CLI commands"],
      ["Configuration file"],
      ["Environment variables"],
      ["Glossary"],
      ["Error codes"],
      ["HTTP status codes"],
      ["API objects"],
      ["Webhook events"],
    ],
  ],
  [
    "Release notes",
    [
      ["2026 releases"],
      ["Beta changelog"],
      ["Deprecations"],
      ["Product roadmap"],
    ],
  ],
]

export const DOCS_DIRECTORIES: DocsDirectoryNode[] = build(TREE)

export type DocsDirectory = DocsDirectoryNode

export type FlatDocsDirectory = {
  node: DocsDirectoryNode
  /** Ancestor titles joined by " / " — what a guide's `section` can match. */
  path: string
  depth: number
  /** Depth-first position: the directory's place in reading order. */
  index: number
}

/** Every directory in the tree, depth-first. */
export const FLAT_DOCS_DIRECTORIES: FlatDocsDirectory[] = (() => {
  const flat: FlatDocsDirectory[] = []
  const walk = (nodes: DocsDirectoryNode[], parentPath: string, depth: number) => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath} / ${node.title}` : node.title
      flat.push({ node, path, depth, index: flat.length })
      walk(node.children, path, depth + 1)
    }
  }
  walk(DOCS_DIRECTORIES, "", 0)
  return flat
})()

const DIRECTORY_BY_PATH = new Map(FLAT_DOCS_DIRECTORIES.map((dir) => [dir.path, dir]))

// Titles are not unique across the tree ("Encryption", "Automations", ...), so
// a bare title resolves to the shallowest match — top-level directories win —
// and deeper directories are addressed by their full "A / B" path instead.
const DIRECTORY_BY_TITLE = new Map<string, FlatDocsDirectory>()
for (const dir of FLAT_DOCS_DIRECTORIES) {
  const existing = DIRECTORY_BY_TITLE.get(dir.node.title)
  if (!existing || dir.depth < existing.depth) {
    DIRECTORY_BY_TITLE.set(dir.node.title, dir)
  }
}

/**
 * Resolve a guide's frontmatter `section` to a directory: an exact "A / B"
 * path match first, then a shallowest-title match. Returns undefined when the
 * section names no directory.
 */
export function resolveDocsDirectory(section: string): FlatDocsDirectory | undefined {
  return DIRECTORY_BY_PATH.get(section) ?? DIRECTORY_BY_TITLE.get(section)
}

/** Depth-first rank of the directory a section resolves to, or the tree size. */
export function docsDirectoryIndex(section: string): number {
  return resolveDocsDirectory(section)?.index ?? FLAT_DOCS_DIRECTORIES.length
}
