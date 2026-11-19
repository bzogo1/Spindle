import { subprocessors } from "./subprocessors"
import type { LegalDocument } from "./types"

/**
 * Data Processing Addendum copy. Edit this file to change the published DPA;
 * the /dpa route, its table of contents, and its subprocessor table are
 * generated from it. Version and effective date are mirrored in the
 * downloadable template at `public/legal/spindle-dpa-template.md`, and the
 * download block fails review if the two disagree.
 */
export const dpaDocument: LegalDocument = {
  eyebrow: "Legal",
  title: "Data Processing Addendum",
  lede: "The terms that apply when an institution, lab, or team entrusts personal data to Spindle, plus the current list of providers that help us process it.",
  version: "1.0",
  effectiveDate: "2026-11-19",
  downloads: [
    {
      label: "DPA template",
      description:
        "The countersignable template, with blank fields for your institution's details. Send the signed copy to legal@spindle.example and we return a countersigned version.",
      href: "/legal/spindle-dpa-template.md",
      meta: "Markdown template",
      version: "1.0",
      effectiveDate: "2026-11-19",
    },
  ],
  summary: {
    title: "The short version",
    bullets: [
      "Your institution decides what goes into Spindle and why. We process that data only to run the workspace, on your documented instructions.",
      "We use a short, published list of subprocessors. Each one is bound by written terms at least as protective as this addendum, and we remain responsible for their work.",
      "We tell you about a new subprocessor before it handles your data, and you have 30 days to object.",
      "We notify you of a personal data breach without undue delay, help with your own data-protection obligations, and delete or return your data when the agreement ends.",
      "The downloadable template states its version and effective date, and any change to this page is versioned the same way.",
    ],
  },
  sections: [
    {
      id: "roles",
      title: "Roles and parties",
      paragraphs: [
        "This Data Processing Addendum (the DPA) forms part of the agreement between Spindle Labs (Spindle, we, us, or the processor) and the institution, lab, or organization that uses Spindle (Customer, you, or the controller). It applies whenever Customer submits personal data to Spindle through the workspace, and it prevails over any conflicting term about processing in that agreement.",
      ],
      subsections: [
        {
          title: "Customer is the controller",
          paragraphs: [
            "Customer determines the purpose and means of processing the personal data it puts into Spindle, including project files, notes, shared documents, chat messages, automations, and agent prompts. Customer is the controller of that data, or a processor acting on behalf of its own controller, in which case Spindle acts as a subprocessor.",
            "Customer is responsible for having a lawful basis for the data it submits, for the instructions it gives us, and for the rights of the people whose data appears in its workspace.",
          ],
        },
        {
          title: "Spindle is the processor",
          paragraphs: [
            "Spindle processes personal data only on Customer's documented instructions, including those in this DPA and in the workspace settings Customer configures, unless a law requires otherwise. If a law requires us to process data for another purpose, we tell Customer before we do so unless the law prohibits that notice.",
          ],
        },
        {
          title: "Individual researchers",
          paragraphs: [
            "The same roles apply on the free plan. A single researcher controls the content of their workspace and is the controller of it; Spindle processes that content only to provide and secure the service.",
          ],
        },
      ],
    },
    {
      id: "processing",
      title: "What we process and why",
      paragraphs: [
        "This table records the processing details the law asks us to describe. It covers the workspace as it is described in our Privacy Policy, and it changes only when the product or this DPA changes.",
      ],
      bullets: [
        "Subject matter: providing, securing, and supporting the Spindle workspace — files, projects, labs, search, automations, agent runs, shared documents, and team chat.",
        "Duration: for as long as Customer's workspace exists, followed by the return and deletion steps in this DPA.",
        "Nature and purpose: storing and organizing project content, running the features Customer uses, authenticating workspace members, keeping audit and security logs, delivering transactional email, producing diagnostics, and answering support requests.",
        "Personal data: account details (name, work email address, hashed password), workspace membership and roles, project content and metadata, usage records, diagnostics, and technical data such as IP address, browser type, and request times.",
        "Data subjects: Customer's authorized users and workspace members, and any individual whose personal data appears in Customer's project content or shared documents.",
        "Special categories: Spindle is a general research workspace, not a system for regulated health or biometric data. Customer should not submit special-category data unless the parties agree on additional safeguards in writing first.",
      ],
      closingParagraphs: [
        "Customer decides what personal data goes into a project. We do not mine project content for advertising, sell it, or use it to train models for anyone else.",
      ],
    },
    {
      id: "obligations",
      title: "Our obligations as processor",
      bullets: [
        "Process personal data only on Customer's instructions, including when we move data between the regions and providers listed in this DPA.",
        "Keep everyone who can access personal data under a written duty of confidentiality, and limit access to the people who need it to run or secure the service.",
        "Help Customer respond to data-subject requests. We provide the export and deletion routes described in the Privacy Policy and pass on a request we receive directly, unless the law says otherwise.",
        "Help Customer with data-protection impact assessments and prior consultations, to the extent the information we already publish and the technical measures we apply are not enough.",
        "Tell Customer promptly about a legally binding request for personal data, unless a law or a court order forbids it, and challenge a request that is overbroad or invalid.",
        "Not sell personal data, not share it with data brokers, and not use it for advertising or for automated decisions that produce legal or similarly significant effects.",
      ],
    },
    {
      id: "security",
      title: "Security measures",
      paragraphs: [
        "We apply technical and organizational measures to protect personal data against accidental or unlawful destruction, loss, alteration, and unauthorized access. These are the measures in place today; the Infrastructure page describes how they fit together.",
      ],
      bullets: [
        "Encryption in transit with TLS, and encryption at rest for project objects stored in private Backblaze B2 buckets.",
        "No public origin: traffic reaches Spindle through Cloudflare's edge and outbound-only Cloudflare Tunnels, so there is no inbound port to scan.",
        "Workspace membership and roles are checked on the server for every request, not only in the interface.",
        "Least-privilege production access, limited to the engineers who need it, with access logged.",
        "Error monitoring and session replay are masked: all text and media are hidden, and search, chat, invite, and sign-in fields are blocked or masked.",
        "Providers are reviewed before they can handle personal data, and the subprocessor list below is kept current.",
        "Personnel are bound by confidentiality, and we review these measures when the product or a provider changes.",
      ],
      closingParagraphs: [
        "We do not claim a certification we do not hold. If your security review needs the current status of audits or certifications, write to security@spindle.example and we will answer with what is actually in place.",
      ],
    },
    {
      id: "subprocessors",
      title: "Subprocessors",
      paragraphs: [
        "Customer gives Spindle general written authorization to engage the subprocessors below. Each one may process personal data only for the purpose listed, under a written agreement that imposes data-protection obligations at least as protective as this DPA. Spindle remains responsible for how each subprocessor performs.",
        "This is the same list that appears in the Privacy Policy. We add a provider here before it can handle personal data, and we do not list a vendor we do not use.",
      ],
      table: {
        caption:
          "Subprocessors engaged by Spindle, with purpose, data categories, storage location, and transfer mechanism",
        columns: ["Vendor", "Purpose", "Data categories", "Storage location", "Transfer mechanism"],
        rows: subprocessors.map((provider) => [
          provider.vendor,
          provider.purpose,
          provider.data,
          provider.location,
          provider.transfer,
        ]),
      },
      subsections: [
        {
          title: "Changes to this list",
          paragraphs: [
            "We notify Customer before a new subprocessor starts handling personal data. The new entry is published in the table above with its purpose, data categories, location, and transfer mechanism, and we email the workspace owners and admins who have subscribed to these notices. The notice period is 30 days from publication unless a shorter period is needed to keep the service secure or to meet a legal requirement, in which case we explain why.",
            [
              "Customer can object to a new subprocessor on data-protection grounds by writing to ",
              { text: "legal@spindle.example", href: "mailto:legal@spindle.example" },
              " within those 30 days. We will try to find another way to provide the affected feature. If we cannot, Customer may terminate the affected part of the service without penalty, and we will refund any prepaid fee for the unused period.",
            ],
            [
              {
                text: "Subscribe to subprocessor notices",
                href: "mailto:legal@spindle.example?subject=Subscribe%20to%20subprocessor%20notices",
              },
              " to be emailed whenever this table changes. The link opens a pre-addressed message; send it and we add you to the list. Every notice names the provider, the data involved, and the date the change takes effect.",
            ],
          ],
        },
      ],
      closingParagraphs: [
        "The current list, as published on this page, is the authoritative version for the date shown at the top of the page.",
      ],
    },
    {
      id: "breach-notification",
      title: "Security incidents and breach notification",
      paragraphs: [
        "If we become aware of a personal data breach affecting Customer's data, we notify Customer without undue delay and, where feasible, within 72 hours of becoming aware of it. The notification goes to the workspace owners and the security contact Customer has given us.",
      ],
      bullets: [
        "The nature of the breach, including the categories and approximate volume of data and data subjects affected.",
        "The likely consequences, and the measures we have taken or propose to take to address the breach and reduce its effects.",
        "The name and contact details of the person at Spindle who can answer questions about it.",
        "Updates as our investigation develops, and the steps Customer can take on its side.",
      ],
      closingParagraphs: [
        "We cooperate with Customer's own notification obligations and with any investigation. A notification is not an admission of fault, and we do not notify data subjects on Customer's behalf unless Customer asks us to.",
      ],
    },
    {
      id: "audit",
      title: "Audit and information",
      paragraphs: [
        "We answer reasonable written questions about these measures and provide the information Customer needs to demonstrate compliance. Customer may audit our processing once in any 12-month period, or more often if a supervisory authority requires it, by giving at least 30 days' written notice.",
      ],
      bullets: [
        "Audits happen during business hours, remotely by default, and under confidentiality.",
        "Customer covers its own costs and avoids disrupting the service or exposing other customers' data.",
        "Where an independent report from a provider covers the relevant controls, we may share that instead of a separate audit of the same systems.",
        "Audit findings are discussed in good faith, and we agree a remediation plan for a confirmed material gap.",
      ],
    },
    {
      id: "transfers",
      title: "International transfers",
      paragraphs: [
        "Spindle is operated from the European Union and the United States, and some subprocessors process data outside the country where Customer or its users are located. Where personal data leaves the EEA or the United Kingdom, we rely on the Standard Contractual Clauses, together with the UK Addendum where it applies, and on each provider's security commitments.",
        "The storage location and transfer mechanism for each provider are in the subprocessor table above. We assess a transfer before it begins and review it when a provider or region changes.",
      ],
      closingParagraphs: [
        [
          "Write to ",
          { text: "legal@spindle.example", href: "mailto:legal@spindle.example" },
          " for a copy of the safeguards that apply to a specific provider.",
        ],
      ],
    },
    {
      id: "termination",
      title: "Return and deletion on termination",
      paragraphs: [
        "When the agreement ends, or when Customer asks us to, we return or delete Customer's personal data as follows.",
      ],
      bullets: [
        "Export: Customer can request an archive of its project files and a structured file of account, workspace, and run metadata. We provide it within 30 days of a verified request.",
        "Active deletion: we delete the workspace and its personal data from active storage within 7 days of a verified request.",
        "Backups: deleted data leaves encrypted backups within 30 days, as the retention schedule in the Privacy Policy describes.",
        "Confirmation: on written request, we confirm in writing that the deletion is complete.",
        "Legal retention: we keep only what the law requires us to keep, and we protect it for as long as we hold it.",
      ],
      closingParagraphs: [
        "Self-service export and deletion are not part of this build yet; our team handles both after verifying the request. The steps are the same for a whole account and for a single workspace.",
      ],
    },
    {
      id: "how-to-sign",
      title: "How to sign this DPA",
      paragraphs: [
        "There are two routes. An institution that signs an Enterprise agreement can incorporate this DPA into it. Otherwise, use the template above and a countersigned copy is returned to you.",
      ],
      subsections: [
        {
          title: "Countersigning the template",
          paragraphs: [],
          bullets: [
            "Download the DPA template from the top of this page and check that its version and effective date match this page.",
            "Fill in your institution's legal name, address, and signatory, and add any negotiated terms as an annex.",
            "Sign and email the document to legal@spindle.example from an address at your institution's domain.",
            "We review it, return a countersigned copy within 5 business days, and record the version that applies to your workspace.",
          ],
        },
        {
          title: "Including it in an Enterprise agreement",
          paragraphs: [
            [
              "Write to ",
              { text: "sales@spindle.example", href: "mailto:sales@spindle.example" },
              " or use the contact route on the pricing page. We will send the DPA with the rest of the agreement, and the version in force on the signature date is the one that applies.",
            ],
          ],
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to this DPA",
      paragraphs: [
        "We version this DPA and show the version and effective date at the top of the page. The downloadable template carries the same version and date, and earlier versions stay listed below.",
        "We notify subscribed workspace admins of a material change at least 30 days before it takes effect. A change required by law or by a new subprocessor follows the process in the subprocessor section. Continuing to use the workspace after a change takes effect means the new version applies, and Customer can terminate the affected part of the service if it does not agree.",
      ],
    },
  ],
  previousVersions: {
    intro: [
      "This is the first published version of the Data Processing Addendum. When we publish a revision, the earlier version will stay listed here and remain available for reference.",
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
      "Spindle Labs is the processor for the data described in this DPA. Questions about these terms, a countersigned copy, and security questionnaires can go to the addresses below. We reply within 5 business days.",
    emails: [
      { label: "Legal and countersigning", address: "legal@spindle.example" },
      { label: "Security", address: "security@spindle.example" },
      { label: "Privacy", address: "privacy@spindle.example" },
    ],
  },
}
