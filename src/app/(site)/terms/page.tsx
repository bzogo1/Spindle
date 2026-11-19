import type { Metadata } from "next"

import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { termsDocument } from "@/content/legal/terms"

export const metadata: Metadata = {
  title: "Terms of Service — Spindle",
  description:
    "The terms that apply when you create a Spindle workspace or use the site, labs, search, automations, agent, and chat.",
}

export default function TermsPage() {
  return <LegalPage content={termsDocument} />
}
