import type { LegalDocument } from "./types"

/**
 * Acceptable Use Policy copy. Edit this file to change the published policy;
 * the /acceptable-use route and its table of contents are generated from it.
 * Enforcement wording mirrors what support and engineering can do today:
 * warn, throttle, pause automations, suspend, terminate, and hear an appeal.
 */
export const acceptableUseDocument: LegalDocument = {
  eyebrow: "Legal",
  title: "Acceptable Use Policy",
  lede: "What you may and may not do with a Spindle account, its storage and lab compute, local search, automations, and the agent. This policy is part of the Terms of Service.",
  version: "1.0",
  effectiveDate: "2026-11-19",
  summary: {
    title: "The short version",
    bullets: [
      "Use Spindle for research work you have the right to do. Do not break the law or harm other people.",
      "Do not attack the service, escape a lab sandbox, or work around storage and agent allowances.",
      "Do not mine crypto, send spam, scrape search results for resale, or run workloads unrelated to your project on shared infrastructure.",
      "We may warn you, throttle a workspace, pause automations, or suspend an account that puts the service or another person at risk.",
      [
        "Report abuse to ",
        {
          text: "abuse@spindle.example",
          href: "mailto:abuse@spindle.example?subject=Abuse%20report",
        },
        " and security issues to ",
        {
          text: "security@spindle.example",
          href: "mailto:security@spindle.example?subject=Security%20report",
        },
        ".",
      ],
    ],
  },
  sections: [
    {
      id: "scope",
      title: "What this policy covers",
      paragraphs: [
        "This policy applies to everyone who uses Spindle: workspace owners, managers, editors, viewers, invited guests, and anyone using an anonymous chat session. It covers the website, the workspace, project files and storage, the lab and its compute, local search, automations, the agent, team chat, and the APIs behind them.",
        [
          "It forms part of the ",
          { text: "Terms of Service", href: "/terms" },
          ". If this policy and the terms disagree, the terms control. Terms we use here — workspace, customer content, and the free-plan limits — have the same meaning as in the terms.",
        ],
      ],
    },
    {
      id: "prohibited-content",
      title: "Prohibited content",
      paragraphs: ["You may not upload, store, generate, or share content that:"],
      bullets: [
        "Breaks the law where you or we operate, including content that infringes copyright, trade secrets, or other intellectual property.",
        "Sexualises minors, or depicts non-consensual sexual content or intimate images.",
        "Incites violence, threatens a person or group, or harasses, bullies, or stalks someone.",
        "Is malware, ransomware, or another payload designed to damage a system or steal credentials.",
        "Contains other people's personal or confidential data that you do not have the right to hold, including research participant data collected without the consent your institution requires.",
        "Impersonates a person or organisation in a way meant to deceive, including phishing pages and forged sender addresses.",
      ],
      closingParagraphs: [
        "Research sometimes involves sensitive material. If you are unsure whether a dataset may be uploaded, ask your institution's ethics or data-protection office before you upload it, and contact us if you need help.",
      ],
    },
    {
      id: "prohibited-activity",
      title: "Prohibited activity",
      paragraphs: ["You may not use Spindle to do any of the following:"],
      bullets: [
        "Access an account, workspace, project, or system you are not authorised to access, or help someone else do so. Credential stuffing, password spraying, and stolen session cookies are all prohibited.",
        "Probe, scan, or test the service for vulnerabilities without written permission. Good-faith security research is welcome under the disclosure policy on the trust centre; automated scanning that degrades the service is not.",
        "Bypass, disable, or work around authentication, workspace roles, sandbox limits, egress rules, quotas, rate limits, or the agent's approval gates.",
        "Upload or execute malware, run a denial-of-service attack, or use Spindle as a relay for one.",
        "Harass, threaten, dox, or discriminate against another person, including in shared documents, chat, and comments.",
        "Impersonate Spindle staff, another workspace, or another person, or misrepresent a workspace's affiliation.",
        "Use Spindle to build or operate a competing hosted service from copied interface, documentation, or infrastructure assets.",
      ],
    },
    {
      id: "search-and-scraping",
      title: "Search, scraping, and resale",
      paragraphs: [
        "Spindle's search runs on shared, self-hosted infrastructure. Every automated query has a real cost, so the limits exist to keep search fast for everyone.",
      ],
      bullets: [
        "Do not automate search outside the supported automations and API, and do not run scripts whose purpose is to harvest results in bulk.",
        "Do not scrape, mirror, or resell search results, indexes, rankings, or snapshots as a dataset or as part of another product.",
        "Do not use search to build a competing index, to train a model on results you are not licensed to use, or to bypass a site's own terms and robots directives.",
        "Do not use search for high-volume lead generation, contact harvesting, or surveillance of people or organisations.",
        "Respect the rate limits on your plan. Automated retries that ignore backoff are treated as abuse.",
      ],
      closingParagraphs: [
        "Citing or quoting a result in your own research is fine. Republishing the results themselves at scale is not.",
      ],
    },
    {
      id: "shared-infrastructure",
      title: "Shared infrastructure and fairness",
      paragraphs: [
        "Lab compute, storage, and the agent run on shared capacity. A workspace that consumes far more than its plan allows, or that interferes with other workspaces, may be throttled even when no single rule above is broken.",
      ],
      bullets: [
        "Keep workloads related to the project they run in. Do not use the lab as a general-purpose compute host for unrelated clients or side businesses.",
        "Do not mine cryptocurrency, run distributable cracking or password-recovery jobs, or run workloads designed mainly to consume CPU, GPU, memory, or bandwidth.",
        "Do not use the lab to distribute unlicensed software, proxy third-party traffic, or host a public service.",
        "Stay within the storage and agent allowances listed on the pricing page. The free plan includes 5 GB of storage and 20 agent requests per day per account, plus 50 one-time requests from an eligible referral.",
        "Do not create multiple accounts or workspaces to obtain extra allowances, storage, or referral credits.",
        "Do not attempt to escape a lab container, reach the host filesystem, or connect to services the sandbox does not allow.",
      ],
      closingParagraphs: [
        "If a legitimate research job needs more than your plan provides, contact us before you run it. We would rather raise a limit than clean up after a runaway job.",
      ],
    },
    {
      id: "automations-and-agent",
      title: "Automations and the agent",
      paragraphs: [
        "Automations run on a schedule whether or not you are watching, and the agent can act across a project without prompting between steps. Both run under this policy.",
      ],
      bullets: [
        "You are responsible for every automation you deploy and every agent run you start, including jobs that keep running after you leave the workspace. Pause a job before you lose access if you are handing the project over.",
        "Automations may not be used for outbound spam, unsolicited bulk email or messages, credential stuffing, scraping beyond the limits above, or probing other systems.",
        "Do not use an automation or an agent run to circumvent an approval gate, a storage or agent allowance, a sandbox restriction, or a suspension.",
        "Do not point an automation at a system you do not own or have written permission to test.",
        "An agent run is attributed to the person who started it, and its diff and log stay in the project. Sharing a workspace does not give a member permission to run tasks that break this policy.",
      ],
    },
    {
      id: "enforcement",
      title: "Enforcement",
      paragraphs: [
        "When we see a problem, our first response is usually to tell you about it and ask you to fix it. What happens next depends on the risk and on whether the conduct continues.",
      ],
      subsections: [
        {
          title: "What we may do",
          paragraphs: [
            "We apply the least disruptive step that addresses the problem. We may act immediately, without notice, where a workspace threatens the security or availability of Spindle or puts another person at risk.",
          ],
          bullets: [
            "Warn: we contact the workspace owner or the account holder, explain the problem, and set a reasonable time to fix it.",
            "Throttle: we slow down search, automations, lab compute, or agent requests, or pause scheduled jobs, to protect shared capacity while the issue is resolved.",
            "Limit features: we restrict a specific capability, such as outbound automation, large uploads, or further agent runs, without suspending the whole workspace.",
            "Suspend: we pause access to the workspace or account while we investigate, usually with notice, and restore it if the issue is resolved.",
            "Terminate: we close the account or workspace for serious or repeated breaches, illegal conduct, or a risk we cannot contain any other way.",
          ],
        },
        {
          title: "How the decision is made",
          paragraphs: [
            "We look at what happened, how much data or capacity was involved, whether anyone was harmed, whether the conduct was deliberate, and whether it has happened before. A single accidental overrun is handled differently from a script that keeps retrying through a block.",
            "We check what the account's owner could reasonably have known. An owner is responsible for their workspace, but we try not to punish a whole team for one member's mistake when a narrower step will do.",
          ],
        },
      ],
      closingParagraphs: [
        "Suspension or termination does not cancel amounts already owed, and it does not remove obligations that survive under the Terms of Service. Where the law allows, we tell you the reason and what would need to change.",
      ],
    },
    {
      id: "reporting-abuse",
      title: "Reporting abuse",
      paragraphs: [
        [
          "Report suspected abuse — spam, scraping, malware, harassment, a compromised account, or a workspace that is interfering with yours — to ",
          {
            text: "abuse@spindle.example",
            href: "mailto:abuse@spindle.example?subject=Abuse%20report",
          },
          ". Include the workspace or account name if you know it, the URLs or content involved, when it happened, and any screenshots or request identifiers that help us find it.",
        ],
        [
          "Report security vulnerabilities and suspected intrusions to ",
          {
            text: "security@spindle.example",
            href: "mailto:security@spindle.example?subject=Security%20report",
          },
          ". Both addresses are listed on the ",
          { text: "security and trust centre", href: "/security" },
          ", and the security contact is also published in ",
          { text: "security.txt", href: "/.well-known/security.txt" },
          ".",
        ],
        "We aim to acknowledge an abuse report within one business day and a security report within two business days. We cannot discuss another customer's account with you, but we will tell you whether we received your report, whether we are investigating, and when the matter is closed for you. Do not investigate another workspace yourself, and do not share personal data about other people in the report that the investigation does not need.",
      ],
    },
    {
      id: "appeals",
      title: "Appeals",
      paragraphs: [
        [
          "If we throttle, suspend, or terminate your account or workspace and you believe we got it wrong, reply to the notice or write to ",
          {
            text: "abuse@spindle.example",
            href: "mailto:abuse@spindle.example?subject=AUP%20appeal",
          },
          " with the subject line \u201cAUP appeal\u201d. Include the workspace name, the decision you are appealing, and anything that shows the conduct was permitted or has been fixed.",
        ],
        "A different reviewer looks at appeals where that is practical. We will confirm we received the appeal, ask for anything missing, and tell you the outcome in writing. If the decision was wrong, we restore access and, where the suspension was caused by our mistake, we do not count the lost time against your allowances. Appeals do not pause the original decision unless we say so.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      paragraphs: [
        "We may update this policy as the product changes — for example when new features, limits, or subprocessors are added. We publish the new version here with its effective date, and we give reasonable notice before a change that materially narrows what you may do.",
        "If you continue to use Spindle after a change takes effect, the updated policy applies. If you do not agree to it, stop using the service and delete your workspace.",
      ],
    },
  ],
  previousVersions: {
    intro: "Earlier versions of this policy remain available for reference.",
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
      "Abuse reports go to abuse, security reports and vulnerability disclosure go to security, and contractual or legal questions go to legal. We aim to reply within five working days, and to acknowledge abuse and security reports sooner.",
    emails: [
      { label: "Abuse", address: "abuse@spindle.example" },
      { label: "Security", address: "security@spindle.example" },
      { label: "Legal", address: "legal@spindle.example" },
    ],
  },
}
