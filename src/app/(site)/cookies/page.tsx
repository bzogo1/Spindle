import type { Metadata } from "next"

import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { cookiesDocument } from "@/content/legal/cookies"

export const metadata: Metadata = {
  title: "Cookie Policy — Spindle",
  description:
    "Every cookie and storage key Spindle sets, its purpose, provider, category, and lifetime, and how to change your consent choice.",
}

export default function CookiesPage() {
  return <LegalPage content={cookiesDocument} />
}
