import { socials } from "@/lib/socials"
import { siteUrl } from "@/lib/changelog"
import { plans, type Faq } from "@/lib/pricing"
import { defaultSiteDescription, siteName } from "@/lib/seo"

export type OrganizationJsonLd = {
  "@type": "Organization"
  "@id": string
  name: string
  url: string
  description: string
  logo: string
  /** Only profiles actually linked from the site footer. */
  sameAs?: string[]
}

export type WebSiteJsonLd = {
  "@type": "WebSite"
  "@id": string
  name: string
  url: string
  description: string
  inLanguage: "en"
}

export type OfferJsonLd = {
  "@type": "Offer"
  name: string
  price: string
  priceCurrency: string
  url: string
}

export type SoftwareApplicationJsonLd = {
  "@type": "SoftwareApplication"
  "@id": string
  name: string
  url: string
  description: string
  applicationCategory: "ResearchApplication"
  operatingSystem: "Web"
  offers?: OfferJsonLd
}

export type FaqQuestionJsonLd = {
  "@type": "Question"
  name: string
  acceptedAnswer: {
    "@type": "Answer"
    text: string
  }
}

export type FaqPageJsonLd = {
  "@type": "FAQPage"
  "@id": string
  mainEntity: FaqQuestionJsonLd[]
}

export type StructuredDataGraph = {
  "@context": "https://schema.org"
  "@graph": (OrganizationJsonLd | WebSiteJsonLd | SoftwareApplicationJsonLd)[]
}

/**
 * Organization entity for the site publisher. `sameAs` is derived from the
 * same list that renders the footer social links, so markup and visible links
 * cannot diverge. Legal name/address fields are intentionally omitted until
 * approved values exist (issue 008).
 */
export function createOrganizationJsonLd(): OrganizationJsonLd {
  const sameAs = socials.map((social) => social.href)
  return {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: siteName,
    url: siteUrl,
    description: defaultSiteDescription,
    logo: `${siteUrl}/icons/icon-512.png`,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  }
}

/** WebSite entity describing the site itself, in the site's language. */
export function createWebSiteJsonLd(): WebSiteJsonLd {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: siteName,
    url: siteUrl,
    description: defaultSiteDescription,
    inLanguage: "en",
  }
}

/**
 * SoftwareApplication entity describing the product itself. The `offers`
 * block mirrors the free tier on /pricing: it is only emitted when a plan
 * with a price of 0 exists in `src/lib/pricing.ts`, so markup cannot
 * advertise a price the pricing page doesn't show.
 */
export function createSoftwareApplicationJsonLd(): SoftwareApplicationJsonLd {
  const freePlan = plans.find((plan) => plan.price.amount === 0)
  return {
    "@type": "SoftwareApplication",
    "@id": `${siteUrl}/#software`,
    name: siteName,
    url: siteUrl,
    description: defaultSiteDescription,
    applicationCategory: "ResearchApplication",
    operatingSystem: "Web",
    ...(freePlan
      ? {
          offers: {
            "@type": "Offer" as const,
            name: freePlan.name,
            price: "0",
            priceCurrency: "USD",
            url: `${siteUrl}/pricing`,
          },
        }
      : {}),
  }
}

/**
 * FAQPage entity built from the same `Faq[]` array that renders the visible
 * accordion, so markup and page text cannot diverge. Rendered only on the
 * page whose FAQ it describes (e.g. /pricing via `pricingFaqs`, passed as
 * `pagePath` for the entity `@id`).
 */
export function createFaqPageJsonLd(faqs: Faq[], pagePath: string): FaqPageJsonLd {
  return {
    "@type": "FAQPage",
    "@id": `${siteUrl}${pagePath}#faq`,
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  }
}

/**
 * Single `@graph` document covering the entities every public page shares.
 * Rendered once per layout so nested layouts don't duplicate the Organization
 * block.
 */
export function createStructuredDataGraph(): StructuredDataGraph {
  return {
    "@context": "https://schema.org",
    "@graph": [
      createOrganizationJsonLd(),
      createWebSiteJsonLd(),
      createSoftwareApplicationJsonLd(),
    ],
  }
}

/**
 * Serializes JSON-LD for a `<script type="application/ld+json">` tag.
 * `<` is escaped to a unicode escape so content can never close the
 * script element early (`</script>` injection).
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}
