import { describe, expect, it } from "vitest"

import { siteUrl } from "./changelog"
import { pricingFaqs } from "./pricing"
import {
  createFaqPageJsonLd,
  createOrganizationJsonLd,
  createSoftwareApplicationJsonLd,
  createStructuredDataGraph,
  createWebSiteJsonLd,
  serializeJsonLd,
} from "./structured-data"

describe("Organization JSON-LD", () => {
  it("describes the site publisher with an absolute URL", () => {
    const org = createOrganizationJsonLd()

    expect(org["@type"]).toBe("Organization")
    expect(org.name).toBe("Spindle")
    expect(org.url).toBe(siteUrl)
    expect(org["@id"]).toBe(`${siteUrl}/#organization`)
    expect(org.description).toContain("Spindle")
    expect(org.logo).toBe(`${siteUrl}/icons/icon-512.png`)
  })

  it("lists only the social profiles actually linked on the site", () => {
    const org = createOrganizationJsonLd()

    expect(org.sameAs).toEqual(["https://github.com/spindle-labs/spindle"])
  })
})

describe("WebSite JSON-LD", () => {
  it("describes the site in its language", () => {
    const site = createWebSiteJsonLd()

    expect(site["@type"]).toBe("WebSite")
    expect(site.name).toBe("Spindle")
    expect(site.url).toBe(siteUrl)
    expect(site.inLanguage).toBe("en")
  })
})

describe("SoftwareApplication JSON-LD", () => {
  it("describes the product as a web research application", () => {
    const app = createSoftwareApplicationJsonLd()

    expect(app["@type"]).toBe("SoftwareApplication")
    expect(app["@id"]).toBe(`${siteUrl}/#software`)
    expect(app.name).toBe("Spindle")
    expect(app.url).toBe(siteUrl)
    expect(app.applicationCategory).toBe("ResearchApplication")
    expect(app.operatingSystem).toBe("Web")
  })

  it("advertises the free tier from pricing.ts as a $0 offer", () => {
    const app = createSoftwareApplicationJsonLd()

    expect(app.offers).toEqual({
      "@type": "Offer",
      name: "Hobby",
      price: "0",
      priceCurrency: "USD",
      url: `${siteUrl}/pricing`,
    })
  })
})

describe("FAQPage JSON-LD", () => {
  it("mirrors the visible FAQ array exactly", () => {
    const faqPage = createFaqPageJsonLd(pricingFaqs, "/pricing")

    expect(faqPage["@type"]).toBe("FAQPage")
    expect(faqPage["@id"]).toBe(`${siteUrl}/pricing#faq`)
    expect(faqPage.mainEntity).toHaveLength(pricingFaqs.length)
    expect(faqPage.mainEntity.map((q) => q.name)).toEqual(pricingFaqs.map((faq) => faq.question))
    expect(faqPage.mainEntity[0]).toEqual({
      "@type": "Question",
      name: pricingFaqs[0].question,
      acceptedAnswer: {
        "@type": "Answer",
        text: pricingFaqs[0].answer,
      },
    })
  })
})

describe("structured data graph", () => {
  it("combines Organization, WebSite, and SoftwareApplication under schema.org context", () => {
    const graph = createStructuredDataGraph()

    expect(graph["@context"]).toBe("https://schema.org")
    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ])
  })
})

describe("serializeJsonLd", () => {
  it("escapes < so a script tag cannot be closed early", () => {
    const output = serializeJsonLd({ text: "</script><script>alert(1)" })

    expect(output).not.toContain("</script>")
    expect(output).toContain("\\u003c/script>")
    expect(JSON.parse(output)).toEqual({ text: "</script><script>alert(1)" })
  })
})
