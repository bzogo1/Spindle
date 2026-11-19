import {
  CONSENT_VERSION,
  consentCategories,
  consentCategoryLabel,
  cookieRegistry,
} from "@/lib/consent"

import type { LegalDocument } from "./types"

/**
 * Cookie Policy copy. The storage table is generated from the same registry the
 * banner, the settings dialog, and the consent checks use, so the published list
 * cannot drift away from the keys the site actually writes.
 */
export const cookiesDocument: LegalDocument = {
  eyebrow: "Legal",
  title: "Cookie Policy",
  lede: "Every cookie and storage key Spindle sets, what it is for, and how to change your choice.",
  version: CONSENT_VERSION,
  effectiveDate: "2026-11-19",
  summary: {
    title: "The short version",
    bullets: [
      "Essential storage keeps the site working — your cookie choice and your changelog theme. It is always on.",
      "Analytics and masked session replay are optional. Nothing optional starts until you allow it, and rejecting is a single click.",
      "Your choice is stored in a first-party cookie for 180 days. Use Cookie settings in the footer to change or withdraw it at any time.",
      "No advertising cookies, cross-site identifiers, or marketing pixels. We do not sell data.",
    ],
  },
  sections: [
    {
      id: "what-we-store",
      title: "Cookies and storage keys",
      paragraphs: [
        'Spindle uses cookies — small files the browser stores for this site — for the few things the site cannot work without. Where a cookie would be overkill, we use the browser\'s local or session storage instead. This policy calls both "storage" and lists every key, whatever its type.',
        "There are no third-party advertising, social, or marketing scripts on this site, so there are no cookies for them.",
      ],
    },
    {
      id: "your-choice",
      title: "Your choice",
      paragraphs: [
        "On your first visit a banner at the bottom of the page asks which optional categories you allow. The banner is a bar, not a modal: it never covers the page, and you can ignore it and keep reading. Neither optional category is pre-ticked, and rejecting is as easy as accepting — both are single buttons on the banner.",
        "The choice groups storage into three categories:",
      ],
      bullets: consentCategories.map((category) => `${category.label} — ${category.description}`),
      closingParagraphs: [
        "The banner appears on every page that can run optional code: the marketing site and the changelog. It is hidden on this page so the policy stays readable; Cookie settings in the footer still works here.",
      ],
    },
    {
      id: "essential",
      title: "Essential storage",
      paragraphs: [
        "Essential storage keeps the site working and records the choice you made. Because the site cannot function without it, it is always on and does not rely on consent.",
        "It never contains project content, search queries, or account data. The consent cookie records only the categories you allowed, the policy version, and when you decided.",
      ],
    },
    {
      id: "optional",
      title: "Optional storage",
      paragraphs: [
        "Analytics is aggregate usage measurement — which pages, docs guides, and calls to action are used — so we can tell what is useful. It is not enabled in this build; the category exists now so your choice applies the moment it ships, and it will only run after you allow it.",
        "Session replay is a masked recording captured through Sentry. All text and media are hidden, and the search, chat, invite, and sign-in fields are masked or blocked entirely. Error reports and performance traces are separate and run without this category, because keeping the site working is not optional.",
        "Both categories default to off. If you allow them and later withdraw, collection stops immediately in the current tab without a reload.",
      ],
    },
    {
      id: "storage-we-set",
      title: "Storage we set",
      paragraphs: [
        "This table is generated from the same registry the consent banner uses: a key is added here before it can be written.",
      ],
      table: {
        caption: "Every cookie and storage key Spindle sets",
        columns: ["Key", "Storage", "Purpose", "Provider", "Category", "Lifetime"],
        rows: cookieRegistry.map((record) => [
          record.key,
          record.storage,
          record.purpose,
          record.provider,
          consentCategoryLabel(record.category),
          record.lifetime,
        ]),
      },
    },
    {
      id: "withdraw-consent",
      title: "Changing or withdrawing consent",
      paragraphs: [
        "Open Cookie settings from the footer of any page to review the categories and save a new choice. The banner's Cookie settings link opens the same dialog. Saving a change applies immediately — no reload — and the stored consent cookie is updated with the new categories and decision time.",
        "Withdrawing session replay stops an in-progress recording without sending the pending segment and clears its session-storage key. Withdrawing analytics stops future events; it does not pretend already-recorded data never existed, so previously collected aggregates remain in our dashboards until they age out.",
      ],
      bullets: [
        "Clearing the consent cookie in your browser brings the first-visit banner back.",
        "Blocking all cookies in your browser can break sign-in and preferences, but the marketing pages still render.",
        "Browser controls can delete any key listed above at any time; the table explains what will be lost.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      paragraphs: [
        "We version this policy and show the version at the top of the page. The consent cookie records the version you agreed to, so adding or removing a category invalidates older choices and prompts you again rather than assuming consent for something new.",
      ],
    },
  ],
  previousVersions: {
    intro: [
      "This is the first published version of the Cookie Policy. Earlier versions will stay listed here when a revision is published.",
    ],
    entries: [
      {
        version: CONSENT_VERSION,
        effectiveDate: "2026-11-19",
        note: "First published version.",
      },
    ],
  },
  contact: {
    intro:
      "Questions about this policy or a consent choice you cannot change in the browser go to the addresses below. We read every message and reply within 30 days.",
    emails: [
      { label: "Privacy", address: "privacy@spindle.example" },
      { label: "Security", address: "security@spindle.example" },
    ],
  },
}
