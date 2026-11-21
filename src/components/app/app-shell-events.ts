/**
 * Cross-component signals for the app shell, following the same pattern as
 * ./new-project-events: window events let lazily mounted or sibling
 * components talk without prop drilling through AppShell.
 */

/** KeyboardShortcuts dispatches this on "/"; PageSearch focuses its input. */
export const FOCUS_PAGE_SEARCH_EVENT = "spindle:focus-page-search"

/**
 * HelpDialog and the command menu dispatch this; KeyboardShortcuts listens
 * and opens the shortcuts help dialog it owns.
 */
export const OPEN_SHORTCUTS_EVENT = "spindle:open-shortcuts"
