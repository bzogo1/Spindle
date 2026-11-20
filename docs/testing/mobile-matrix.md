# Mobile testing matrix

Playwright device-matrix suite for phone-sized viewports. Config:
`playwright.mobile.config.ts`; specs: `e2e/mobile/`.

Where `e2e/viewport-matrix.spec.ts` sweeps fixed CSS widths on desktop
emulation, this suite runs the same class of checks on **real device
descriptors** — viewport, device pixel ratio, touch, and mobile user agent —
so media queries, `100svh` layout, safe-area insets, and touch-only code paths
behave as they do on hardware.

## Device matrix

| Project           | Device profile | Viewport | DPR   | Engine / UA        |
| ----------------- | -------------- | -------- | ----- | ------------------ |
| `chromium-mobile` | Pixel 7        | 412×915  | 2.625 | Chromium, Android  |
| `webkit-mobile`   | iPhone 13      | 390×844  | 3     | WebKit, iOS Safari |

Both projects run every spec in `e2e/mobile/`. Each test gets a fresh browser
context (cookies, localStorage, consent state never leak). The suite boots its
own dev server with `NEXT_PUBLIC_MOCK_AUTH=1`, same as `playwright.config.ts`.

## Breakpoints the specs depend on

The codebase uses **custom px breakpoints**, not Tailwind's defaults
(Tailwind v4 is loaded for utilities/tokens only — `sm:`/`md:`/`lg:`/`xl:` map
to 40/48/64/80rem respectively, but most layout switches are hand-written
`@media` rules):

| Breakpoint | What changes                                                                                          | Source                                            |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| ≤1100px    | App content grids (dashboard/project/stat/chat/agent), automations/collaboration multi-column layouts | `app.css`, `automations.css`, `collaboration.css` |
| ≤1000px    | Marketing feature grid → 2 columns, integrations stack                                                | `styles.css`                                      |
| ≤900px     | **App shell:** sidebar hidden, `.app-drawer-trigger` shown, content re-padded                         | `app.css` (`MobileNavDrawer`)                     |
| ≤860px     | **Marketing header:** desktop `NavigationMenu` hidden, `#menuToggle` + `#mobileNav` panel shown       | `styles.css`, `site-header.tsx`                   |
| ≤768px     | Tailwind `md:` utilities (rare in hand-written CSS)                                                   | Tailwind defaults                                 |
| ≤720px     | Agent screen, app lab/settings compaction                                                             | `agent.css`, `app.css`                            |
| ≤640px     | App topbar compacts (titles/kbd hints hidden), collaboration single column                            | `app.css`, `collaboration.css`                    |
| ≤520–560px | Accessibility tweaks, automations small-phone rules                                                   | `accessibility.css`, `automations.css`            |
| ≤480px     | Auth card padding, infrastructure hero compaction                                                     | `auth.css`, `infrastructure.css`                  |
| ≤440px     | Automations smallest breakpoint                                                                       | `automations.css`                                 |

Specs guard themselves with `isMobileViewport()` (≤900px, see
`e2e/mobile/helpers.ts`): the desktop `chromium` project in
`playwright.config.ts` also collects `e2e/mobile/` (its `testDir` is `./e2e`
and only `visual/` + `storybook-visual/` are ignored), so every mobile spec
**skips** on the 1280px desktop viewport instead of failing. Running
`npx playwright test` therefore still works — mobile specs simply report as
skipped there.

## What the specs cover

`e2e/mobile/site-nav.spec.ts` — marketing header:

- Hamburger (`#menuToggle`) toggles `#mobileNav.open` + `aria-expanded`;
  desktop `.nav-desktop-slot` is hidden at phone widths.
- Escape and outside-tap dismiss the panel (src/lib/interactions/site.js).
- Panel links navigate and auto-close; the "Search site" button opens the
  command palette (`SITE_SEARCH_OPEN_EVENT`); the sign-up CTA is inside the
  panel because the header hides its own at phone widths.
- Tap targets (`#menuToggle`, `.ui-mobile-link`, CTA) ≥ 24px (WCAG 2.2 AA
  minimum pointer target).

`e2e/mobile/app-shell.spec.ts` — `(app)` shell (mock-session cookie via
`signInToMockApp` from `e2e/visual/visual-helpers.ts`):

- `.app-sidebar` hidden, `.app-drawer-trigger` opens the Radix `MobileNavDrawer`
  (`.app-drawer`, `role="dialog"`); Escape and the "Close navigation" button
  dismiss it.
- Edge-swipe gestures: synthetic non-mouse `PointerEvent`s exercise the
  right-swipe-from-left-edge open and left-swipe close handlers
  (`EDGE_OPEN_PX`/`SWIPE_THRESHOLD_PX` in `mobile-nav-drawer.tsx`).
- Tap targets: drawer trigger, topbar icon buttons, drawer nav links ≥ 24px.

`e2e/mobile/forms.spec.ts` — form usability:

- `/sign-in`: `type`/`inputmode`/`autocomplete` hints for the on-screen
  keyboard; empty submit shows `.auth-error` inline alerts and stays put.
- Full sign-in flow (provisions account via `/api/auth/signup`, same as
  `critical-flows.spec.ts`) lands on `/dashboard`.
- `/contact`: field semantics, empty submit → `.form-alert--summary` +
  per-field errors with focus on `#contact-name`, then a real POST to
  `/api/contact` → `.form-success` "Message sent." (the route returns ok even
  without Resend configured — submission is logged only).

`e2e/mobile/viewport.spec.ts` — rendering:

- `expectNoHorizontalOverflow` (helpers.ts) on 13 public/auth routes and 4
  `(app)` routes at the real device viewport/DPR — the device-width
  counterpart of the viewport-matrix sweep.

## Running

```bash
# Everything on both devices (boots its own dev server on :3000)
npx playwright test -c playwright.mobile.config.ts

# One device
npx playwright test -c playwright.mobile.config.ts --project=chromium-mobile
npx playwright test -c playwright.mobile.config.ts --project=webkit-mobile

# One spec / one test
npx playwright test -c playwright.mobile.config.ts e2e/mobile/site-nav.spec.ts
npx playwright test -c playwright.mobile.config.ts -g "edge swipe"

# List without running
npx playwright test -c playwright.mobile.config.ts --list

# Against an already-running server (dev or prod build with mock auth)
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test -c playwright.mobile.config.ts
```

Notes:

- WebKit on Linux CI needs `npx playwright install-deps webkit` (or
  `npx playwright install --with-deps webkit`) for system libraries; the
  browser binaries themselves come from `npx playwright install`.
- `--project` names are `chromium-mobile` / `webkit-mobile` (not "Mobile
  Chrome"/"Mobile Safari" like the cross-browser config).

## Manual checklist

Automation covers layout/nav/forms at two phone sizes; these need a real
device or emulator session:

- [ ] Safe-area insets: notch/home-indicator don't overlap the marketing
      header, mobile panel, or app topbar (check `env(safe-area-inset-*)`
      usage on physical iPhone/Android).
- [ ] On-screen keyboard: opening it on `/sign-in` and `/contact` doesn't
      hide the focused field or the submit button (`100svh`/`interactive-widget`
      behavior differs per engine).
- [ ] Pull-to-refresh / overscroll doesn't trap inside the open nav drawer
      or command palette.
- [ ] Real touch feel: drawer edge-swipe and hamburger tap latency on a
      mid-range Android (the synthetic-pointer spec covers logic, not feel).
- [ ] iOS Safari quirks: `100svh` toolbar collapse on scroll, input zoom on
      focus (font-size < 16px inputs auto-zoom — check auth/contact fields),
      momentum scrolling in the mobile nav panel.
- [ ] Orientation: rotate to landscape — drawer and marketing panel still
      usable, no horizontal overflow (the viewport spec only tests portrait).
- [ ] PWA install prompt / standalone mode on Android Chrome and iOS Safari
      (`src/components/pwa/`).
