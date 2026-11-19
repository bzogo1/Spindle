"use client"

import { Chrome, Github } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Disabled social sign-in buttons; real OAuth lands with the auth backend. */
export function OAuthButtons() {
  return (
    <div className="auth-oauth">
      <Button
        type="button"
        variant="outline"
        className="auth-oauth-btn"
        disabled
        title="Google sign-in is coming soon"
      >
        <Chrome aria-hidden="true" />
        Continue with Google
        <span className="auth-oauth-badge">Coming soon</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="auth-oauth-btn"
        disabled
        title="GitHub sign-in is coming soon"
      >
        <Github aria-hidden="true" />
        Continue with GitHub
        <span className="auth-oauth-badge">Coming soon</span>
      </Button>
    </div>
  )
}
