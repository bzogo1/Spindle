---
title: "Add Organization, WebSite, and FAQ structured data"
priority: Low
estimate: 2
labels:
  - frontend
  - seo
project: Spindle Website
status: Todo
---

## Summary

The site has per-page metadata issues but no JSON-LD, so search engines get no entity information:
who publishes the site, what the product is, and which FAQ answers are on the page.

## Context

- `/` contains the FAQ accordion referenced as `/#faq` by the header and footer; its questions live in
  `src/app/(site)/page.tsx` / the FAQ component, not in a data file.
- Company details are currently only "© 2026 Spindle Labs" in
  `src/components/site/site-footer.tsx`; 008 adds the approved legal entity details.
- Social profiles are in `src/components/site/social-links.tsx`.
- 016 will make pricing facts available from `src/lib/pricing.ts`; 026 sets `metadataBase`.
- There are no reviews, ratings, or customer counts on the site — do not invent them.

## Scope

- `src/lib/structured-data.ts` exporting typed builders for:
  - `Organization`: name, url, logo, sameAs (only the profiles actually linked), and address/legal
    name only once 008 supplies approved values.
  - `WebSite`: name, url, in the site's language. Do not add a `SearchAction` unless a real
    search-results URL exists; the command menu is client-side only.
  - `SoftwareApplication`: name, applicationCategory, operatingSystem ("Web"), and an offer with price
    0 only if it matches `/pricing`; no aggregateRating.
  - `FAQPage`: built from the same array that renders `/#faq`, so visible text and markup cannot
    diverge.
- Render one `<script type="application/ld+json">` per relevant page (or a single `@graph`), with
  `<` escaped to `\u003c` to prevent script injection.
- Add BreadcrumbList only once docs/changelog permalinks exist (018, 042), or omit it entirely.
- Keep the builders server-only and statically rendered.

## Acceptance criteria

- Rich Results Test accepts Organization, WebSite, SoftwareApplication, and the FAQ page with no
  errors or warnings about missing required fields.
- Every FAQ question/answer in the markup matches the visible accordion text exactly.
- No aggregateRating, review, address, or registration number appears until the source data is
  approved.
- JSON-LD output is escaped and cannot be broken by a `</script>` string in content.
- One entity per page; no duplicate Organization blocks across nested layouts.
- Build remains fully static; no runtime data fetch.

## Notes

Depends on 008 for legal entity details and 016 for pricing facts; ship Organization/WebSite first and
add those fields when available. Do not add markup for features the site does not have.
