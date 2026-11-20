import type { Metadata } from "next"

import { EmailTemplateEditorScreen } from "@/components/admin/email-template-editor-screen"

export const metadata: Metadata = { title: "Admin — Email templates" }

export default function AdminEmailTemplatesPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Email templates</h1>
          <p className="app-page-subtitle">
            Edit plain-text email templates with variable placeholders and live preview. Restricted
            to admin users.
          </p>
        </div>
      </div>
      <EmailTemplateEditorScreen />
    </div>
  )
}
