import type { Metadata } from "next"

import { GeoRestrictionsPanel } from "@/components/app/geo-restrictions-panel"
import { PasswordRotationPanel } from "@/components/app/password-rotation-panel"
import { SecurityPoliciesPanel } from "@/components/app/security-policies-panel"

export const metadata: Metadata = { title: "Security policies" }

export default function SecurityPoliciesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Security policies</h1>
          <p className="app-page-subtitle">
            Configure the sign-in rules your account applies: two-factor requirement, session
            limits, allowed hours, password strength, and geographic restrictions. Enforcement on
            the sign-in routes is planned; policies are stored now.
          </p>
        </div>
      </div>
      <SecurityPoliciesPanel />
      <PasswordRotationPanel />
      <GeoRestrictionsPanel />
    </div>
  )
}
