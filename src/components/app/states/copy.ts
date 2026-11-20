export const appStateCopy = {
  loading: {
    default: "Loading",
    panel: "Loading panel",
    page: "Loading page",
  },
  empty: {
    defaultTitle: "Nothing here yet",
    defaultBody: "There is nothing to show yet. When there is, it will appear here.",
  },
  error: {
    defaultTitle: "Something went wrong",
    defaultMessage:
      "We could not load this content. Try again, or contact support if it keeps happening.",
    retry: "Try again",
    retrying: "Trying again…",
    supportLabel: "Contact support",
    supportHref: "/about#contact",
    referenceLabel: "Error reference",
    noReference: "No error reference is available for this failure.",
  },
  inlineError: {
    defaultTitle: "Could not save",
    defaultMessage: "The change could not be saved. Check the details and try again.",
    referenceLabel: "Reference",
  },
} as const

export type AppScreenKey =
  | "dashboard"
  | "projects"
  | "project"
  | "files"
  | "filesTree"
  | "lab"
  | "chat"
  | "agent"
  | "settings"

export const appScreenCopy: Record<
  AppScreenKey,
  {
    loadingLabel: string
    emptyTitle: string
    emptyBody: string
    errorTitle: string
    errorMessage: string
    skeleton: AppScreenKey
  }
> = {
  dashboard: {
    loadingLabel: "Loading dashboard",
    emptyTitle: "No projects yet",
    emptyBody:
      "Create a project to start collecting files, running lab sessions, and working with the agent.",
    errorTitle: "Dashboard did not load",
    errorMessage:
      "We could not load your dashboard. Try again to refresh projects, activity, and usage.",
    skeleton: "dashboard",
  },
  projects: {
    loadingLabel: "Loading projects",
    emptyTitle: "No projects yet",
    emptyBody:
      "Create a project to start collecting files, running lab sessions, and working with the agent.",
    errorTitle: "Projects did not load",
    errorMessage: "We could not load your projects. Try again to refresh the list.",
    skeleton: "projects",
  },
  project: {
    loadingLabel: "Loading project",
    emptyTitle: "Project is empty",
    emptyBody:
      "This project does not have files, runs, or activity yet. Add content to get started.",
    errorTitle: "Project did not load",
    errorMessage:
      "We could not load this project. Try again to refresh its details and recent activity.",
    skeleton: "project",
  },
  files: {
    loadingLabel: "Loading files",
    emptyTitle: "No files yet",
    emptyBody: "Upload a file or create a folder to start building this project's file library.",
    errorTitle: "Files did not load",
    errorMessage:
      "We could not load the file list. Try again to refresh names, sizes, and locations.",
    skeleton: "files",
  },
  filesTree: {
    loadingLabel: "Loading file tree",
    emptyTitle: "No folders yet",
    emptyBody: "Create a folder or upload files to start organizing this project.",
    errorTitle: "File tree did not load",
    errorMessage: "We could not load the file tree. Try again to refresh folders and files.",
    skeleton: "filesTree",
  },
  lab: {
    loadingLabel: "Loading lab sessions",
    emptyTitle: "No lab sessions yet",
    emptyBody: "Start a session to run code, inspect outputs, and keep a record of your work.",
    errorTitle: "Lab did not load",
    errorMessage: "We could not load lab sessions. Try again to refresh the session pane.",
    skeleton: "lab",
  },
  chat: {
    loadingLabel: "Loading chat",
    emptyTitle: "No messages yet",
    emptyBody: "Start the conversation by sending the first message in this channel.",
    errorTitle: "Chat did not load",
    errorMessage: "We could not load messages. Try again to refresh the thread and channel list.",
    skeleton: "chat",
  },
  agent: {
    loadingLabel: "Loading agent runs",
    emptyTitle: "No agent runs yet",
    emptyBody:
      "Describe a task to create the first run, then review the trace and proposed changes.",
    errorTitle: "Agent did not load",
    errorMessage:
      "We could not load agent runs. Try again to refresh the run trace and diff review.",
    skeleton: "agent",
  },
  settings: {
    loadingLabel: "Loading settings",
    emptyTitle: "No settings available",
    emptyBody: "Settings are unavailable for this workspace right now.",
    errorTitle: "Settings did not load",
    errorMessage: "We could not load settings. Try again to refresh your preferences.",
    skeleton: "settings",
  },
}
