/**
 * Cross-component signal for the dashboard's "New project" dialog: the command
 * menu sets the storage flag (survives navigation) and dispatches the event
 * (covers the case where the dashboard is already mounted).
 *
 * Lives in its own leaf module so `dashboard-screen.tsx` can listen for the
 * event without statically importing the lazily-loaded command palette.
 */
export const OPEN_NEW_PROJECT_EVENT = "spindle:open-new-project"
export const OPEN_NEW_PROJECT_STORAGE_KEY = "spindle:open-new-project"
