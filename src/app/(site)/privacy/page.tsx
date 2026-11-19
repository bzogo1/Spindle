import type { Metadata } from "next"

import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { privacyDocument } from "@/content/legal/privacy"

export const metadata: Metadata = {
  title: "Privacy Policy — Spindle",
  description:
    "What Spindle collects, why we collect it, where it is stored, how long it is kept, and how to access, export, or delete your data.",
}

export default function PrivacyPage() {
  return <LegalPage content={privacyDocument} />
}
