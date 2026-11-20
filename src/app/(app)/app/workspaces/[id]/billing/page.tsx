import type { Metadata } from "next"

import { BillingScreen } from "@/components/workspaces/billing-screen"

export const metadata: Metadata = { title: "Workspace billing" }

export default async function WorkspaceBillingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Workspace billing</h1>
          <p className="app-page-subtitle">
            Review the workspace plan, seat usage, and subscription status. Owners and admins manage
            billing; it isn&apos;t visible to members.
          </p>
        </div>
      </div>
      <BillingScreen workspaceId={id} />
    </div>
  )
}
