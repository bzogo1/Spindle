# Accessibility audit — focus, semantics, keyboard, live regions

Scope: WCAG 2.2 AA. This pass covered focus management, ARIA semantics,
keyboard traps, live regions, screen-reader support, and heading/landmark
structure. Colour contrast is audited separately (see `light-theme.md`).

Surfaces already built on Radix UI (`src/components/ui/dialog`,
`dropdown-menu`, `select`, `popover`, `context-menu`, `accordion`, `tabs`,
`tooltip`, `radio-group`, `checkbox`, `switch`, `slider`, `navigation-menu`,
`breadcrumb`, `toast`) inherit focus trapping, Escape handling, focus
return, `aria-expanded`/`aria-controls`/`aria-haspopup`, and roving
tabindex from the primitives and were verified rather than rewritten.

## Fixed in this pass

### `src/components/app/files-screen.tsx` — `FileActionDialog`

The create-folder / rename / move / trash dialog was a hand-rolled
`role="dialog"` overlay with **no focus trap, no initial focus for the
move/trash variants, no focus restoration, and no stacking coordination**.
When opened from the file-preview drawer it competed with the drawer's
Radix focus scope, so keyboard focus could be pulled back into the drawer
behind the dialog (WCAG 2.1.2 No Keyboard Trap / 2.4.3 Focus Order).

Rebuilt on `DialogPrimitive` (Root/Portal/Overlay/Content/Title) with the
existing `app-dialog-overlay` / `app-dialog` classes preserved, plus a new
`.app-dialog-content` positioning wrapper in `src/app/styles/app.css`.
`onOpenAutoFocus` focuses the name input or destination select per variant.
Escape, outside-pointer dismissal, focus trap, scroll lock, and focus
return now match every other app dialog, and it stacks correctly above the
preview drawer.

### `src/components/app/file-preview-drawer.tsx`

- Renaming a file unmounted the `DialogTitle`, leaving the Radix dialog
  without an accessible name (WCAG 4.1.2 Name, Role, Value). A visually
  hidden `DialogTitle` now stays mounted while the rename form is open.
- Exiting rename mode (Escape / save / cancel) now returns focus to the
  rename button that opened the form.

### `src/lib/a11y/` — new shared helpers

- `focus.ts`: `FOCUSABLE_SELECTOR`, `getFocusableElements()`,
  `focusElement()`.
- `use-focus-trap.ts`: `useFocusTrap()` — activation focus, Tab cycling,
  Escape forwarding, and focus restoration for any future custom (non-Radix)
  overlay. Documented as a fallback; new overlays should use the Radix
  primitives.
- Tests: `focus.test.ts`, `use-focus-trap.test.tsx` (10 tests).

### `src/components/app/app-shell.tsx`

- Added `RouteAnnouncer`: a polite `role="status"` live region that
  announces client-side navigations ("Navigated to …") so SPA route changes
  are perceivable without visual focus cues (WCAG 4.1.3 Status Messages).
  Initial page load is not announced.

### `src/components/app/chat-screen.tsx`

- Message list is now `role="log"` (implicit `aria-live="polite"`,
  `aria-relevant="additions"`) in addition to the explicit live region —
  correct semantics for an append-only chat stream (WCAG 4.1.3).

### `src/components/app/command-menu.tsx`

- The results `listbox` now has `aria-label="Command results"`. The input
  already implements the combobox pattern (`role="combobox"`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `aria-autocomplete="list"`) and options expose `aria-selected`.

### `src/components/ui/scroll-area.tsx`

- The custom scroll viewport is now `tabIndex={0}` so keyboard users can
  focus it and scroll with arrow keys (WCAG 2.1.1 Keyboard). Consumers can
  still override via props.

## Verified — no changes needed

| Surface                                          | Findings                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/dialog`, `bottom-sheet`, `mobile-nav-drawer` | Radix Dialog: focus trap, Escape, focus return, `aria-modal`, scroll lock all present.                                                                                                                                                                                 |
| `ui/dropdown-menu`, `context-menu`               | Radix menu semantics, typeahead, focus return.                                                                                                                                                                                                                         |
| `ui/select`, `async-select`                      | Combobox/listbox pattern with `aria-activedescendant`, typeahead, `aria-multiselectable`, labelled search box.                                                                                                                                                         |
| `ui/date-picker`                                 | `role="grid"` day picker with `aria-activedescendant`, full arrow-key nav, `aria-current="date"`, labelled month/year selects, `role="alert"` for invalid range input.                                                                                                 |
| `data-grid`                                      | `role="grid"` with `aria-rowcount`/`aria-colcount`/`aria-selected`, roving `tabIndex`, `aria-sort` on headers, `aria-live` region for announcements.                                                                                                                   |
| `app-shell`                                      | Skip link → `#main-content` (in `(app)/layout.tsx`), labelled `<nav>` landmarks, `aria-current="page"` on active nav, labelled icon buttons, `aria-expanded` on sidebar collapse.                                                                                      |
| `command-menu`                                   | ⌘K toggle, combobox semantics, `role="status"` loading state, footer key hints.                                                                                                                                                                                        |
| `notification-bell`                              | Popover with labelled trigger including unread count, `aria-label` on content.                                                                                                                                                                                         |
| `project-switcher`                               | Combobox + listbox with `aria-activedescendant` and labelled create-project input.                                                                                                                                                                                     |
| `files-screen`                                   | Labelled toolbar inputs, `role="table"` headers, `aria-pressed` view toggle, `role="progressbar"` storage/upload meters, `aria-live` upload queue, labelled checkboxes and row-action menus.                                                                           |
| `chat-screen`                                    | Labelled composer (`sr-only` label + `aria-label` on attach), labelled channel buttons, `aria-current` on active channel, `role="alert"`-style failure retry.                                                                                                          |
| `agent-run-log-screen`, `agent-run-stream-panel` | `role="log"` entry list, labelled filter selects/inputs, `role="status"` live indicators, approval cards with labelled actions.                                                                                                                                        |
| `auth/*`, `site/auth/*`                          | All inputs have associated `<Label htmlFor>` or `aria-label`, `autoComplete` set (`email`, `current-password`, `new-password`), errors use `role="alert"` + `aria-invalid` + `aria-describedby`, success states move focus to headings, live regions on status panels. |
| `states/*`                                       | `role="alert"` error states, `role="status"`/`aria-busy` loading panels, labelled empty states.                                                                                                                                                                        |
| Settings/team/projects dialogs                   | All use `DialogContent` with `DialogTitle`/`DialogDescription` and labelled fields.                                                                                                                                                                                    |

## Remaining / out of scope

- **`role="table"` in `files-screen` list view** uses `role="row"`/`columnheader`
  but data cells are plain `<span>`s without `role="cell"`/`row`. Low impact
  (the open button carries the row's accessible name); a full grid
  conversion is a larger refactor.
- **`command-menu` empty state** renders a `<p>` inside `role="listbox"`;
  technically listbox children should be options/groups. Cosmetic for most
  screen readers.
- **Fake `<table>`-free data views** elsewhere rely on headings/lists —
  acceptable.
- Focus **visibility** styling and colour contrast are covered by the
  contrast-audit workstream, not this report.
- `useFocusTrap` is currently unused by production code (kept as the
  documented fallback for custom overlays); it is covered by unit tests.
