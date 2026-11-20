/**
 * User-journey catalog.
 *
 * A "journey" is a multi-step flow a user moves through across pages and API
 * calls (signup → first project, invite → accept, …). Each journey declares
 * its steps in order; `src/lib/journey/tracker.ts` emits `journey_step`
 * analytics events carrying the journey id, step id, and the step's position
 * in this catalog so offline analysis (`scripts/analytics/journey/analyze.mjs`)
 * can rebuild ordered funnels without importing this file.
 *
 * Step ids are stable identifiers — renaming one breaks historical funnels.
 * Add new steps at the end of a journey, or define a new journey id.
 */

export const JOURNEY_IDS = [
  "signup_to_first_project",
  "invite_to_accept",
  "passwordless_signin",
  "oauth_signin",
  "referral_signup",
  "agent_task",
  "feedback_submission",
] as const

export type JourneyId = (typeof JOURNEY_IDS)[number]

export interface JourneyStepDef {
  /** Stable step identifier emitted in analytics events. */
  step: string
  /** Human-readable label for docs and dashboards. */
  label: string
  /** Where the step happens (route pattern or API endpoint). */
  location: string
  description: string
}

export interface JourneyDef {
  id: JourneyId
  title: string
  description: string
  /** Ordered steps — index 0 is the entry point. */
  steps: readonly JourneyStepDef[]
}

export const JOURNEYS: readonly JourneyDef[] = [
  {
    id: "signup_to_first_project",
    title: "Sign up → first project",
    description:
      "The core activation funnel: a visitor lands on the marketing site, creates an account, verifies their email, and opens their first project.",
    steps: [
      {
        step: "landing_view",
        label: "Landing / pricing page viewed",
        location: "/ or /pricing",
        description: "Anonymous visitor reaches the marketing site.",
      },
      {
        step: "signup_view",
        label: "Sign-up form viewed",
        location: "/sign-up",
        description: "Visitor opens the registration screen.",
      },
      {
        step: "signup_submitted",
        label: "Sign-up submitted",
        location: "POST /api/auth/signup",
        description: "Registration request accepted by the auth API.",
      },
      {
        step: "email_verified",
        label: "Email verified",
        location: "/verify-email",
        description: "Verification link completed; account is active.",
      },
      {
        step: "workspace_ready",
        label: "Workspace ready",
        location: "/app or /dashboard",
        description: "Signed-in user lands in the workspace shell.",
      },
      {
        step: "project_create_opened",
        label: "Create-project opened",
        location: "/projects",
        description: "User opens the project creation flow.",
      },
      {
        step: "project_created",
        label: "Project created",
        location: "projects API adapter",
        description: "New project exists in the workspace.",
      },
      {
        step: "first_project_view",
        label: "First project opened",
        location: "/projects/[projectId]",
        description: "User views the newly created project — activation complete.",
      },
    ],
  },
  {
    id: "invite_to_accept",
    title: "Invite → accept",
    description:
      "A workspace admin invites a teammate; the invitee opens the link, accepts, and lands in the shared workspace.",
    steps: [
      {
        step: "invite_sent",
        label: "Invite sent",
        location: "/app/dashboard/members",
        description: "Admin submits an invitation from the members screen.",
      },
      {
        step: "invite_link_opened",
        label: "Invite link opened",
        location: "invite landing route",
        description: "Invitee clicks through to the acceptance page.",
      },
      {
        step: "invite_accepted",
        label: "Invite accepted",
        location: "members API adapter",
        description: "Invitee confirms and joins the workspace.",
      },
      {
        step: "workspace_joined",
        label: "Workspace joined",
        location: "/app or /dashboard",
        description: "New member reaches the workspace shell.",
      },
      {
        step: "first_project_view",
        label: "First shared project opened",
        location: "/projects/[projectId]",
        description: "Invitee opens a project in the shared workspace.",
      },
    ],
  },
  {
    id: "passwordless_signin",
    title: "Passwordless sign-in",
    description:
      "Magic-link authentication: the user requests a link, opens it, and is signed in without a password.",
    steps: [
      {
        step: "signin_view",
        label: "Sign-in page viewed",
        location: "/sign-in",
        description: "Returning user opens the sign-in screen.",
      },
      {
        step: "magic_link_requested",
        label: "Magic link requested",
        location: "POST /api/auth/passwordless/request",
        description: "Auth API accepts the passwordless request and emails the link.",
      },
      {
        step: "magic_link_opened",
        label: "Magic link opened",
        location: "/magic-link",
        description: "User clicks the emailed link.",
      },
      {
        step: "session_established",
        label: "Session established",
        location: "GET /api/auth/session",
        description: "Authenticated session confirmed — sign-in complete.",
      },
    ],
  },
  {
    id: "oauth_signin",
    title: "OAuth sign-in",
    description:
      "Social sign-in: the user picks a provider, completes the provider flow, and returns through the OAuth callback.",
    steps: [
      {
        step: "signin_view",
        label: "Sign-in page viewed",
        location: "/sign-in",
        description: "User opens the sign-in screen.",
      },
      {
        step: "oauth_started",
        label: "OAuth flow started",
        location: "GET /api/auth/oauth/[provider]",
        description: "User chooses a provider; redirect to the IdP begins.",
      },
      {
        step: "oauth_callback",
        label: "OAuth callback received",
        location: "/oauth/callback",
        description: "Provider redirects back with the authorization code.",
      },
      {
        step: "session_established",
        label: "Session established",
        location: "GET /api/auth/session",
        description: "Authenticated session confirmed — sign-in complete.",
      },
    ],
  },
  {
    id: "referral_signup",
    title: "Referral → sign-up",
    description:
      "A referred visitor lands via a `/r/[code]` link, the code is stored for attribution, and they complete sign-up.",
    steps: [
      {
        step: "referral_landing",
        label: "Referral link opened",
        location: "/r/[code]",
        description: "Visitor arrives through a referral link.",
      },
      {
        step: "referral_stored",
        label: "Referral code stored",
        location: "localStorage spindle.referral-invite",
        description: "Client persists the `SPN-XXXX-XXXX` code for attribution.",
      },
      {
        step: "signup_submitted",
        label: "Sign-up submitted",
        location: "POST /api/auth/signup",
        description: "Registration request accepted (with referral attribution).",
      },
      {
        step: "email_verified",
        label: "Email verified",
        location: "/verify-email",
        description: "Verification link completed.",
      },
      {
        step: "first_project_view",
        label: "First project opened",
        location: "/projects/[projectId]",
        description: "Referred user activates — journey complete.",
      },
    ],
  },
  {
    id: "agent_task",
    title: "Agent task",
    description:
      "A user opens a project, starts an agent run from the agent panel, and the run completes.",
    steps: [
      {
        step: "project_opened",
        label: "Project opened",
        location: "/projects/[projectId]",
        description: "User enters a project workspace.",
      },
      {
        step: "agent_panel_opened",
        label: "Agent panel opened",
        location: "/projects/[projectId]/agent",
        description: "User navigates to the agent surface.",
      },
      {
        step: "prompt_submitted",
        label: "Agent prompt submitted",
        location: "agent runs API adapter",
        description: "User submits a task to the agent.",
      },
      {
        step: "run_completed",
        label: "Agent run completed",
        location: "/app/agent/[runId] or stream",
        description: "Run reaches a terminal state — task complete.",
      },
    ],
  },
  {
    id: "feedback_submission",
    title: "Feedback / NPS submission",
    description: "A user opens the feedback or NPS surface and submits a response.",
    steps: [
      {
        step: "feedback_view",
        label: "Feedback surface viewed",
        location: "/app/feedback or /app/nps",
        description: "User opens the feedback or NPS screen.",
      },
      {
        step: "feedback_draft",
        label: "Feedback composed",
        location: "/app/feedback or /app/nps",
        description: "User has entered content (optional intermediate signal).",
      },
      {
        step: "feedback_submitted",
        label: "Feedback submitted",
        location: "POST /api/feedback or /api/nps",
        description: "Response accepted by the API — journey complete.",
      },
    ],
  },
]

const journeyIndex = new Map<JourneyId, JourneyDef>(JOURNEYS.map((j) => [j.id, j]))

/** Looks up a journey definition; returns undefined for unknown ids. */
export function getJourney(id: string): JourneyDef | undefined {
  return journeyIndex.get(id as JourneyId)
}

/** Position of `step` in the journey's ordered step list, or -1. */
export function journeyStepIndex(journeyId: JourneyId, step: string): number {
  const journey = journeyIndex.get(journeyId)
  if (!journey) return -1
  return journey.steps.findIndex((s) => s.step === step)
}

/** True when `step` is a declared step of `journeyId`. */
export function isJourneyStep(journeyId: JourneyId, step: string): boolean {
  return journeyStepIndex(journeyId, step) >= 0
}
