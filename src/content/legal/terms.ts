import type { LegalDocument } from "./types"

/**
 * Terms of Service copy. Edit this file to change the published terms; the
 * /terms route and its table of contents are generated from it.
 */
export const termsDocument: LegalDocument = {
  eyebrow: "Legal",
  title: "Terms of Service",
  lede: "These terms are the agreement between you and Spindle Labs for using Spindle — the website, the workspace, and the files, lab, search, automations, agent, and chat features that come with it.",
  version: "1.0",
  effectiveDate: "2026-11-19",
  sections: [
    {
      id: "acceptance",
      title: "Acceptance of these terms",
      paragraphs: [
        "By creating a workspace, signing in, or using any part of Spindle, you agree to these Terms of Service. If you use Spindle on behalf of a lab, university, company, or other organization, you confirm that you are allowed to accept these terms for it.",
        "If you do not agree to these terms, do not use Spindle.",
      ],
    },
    {
      id: "eligibility-and-accounts",
      title: "Eligibility and accounts",
      paragraphs: [
        "You must be at least 16 years old, or the age at which you can consent to online services where you live, and able to enter into a binding contract. Spindle is built for research work, not for children.",
        "Keep your sign-in details private and use one account per person. You are responsible for activity that happens under your account. If you believe someone else has access to it, change your password and tell us at security@spindle.example.",
        "A workspace owner controls who belongs to the workspace and can remove members or transfer ownership. Removing a member does not change who owns the content they created, and it does not give you rights to content you did not have before.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      paragraphs: [
        [
          "Your use of Spindle must follow the ",
          { text: "Acceptable Use Policy", href: "/acceptable-use" },
          ", which forms part of these terms. In short, you may not use Spindle to break the law, to harm other people, to interfere with the service or another workspace, or to resell access to it.",
        ],
        "We may suspend or limit a workspace that threatens the security or availability of Spindle or puts another person at risk. Where the law allows, we will tell you what happened and what you need to change.",
      ],
      bullets: [
        [
          "Do not upload malware, attempt to escape a lab container, or probe the service for vulnerabilities without written permission. Report security issues to security@spindle.example.",
        ],
        [
          "Do not use shared lab compute for crypto mining, unauthorized distribution of licensed software, or any workload unrelated to the project it belongs to.",
        ],
        [
          "Do not upload other people's personal or confidential data unless you have the right to do so and have taken the steps your institution requires.",
        ],
      ],
    },
    {
      id: "customer-content",
      title: "Customer content and ownership",
      paragraphs: [
        'You keep ownership of the files, notebooks, notes, datasets, messages, and other material you upload or create in Spindle ("customer content"). These terms do not transfer your intellectual property to us.',
        "You give Spindle Labs a limited, worldwide licence to host, copy, transmit, index, and display customer content only as needed to run the service for you: syncing files between your devices, opening a notebook, running an automation you scheduled, or showing a preview to a teammate. This licence ends when the content is deleted, apart from copies that remain in encrypted backups and operational logs until they age out on our normal schedule.",
        "You confirm that you have the rights needed to upload your customer content and to let us process it as described here, including any consent required for research participant data. You are responsible for the accuracy and legality of what you store.",
      ],
    },
    {
      id: "free-plan-and-paid-terms",
      title: "Free plan and paid terms",
      paragraphs: [
        [
          "The free plan includes 5 GB of storage and 20 agent requests per day per account, plus 50 additional one-time agent requests when an eligible referral creates an account. The current limits are listed on the ",
          { text: "pricing page", href: "/pricing" },
          ". Limits are measured per account, reset on a rolling daily basis, and may be adjusted with notice; we will not reduce a paid allowance during a term you have already paid for.",
        ],
        "Paid and institutional plans are agreed in writing, usually in an order form or a separate agreement. That document sets the fees, term, renewal, included seats or storage, and support level, and it takes precedence over this page if the two conflict. Fees are exclusive of taxes unless stated otherwise and are non-refundable except where the law requires a refund or the order form says otherwise.",
        "If an invoice is overdue, we may suspend paid features after giving you notice and a reasonable chance to pay. Suspension does not cancel amounts already owed.",
      ],
    },
    {
      id: "privacy",
      title: "Privacy and data",
      paragraphs: [
        [
          "Our ",
          { text: "Privacy Policy", href: "/privacy" },
          " explains what personal data we collect, why we collect it, how long we keep it, and the choices you have. It is not a substitute for these terms, and it does not reduce the obligations we take on here.",
        ],
        "Some features are local by design: local search runs on your own machine and the index is not uploaded to us, and anonymous chat is available where a project needs it. Lab sessions and agent runs process project content on our infrastructure in order to do the work you ask for.",
      ],
    },
    {
      id: "availability-and-changes",
      title: "Availability and changes to the service",
      paragraphs: [
        "We work to keep Spindle available and to give notice before planned maintenance. The free plan is provided as-is and does not include a service-level commitment. Paid plans receive the availability commitment, if any, stated in their order form.",
        "We may add, change, or retire features as the product develops. If a change materially reduces what a paid plan provides, we will give reasonable advance notice and, where appropriate, a pro-rata remedy. Third-party services and your own network can also interrupt access, and we cannot promise that every session will run without interruption.",
        "Keep your own copies of anything you cannot afford to lose. Spindle is a workspace, not a backup service.",
      ],
    },
    {
      id: "termination",
      title: "Termination",
      paragraphs: [
        "You may stop using Spindle at any time. A workspace owner can delete the workspace from its settings, which ends access for its members.",
        "We may suspend or terminate your access if you materially breach these terms or the Acceptable Use Policy, if an amount owed is not paid after notice, if we are required to do so by law, or if continuing to provide the service would put Spindle or another person at risk. Where it is lawful and practical, we will tell you the reason and give you an opportunity to fix the problem.",
        "When a workspace is deleted, access ends and customer content is removed on the schedule described in the Privacy Policy. We may retain limited records where the law requires it, such as billing records and security logs. The sections on customer content, disclaimers, limitation of liability, indemnity, and governing law survive termination.",
      ],
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      paragraphs: [
        'To the fullest extent permitted by law, Spindle is provided "as is" and "as available", and we disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the service will be uninterrupted, error-free, or free of harmful code.',
        "Search results, agent output, automation runs, and other generated material are aids, not professional advice. Verify results before relying on them for a publication, a clinical, legal, or financial decision, or any other consequential use. You remain responsible for the research conclusions you draw and for the code you run.",
      ],
    },
    {
      id: "limitation-of-liability",
      title: "Limitation of liability",
      paragraphs: [
        "To the fullest extent permitted by law, Spindle Labs is not liable for indirect, incidental, special, consequential, or exemplary damages, or for lost profits, lost data, lost research time, or loss of goodwill, even if we were told such loss was possible.",
        "Our total liability for all claims relating to the service is limited to the greater of the amount you paid us for the service in the twelve months before the claim arose, or one hundred US dollars. These limits do not apply to liability that cannot be limited by law, including liability for fraud or for death or personal injury caused by negligence.",
      ],
    },
    {
      id: "indemnity",
      title: "Indemnity",
      paragraphs: [
        "You will indemnify Spindle Labs and its directors, employees, and contractors against third-party claims, damages, and reasonable legal costs that arise from your customer content, your breach of these terms or the Acceptable Use Policy, or your violation of another person's rights. We will tell you promptly about a claim, let you lead the defence where it is reasonable to do so, and cooperate at your expense. We may participate in the defence with our own counsel.",
      ],
    },
    {
      id: "governing-law",
      title: "Governing law and disputes",
      paragraphs: [
        "These terms are governed by the laws of the jurisdiction in which Spindle Labs is established, without regard to conflict-of-law rules. The courts of that jurisdiction have exclusive jurisdiction over disputes, except that either party may seek relief in any court with proper jurisdiction over the other party or its assets.",
        "Nothing here removes a mandatory consumer protection you have where you live. Before filing a claim, write to legal@spindle.example with a description of the problem, and give us 30 days to try to resolve it in good faith.",
      ],
    },
    {
      id: "changes-to-these-terms",
      title: "Changes to these terms",
      paragraphs: [
        "We may update these terms as the product or the law changes. For a material change, we will announce it by email or in the workspace before it takes effect, and we will give paid customers at least 30 days' notice unless a shorter period is required by law or needed to address a security risk.",
        "Each version carries its own version number and effective date. When we publish a revision, the previous version stays available on this page. If you continue to use Spindle after a new version takes effect, you accept the updated terms. If you do not agree, stop using Spindle and delete your workspace before the effective date.",
      ],
    },
  ],
  previousVersions: {
    intro: [
      "This is the first published version of the Terms of Service. When we publish a revision, the earlier version will stay listed here and remain available for reference.",
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
      "Questions about these terms, a data request, or a legal notice can go to the addresses below. We aim to reply within five working days.",
    emails: [
      { label: "Legal", address: "legal@spindle.example" },
      { label: "Privacy", address: "privacy@spindle.example" },
      { label: "Security", address: "security@spindle.example" },
    ],
  },
}
