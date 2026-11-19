import { subprocessors } from "./subprocessors"
import type { LegalDocument } from "./types"

/**
 * Privacy Policy copy. Edit this file to change the published policy; the
 * /privacy route and its table of contents are generated from it.
 */
export const privacyDocument: LegalDocument = {
  eyebrow: "Legal",
  title: "Privacy Policy",
  lede: "What we collect, why we collect it, where it lives, and how to get it back or have it deleted.",
  version: "1.0",
  effectiveDate: "2026-11-19",
  summary: {
    title: "The short version",
    bullets: [
      "Your projects belong to you. We store and process them to run the workspace, and we do not sell your data or use it for advertising.",
      "We collect the account details you give us, the content you put into a project, and the usage and diagnostic data needed to keep the service working and secure.",
      "Search runs through a SearXNG instance we host alongside Spindle, not through an advertising search engine.",
      "Error monitoring and session replay are masked: text and media are hidden, and search, chat, invite, and sign-in fields are blocked.",
      [
        "You can ask for a copy of your data or for your account to be deleted by writing to ",
        { text: "privacy@spindle.example", href: "mailto:privacy@spindle.example" },
        ".",
      ],
    ],
  },
  sections: [
    {
      id: "what-we-collect",
      title: "What we collect",
      paragraphs: [
        "We collect four kinds of information: what you give us, what you put into a project, what the service records while it runs, and what you send to support.",
      ],
      subsections: [
        {
          title: "Account details",
          paragraphs: [
            "Your name, work email address, and password, which our sign-in service stores as a one-way hash. We also keep the name and members of the workspaces you create.",
            "Preferences such as notification choices and the workspace you last opened.",
          ],
        },
        {
          title: "Project content",
          paragraphs: [],
          bullets: [
            "Files and notebooks: anything you upload or create, including datasets, documents, images, code, notebook cells, and their output.",
            "Research material: notes, shared documents, saved search results and citations, and the comments and chat messages attached to a project.",
            "Automations and agent runs: the schedules you define, the prompts you send, the actions the agent proposes, and the record of what ran.",
            "Lab sessions: the environment a session starts in and the files it writes. Session state is discarded when the session stops.",
          ],
        },
        {
          title: "Usage and diagnostics",
          paragraphs: [],
          bullets: [
            "Usage: storage used, agent requests, lab sessions started, automation runs, and the features you open, recorded against your workspace.",
            "Diagnostics: crash reports, error events, performance traces, and session replays captured by Sentry. Replays mask all text and media, and the search, chat, invite, and sign-in fields are masked or blocked entirely.",
            "Technical data: IP address, browser and device type, and request times, kept in server and security logs.",
          ],
        },
        {
          title: "Support",
          paragraphs: [
            "When you write to us, we keep the message, your address, and any attachment you send so we can answer and follow up.",
          ],
        },
      ],
    },
    {
      id: "what-we-do-not-collect",
      title: "What we do not collect",
      paragraphs: [
        "We do not sell your data, we do not use it to build advertising profiles, and we do not mine your project content for advertising.",
      ],
      bullets: [
        "No advertising identifiers, tracking pixels, or cross-site browsing history.",
        "No uploads of your contact list or address book.",
        "No payment card details in this build of the product — the free plan does not ask for a card.",
      ],
      closingParagraphs: [
        "We do not alter your files, and we do not open a project unless you ask us to while supporting you.",
      ],
    },
    {
      id: "cookies-and-analytics",
      title: "Cookies and analytics",
      paragraphs: [
        "Spindle sets cookies and local-storage keys to keep you signed in, remember your preferences, and collect diagnostics. We keep the list short and do not add a cookie before it is documented.",
        [
          "Our ",
          { text: "Cookie Policy", href: "/cookies" },
          " lists every cookie and storage key we set, what it is for, its category, and how long it lasts. It also explains how to change your choice later.",
        ],
        "The Cookie Policy is the authoritative list: it covers the purpose, provider, and lifetime of each key, and it explains how to withdraw optional consent. Search is not analytics. Queries you type into Spindle search go to the SearXNG instance we host alongside Spindle, and results stay tied to the project you saved them in.",
      ],
    },
    {
      id: "how-we-use-data",
      title: "How we use your data",
      paragraphs: [
        "We use the information above to run the workspace, keep it secure, support you, and meet our legal obligations. We do not use your project content for advertising, and we do not make automated decisions that produce legal or similarly significant effects about you.",
      ],
      bullets: [
        "Run the workspace: store your files, open lab sessions, run automations and agent requests, and sync shared documents and team chat.",
        "Authenticate and authorize: sign you in, keep sessions secure, and enforce workspace roles and membership.",
        "Keep the service safe: detect abuse, stop hostile traffic at the edge, investigate security incidents, and keep audit and access logs.",
        "Support you: answer questions, reproduce problems, and follow up on a report you send us.",
        "Improve the product: understand which features are used and where they fail, using aggregated usage and diagnostics.",
        "Meet our obligations: comply with tax, accounting, and other legal requirements, and respond to valid legal requests.",
        "Contact you: send service messages about your account, security, or changes to this policy. Marketing email only goes to people who asked for it.",
      ],
    },
    {
      id: "lawful-bases",
      title: "Lawful bases",
      paragraphs: [
        "If you are in the European Economic Area or the United Kingdom, we process personal data under the following lawful bases:",
      ],
      bullets: [
        "Contract: creating an account, storing your projects, and providing the features you ask for.",
        "Legitimate interests: securing the service, preventing abuse, diagnosing failures, and improving the product, balanced against your rights.",
        "Consent: optional analytics and session replay, and marketing email where we rely on consent. You can withdraw it at any time.",
        "Legal obligation: keeping records we are required to keep and responding to lawful requests.",
      ],
    },
    {
      id: "subprocessors",
      title: "Subprocessors",
      paragraphs: [
        "We use a small number of providers to run Spindle. They may process personal data only on our instructions and for the purposes listed here. The servers that run Spindle sit behind Cloudflare, project objects are stored in private Backblaze B2 buckets, transactional email is delivered through Resend, model inference runs on the LLM provider below, and the application runs on our hosting provider's infrastructure.",
      ],
      table: {
        caption: "Subprocessors that process personal data for Spindle",
        columns: ["Vendor", "Purpose", "Data", "Location", "Transfer"],
        rows: subprocessors.map((provider) => [
          provider.vendor,
          provider.purpose,
          provider.data,
          provider.location,
          provider.transfer,
        ]),
      },
      closingParagraphs: [
        [
          "The same list, with the processing terms that apply to each provider, appears in our ",
          { text: "Data Processing Addendum", href: "/dpa" },
          ". We add a provider to this table before it can handle your data, and we do not list a vendor we do not use.",
        ],
      ],
    },
    {
      id: "where-data-lives",
      title: "Where your data lives",
      paragraphs: [
        "Project files and their metadata are stored as private objects in Backblaze B2, in a region in the United States or the European Union. Buckets are not public, and objects are reached through scoped credentials rather than public URLs.",
        "Cloudflare sits in front of Spindle worldwide, so requests pass through its edge before they reach our application servers. Sentry receives diagnostics and masked replays in the United States. Resend delivers transactional email from the United States, and the LLM provider processes prompts and the project context included in a request. Search runs on a SearXNG instance we host alongside Spindle.",
      ],
    },
    {
      id: "international-transfers",
      title: "International transfers",
      paragraphs: [
        "Spindle is operated from the European Union and the United States, and some providers process data outside the country where you live. Where data leaves the EEA or the United Kingdom, we rely on the Standard Contractual Clauses, together with the UK Addendum where it applies, and on each provider's security commitments.",
        [
          "We assess transfers before they begin and review them when a provider or region changes. You can ask for a copy of the safeguards we use by writing to ",
          { text: "privacy@spindle.example", href: "mailto:privacy@spindle.example" },
          ".",
        ],
      ],
    },
    {
      id: "retention",
      title: "How long we keep data",
      paragraphs: ["We keep data only as long as we need it for the purpose it was collected for."],
      bullets: [
        "Account and workspace content: for as long as the workspace exists.",
        "Saved search results and notes: for as long as they stay in the project. Unsaved queries are processed to return results and are not kept.",
        "Lab sessions: session state ends when the session stops. Files the session wrote stay in the project.",
        "Automation and agent run records: for as long as they stay with the project they belong to.",
        "Error events and session replays: 30 days in Sentry.",
        "Server and security logs: 30 days, then deleted or aggregated.",
        "Support correspondence: 24 months after the last reply.",
        "Deleted workspaces and accounts: removed from active storage within 7 days of a verified request, and from encrypted backups within 30 days.",
      ],
      closingParagraphs: [
        "When a retention period ends, we delete the data or turn it into aggregated statistics that no longer identify you.",
      ],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: [
        "Traffic to Spindle is encrypted in transit with TLS, and the origin is reached through outbound-only Cloudflare Tunnels rather than an open inbound port. Project objects are encrypted at rest in private Backblaze B2 buckets, and access is scoped to the service that needs it.",
      ],
      bullets: [
        "Workspace membership and roles are checked on every request, not just in the UI.",
        "Session replays mask all text and media, and search, chat, invite, and sign-in fields are blocked or masked.",
        "Access to production systems is limited to the people who need it and is logged.",
        "We review providers before adding them and keep the subprocessor list current.",
      ],
      closingParagraphs: [
        [
          "No service is perfectly secure. If you find a vulnerability, write to ",
          { text: "security@spindle.example", href: "mailto:security@spindle.example" },
          " and we will respond as quickly as we can.",
        ],
      ],
    },
    {
      id: "your-rights",
      title: "Your rights",
      paragraphs: [
        "Depending on where you live, you can ask to access, correct, export, restrict, or delete your personal data, and you can object to processing based on legitimate interests. You can also withdraw consent at any time without affecting processing that already happened.",
      ],
      subsections: [
        {
          title: "Access and correction",
          paragraphs: [
            [
              "Write to ",
              { text: "privacy@spindle.example", href: "mailto:privacy@spindle.example" },
              " to ask what we hold about you or to correct something that is wrong. We may ask you to verify that you control the account before we respond.",
            ],
          ],
        },
        {
          title: "Export",
          paragraphs: [
            "You can ask for a copy of your data. We will send an archive of your project files plus a JSON file of your account, workspace, and run metadata. Self-service export is not part of this build yet, so exports are handled by our team after we verify the request.",
          ],
        },
        {
          title: "Deletion",
          paragraphs: [
            "You can ask us to delete a workspace or your whole account. We remove it from active storage within 7 days of a verified request, and from encrypted backups within 30 days. Self-service deletion is not part of this build yet; write to privacy@spindle.example to start the request.",
          ],
        },
      ],
      closingParagraphs: [
        "We respond to rights requests within 30 days. If we cannot meet that, we will tell you why and when to expect an answer. If you are not satisfied, you can complain to your local data protection authority.",
      ],
    },
    {
      id: "children",
      title: "Children",
      paragraphs: [
        [
          "Spindle is a research tool for adults and institutions. It is not directed to children under 16, and we do not knowingly collect their personal data. If you believe a child has created an account, write to ",
          { text: "privacy@spindle.example", href: "mailto:privacy@spindle.example" },
          " and we will delete it.",
        ],
      ],
    },
    {
      id: "changes-to-this-policy",
      title: "Changes to this policy",
      paragraphs: [
        "We version this policy and show the version and effective date at the top of the page. If a change materially affects what we collect or how we use it, we will tell you by email or in the workspace before it takes effect. Earlier versions stay available on this page.",
      ],
    },
  ],
  previousVersions: {
    intro: [
      "This is the first published version of the Privacy Policy. When we publish a revision, the earlier version will stay listed here and remain available for reference.",
    ],
    entries: [
      {
        version: "1.0",
        effectiveDate: "2026-11-19",
        note: "First published version.",
      },
    ],
  },
  contact: {
    intro:
      "Spindle Labs is the controller for the data described in this policy. Questions, data requests, and complaints can go to the addresses below. We read every message and reply within 30 days.",
    emails: [
      { label: "Privacy", address: "privacy@spindle.example" },
      { label: "Security", address: "security@spindle.example" },
    ],
  },
}
