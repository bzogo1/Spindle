import type { Tutorial } from "./types"

/**
 * Sample tutorials used by the `/tutorials` demo page. The targets
 * (`#tutorial-demo-*`) are rendered by `TutorialDemo` on the same page.
 */
export const SAMPLE_TUTORIALS: Tutorial[] = [
  {
    id: "workspace-tour",
    title: "Workspace tour",
    description: "A three-step walkthrough of the demo workspace card.",
    steps: [
      {
        id: "welcome",
        title: "Welcome to your workspace",
        content:
          "This card is a stand-in for a real project dashboard. The tour highlights each region in turn — press Next to continue or Skip to exit at any time.",
        placement: "bottom",
      },
      {
        id: "stats",
        target: "#tutorial-demo-stats",
        title: "Live project stats",
        content:
          "Counters like these update as automations and agent runs report back. Everything here belongs to the project, not to a global account view.",
        placement: "auto",
      },
      {
        id: "cta",
        target: "#tutorial-demo-cta",
        title: "One click to the next step",
        content:
          "Primary actions stay pinned to the card so the next thing to do is always obvious. That is the whole idea: the workspace tells you what matters next.",
        placement: "top",
      },
    ],
  },
  {
    id: "quickstart-tour",
    title: "Quickstart checklist",
    description: "A shorter tour that only covers the checklist panel.",
    steps: [
      {
        id: "checklist",
        target: "#tutorial-demo-checklist",
        title: "Setup checklist",
        content:
          "Guided tours like this one can point at any element via a CSS selector. Completion is remembered in localStorage, so returning users are not re-toured.",
        placement: "auto",
      },
      {
        id: "done",
        title: "You are ready",
        content:
          "Define your own tutorials as data — steps are just a selector, a title, and content. No tour-specific markup required on the target elements.",
        placement: "auto",
      },
    ],
  },
]
