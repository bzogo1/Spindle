import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"

import { PasskeysPanel } from "@/components/auth/passkeys-panel"
import { SecurityAlertsPanel } from "@/components/app/security-alerts-panel"
import { SecurityKeysPanel } from "@/components/auth/security-keys-panel"
import { TwoFactorDevicesPanel } from "@/components/auth/two-factor-devices"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Security" }

export default function SecurityPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Security</h1>
          <p className="app-page-subtitle">
            Review suspicious sign-in activity, control how login alerts reach you, and configure
            your sign-in security policies.
          </p>
        </div>
      </div>
      <section className="app-panel" aria-labelledby="security-policies-link-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="security-policies-link-heading">Sign-in security policies</h2>
            <p>
              Configure the rules your account applies at sign-in: two-factor requirement, session
              limits, allowed hours, and password strength. Enforcement on the sign-in routes is
              planned; policies are stored now.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <Button asChild size="sm">
              <Link href="/app/security/policies">
                <ShieldCheck aria-hidden="true" />
                Manage policies
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      <SecurityAlertsPanel />
      <TwoFactorDevicesPanel />
      <PasskeysPanel />
      <SecurityKeysPanel />
    </div>
  )
}
