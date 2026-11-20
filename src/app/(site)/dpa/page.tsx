import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { dpaDocument } from "@/content/legal/dpa"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Data Processing Addendum — Spindle",
  description:
    "The Data Processing Addendum for Spindle: controller and processor roles, security measures, breach notification, audit, deletion on termination, and the current subprocessor list.",
  path: "/dpa",
})

export default function DpaPage() {
  return <LegalPage content={dpaDocument} />
}
