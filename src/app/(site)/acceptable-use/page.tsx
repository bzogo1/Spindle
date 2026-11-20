import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { acceptableUseDocument } from "@/content/legal/acceptable-use"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Acceptable Use Policy — Spindle",
  description:
    "What you may and may not do with a Spindle account, its storage, lab compute, search, automations, and the agent — and how we enforce the rules.",
  path: "/acceptable-use",
})

export default function AcceptableUsePage() {
  return <LegalPage content={acceptableUseDocument} />
}
