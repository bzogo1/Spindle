import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { privacyDocument } from "@/content/legal/privacy"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Privacy Policy — Spindle",
  description:
    "What Spindle collects, why we collect it, where it is stored, how long it is kept, and how to access, export, or delete your data.",
  path: "/privacy",
})

export default function PrivacyPage() {
  return <LegalPage content={privacyDocument} />
}
