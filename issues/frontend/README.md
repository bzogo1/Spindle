# Frontend issue backlog

One issue per markdown file, written to be pasted or imported into the Linear project as individual
issues. Each file has Linear-shaped frontmatter (`title`, `priority`, `estimate`, `labels`, `project`,
`status`) followed by Summary / Context / Scope / Acceptance criteria.

The frontmatter is a plain mapping, not a Linear-native format — set priority, estimate, and labels
manually (or with your importer's field mapping) when creating the issues.

## Groups

### Legal, privacy and trust

| #   | Issue                                   | Priority |
| --- | --------------------------------------- | -------- |
| 001 | Terms of Service page                   | High     |
| 002 | Privacy Policy page                     | High     |
| 003 | Cookie policy and consent banner        | High     |
| 004 | DPA and subprocessor list               | Medium   |
| 005 | Acceptable Use Policy                   | Medium   |
| 006 | Security and trust centre               | Medium   |
| 007 | Accessibility statement                 | Low      |
| 008 | Legal footer column and company details | High     |

### Auth, account and onboarding

| #   | Issue                                                 | Priority |
| --- | ----------------------------------------------------- | -------- |
| 009 | Wire sign-in dialog to real auth (tracking issue)     | Urgent   |
| 010 | Auth form validation and errors                       | High     |
| 011 | Password reset and email verification                 | High     |
| 012 | Workspace settings and account pages (tracking issue) | Medium   |
| 013 | Team invite landing page                              | Medium   |
| 035 | Typed auth client and session provider                | High     |
| 036 | Wire sign-in and create-workspace forms to the API    | High     |
| 037 | Signed-in account menu, sign-out, and route guard     | High     |
| 038 | Authenticated app shell and workspace navigation      | High     |
| 039 | Workspace and account settings forms                  | Medium   |
| 040 | Member management and pending invites                 | Medium   |
| 041 | Usage and plan overview page                          | Medium   |
| 058 | Transactional email templates                         | Medium   |
| 063 | First-run onboarding for a new workspace              | Medium   |
| 065 | Account and workspace data export                     | Medium   |

### Site features

| #   | Issue                                                | Priority |
| --- | ---------------------------------------------------- | -------- |
| 014 | Docs navigation, search, multi-page (tracking issue) | High     |
| 015 | Docs code-block copy and highlighting                | Medium   |
| 016 | Pricing comparison and billing toggle                | Medium   |
| 017 | Changelog real content and RSS                       | Medium   |
| 018 | Changelog permalinks and OG images                   | Low      |
| 019 | Referral landing page                                | Medium   |
| 020 | Contact form                                         | Medium   |
| 021 | Newsletter signup                                    | Low      |
| 022 | 404 and error pages                                  | Medium   |
| 023 | Site theme toggle (tracking issue)                   | Low      |
| 024 | Command-menu search                                  | Low      |
| 025 | Status page and footer indicator                     | Low      |
| 042 | Docs MDX content source and per-guide routes         | High     |
| 043 | Docs sidebar, breadcrumbs, and previous/next         | Medium   |
| 044 | Docs search and scroll-spy table of contents         | High     |
| 045 | Light theme tokens and no-flash toggle               | Medium   |
| 046 | Light-mode page and canvas audit                     | Low      |

### SEO, performance, testing, accessibility

| #   | Issue                                            | Priority |
| --- | ------------------------------------------------ | -------- |
| 026 | Sitemap, robots, canonicals                      | High     |
| 027 | Per-page OG metadata                             | Medium   |
| 028 | Consent-gated analytics                          | Medium   |
| 029 | Playwright route smoke tests                     | High     |
| 030 | Lighthouse CI budget                             | Medium   |
| 031 | Reduced-motion and keyboard audit                | Medium   |
| 051 | Security headers and Content Security Policy     | High     |
| 052 | Validate environment configuration at build time | Medium   |
| 053 | Favicon, app icons, and web app manifest         | Low      |
| 054 | Organization, WebSite, and FAQ structured data   | Low      |
| 055 | Responsive audit from 320 px to 1440 px          | Medium   |
| 056 | Sentry releases and production source maps       | Medium   |
| 057 | Unit and component test harness                  | Medium   |

### App features behind the previews

| #   | Issue                                               | Priority |
| --- | --------------------------------------------------- | -------- |
| 032 | File manager upload and preview (tracking issue)    | High     |
| 033 | Chat anonymous mode and history                     | Medium   |
| 034 | Agent run log and approvals                         | Medium   |
| 047 | Project file browser with tree navigation           | High     |
| 048 | Upload queue with drag-and-drop and progress        | High     |
| 049 | Inline previews for images, PDFs, CSV, and text     | High     |
| 050 | Storage usage, selection, and bulk actions          | Medium   |
| 059 | Local search with real results                      | High     |
| 060 | Automation validation and dry-run preview           | Medium   |
| 061 | Automation run history and readable logs            | Medium   |
| 062 | Lab runs and history                                | Medium   |
| 064 | Lab run snapshots and comparison                    | Low      |
| 066 | Shared project documents with autosave and versions | Medium   |
| 067 | Presence, cursors, and inline comments              | Medium   |

## Split issues

Five issues were too broad to start, so they are kept as tracking issues with smaller slices that lead
up to them:

| Tracking issue           | Delivered by                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| 009 Real auth            | 035 → 036 → 037, with 010 and 011 as parallel form/recovery work |
| 012 Settings and account | 038 → 039, 040, 041                                              |
| 014 Docs                 | 042 → 043 → 044, with 015 as a follow-up                         |
| 023 Theme toggle         | 045 → 046                                                        |
| 032 File manager         | 047 → 048 → 049, 050                                             |

## Dependencies

- Legal copy (001–008) needs company/counsel approval; the frontend work is layout, routing, and linking.
- 008 (footer legal column) depends on the routes from 001–007 existing.
- 052 (env validation) feeds 026 (production origin), 035 (auth API URL), and 056 (release/environment).
- 035 blocks 036 and 037; 037 blocks 038. 038 unblocks 039–041, 047–050, 059–067, and 063's checklist.
- 058 (email templates) is needed by 011 (verification/reset), 013 (invites), 021 (double opt-in), and
  065 (export link delivery).
- 065 (data export) pairs with 039's account deletion; both need the backend data-rights contract.
- 042 blocks 043 and 044. 045 blocks 046.
- 047 blocks 048; 048 feeds 049 and 050.
- 040 and 047 feed 066 (shared documents); 066 blocks 067 (presence and comments).
- 060 blocks 061. 062 blocks 064.
- 051 (CSP) must account for 028's analytics origin, 045's inline theme script, and 056's Sentry
  tunnel. Land it before or with 028 rather than retrofitting the policy.
- 057 (unit harness) is needed before the unit-test criteria in 003, 010, 028, 052, 054, and 058.
- 029 (Playwright) underpins 055's viewport matrix; 030 and 031 stay independent.
- 059, 060–061, 062–064, and 066–067 each need a backend/runtime contract agreed first; none invent a
  service that is not being built.
- Every issue states its backend or content dependency in the body.
