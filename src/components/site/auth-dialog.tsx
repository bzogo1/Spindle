"use client"

import { useEffect, useState } from "react"

import { CheckEmailStep } from "@/components/site/auth/check-email-step"
import { CreateWorkspaceForm } from "@/components/site/auth/create-workspace-form"
import {
  mockSendEmailLink,
  setMockSession,
  type MockSession,
} from "@/components/site/auth/mock-auth"
import { ResetPasswordForm } from "@/components/site/auth/reset-password-form"
import { SignInForm } from "@/components/site/auth/sign-in-form"
import { APP_ROOT_PATH, mockAuthEnabled, persistMockSession } from "@/lib/auth/mock-session"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type AuthTab = "signin" | "create"
type DialogStep = "auth" | "reset" | "verify-email" | "reset-sent"

const STEP_COPY: Record<DialogStep, { title: string; description: string }> = {
  auth: {
    title: "Welcome to Spindle",
    description: "One workspace for every research project.",
  },
  reset: {
    title: "Reset your password",
    description: "We'll email you a link to choose a new password.",
  },
  "verify-email": {
    title: "Check your email",
    description: "We sent a verification link to your inbox.",
  },
  "reset-sent": {
    title: "Check your inbox",
    description: "We sent a reset link to your inbox.",
  },
}

/** Sign-in / create-workspace / reset dialog used by the shared header. */
export function AuthDialog() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<AuthTab>("signin")
  const [step, setStep] = useState<DialogStep>("auth")
  const [successEmail, setSuccessEmail] = useState("")

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      setTab(detail?.tab === "create" ? "create" : "signin")
      setStep("auth")
      setOpen(true)
    }

    window.addEventListener("spindle:open-auth", handleOpen)

    // `/` + `?signin=1` is where the `(app)` route guard sends signed-out
    // visitors; open the dialog once on arrival.
    if (new URLSearchParams(window.location.search).has("signin")) {
      setTab("signin")
      setStep("auth")
      setOpen(true)
    }

    return () => window.removeEventListener("spindle:open-auth", handleOpen)
  }, [])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setStep("auth")
      setTab("signin")
      setSuccessEmail("")
    }
  }

  function handleSignInSuccess(session: MockSession) {
    setMockSession(session)
    if (mockAuthEnabled) {
      // Persist the mock session cookie so the `(app)` server guard lets the
      // visitor through, then enter the shell with a full navigation (the app
      // uses its own root layout).
      persistMockSession(session)
      window.location.assign(APP_ROOT_PATH)
      return
    }
    handleOpenChange(false)
  }

  function handleCreateSuccess(session: MockSession) {
    setSuccessEmail(session.user.email)
    setStep("verify-email")
  }

  function handleResetSent(email: string) {
    setSuccessEmail(email)
    setStep("reset-sent")
  }

  function backToAuth() {
    setStep("auth")
    setTab("signin")
  }

  const isSuccessStep = step === "verify-email" || step === "reset-sent"
  const copy = STEP_COPY[step]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="link"
          className="ui-signin-trigger"
          onClick={() => {
            setTab("signin")
            setStep("auth")
          }}
        >
          Sign in
        </Button>
      </DialogTrigger>
      <DialogContent
        className="ui-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          content.querySelector<HTMLElement>("input")?.focus()
        }}
      >
        <DialogHeader className={isSuccessStep ? "sr-only" : undefined}>
          <DialogTitle className="ui-dialog-title">{copy.title}</DialogTitle>
          <DialogDescription className="ui-dialog-desc">
            {isSuccessStep && successEmail
              ? step === "verify-email"
                ? `We sent a verification link to ${successEmail}.`
                : `We sent a reset link to ${successEmail}. The link expires in 30 minutes.`
              : copy.description}
          </DialogDescription>
        </DialogHeader>

        {step === "auth" ? (
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as AuthTab)}
            className="ui-auth-tabs"
          >
            <TabsList className="ui-auth-tabs-list">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="create">Create workspace</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="ui-auth-form ui-auth-step">
              <SignInForm
                onSuccess={handleSignInSuccess}
                onForgotPassword={() => setStep("reset")}
              />
            </TabsContent>
            <TabsContent value="create" className="ui-auth-form ui-auth-step">
              <CreateWorkspaceForm onSuccess={handleCreateSuccess} />
            </TabsContent>
          </Tabs>
        ) : null}

        {step === "reset" ? (
          <div className="ui-auth-step">
            <ResetPasswordForm onSent={handleResetSent} onBack={backToAuth} />
          </div>
        ) : null}

        {step === "verify-email" ? (
          <CheckEmailStep
            title="Verify your email"
            email={successEmail}
            message={(email) => (
              <>
                We sent a verification link to <strong>{email}</strong>. Open it to activate your
                workspace.
              </>
            )}
            onResend={() => mockSendEmailLink(successEmail)}
            onBack={backToAuth}
          />
        ) : null}

        {step === "reset-sent" ? (
          <CheckEmailStep
            title="Link sent"
            email={successEmail}
            message={(email) => (
              <>
                We sent a reset link to <strong>{email}</strong>. The link expires in 30 minutes.
              </>
            )}
            onResend={() => mockSendEmailLink(successEmail)}
            onBack={backToAuth}
          />
        ) : null}

        <DialogFooter className="ui-dialog-footer">
          <Separator />
          <DialogClose asChild>
            <Button variant="ghost" size="sm" className="ui-btn-quiet">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
