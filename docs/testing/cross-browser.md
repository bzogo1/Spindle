# Cross-browser testing

Playwright cross-browser suite for browser-sensitive surfaces the chromium-only
e2e config does not cover per-engine. Config: `playwright.crossbrowser.config.ts`;
specs: `e2e/crossbrowser/`.

## Browser matrix

| Project         | Engine / device profile   | Covers                                      |
| --------------- | ------------------------- | ------------------------------------------- |
| `chromium`      | Desktop Chrome            | Baseline parity with `playwright.config.ts` |
| `firefox`       | Desktop Firefox           | Gecko form controls, `Intl`, localStorage   |
| `webkit`        | Desktop Safari            | WebKit `datetime-local`/`time` pickers      |
| `Mobile Chrome` | Pixel 7 (Chrome, touch)   | Mobile viewport + touch input paths         |
| `Mobile Safari` | iPhone 14 (Safari, touch) | iOS Safari pickers, viewport, hydration     |

All five projects run every spec in `e2e/crossbrowser/`. Each test gets a fresh
browser context, so localStorage/cookies never leak between engines.

## Running

```bash
# Everything (boots its own dev server on :3200 with NEXT_PUBLIC_MOCK_AUTH=1)
npx playwright test -c playwright.crossbrowser.config.ts

# One engine
npx playwright test -c playwright.crossbrowser.config.ts --project=webkit
npx playwright test -c playwright.crossbrowser.config.ts --project="Mobile Safari"

# One spec / one test
npx playwright test -c playwright.crossbrowser.config.ts e2e/crossbrowser/notification-schedules.spec.ts
npx playwright test -c playwright.crossbrowser.config.ts -g "weekly schedule"

# Against an already-running server (prod build or dev with mock auth)
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test -c playwright.crossbrowser.config.ts
```

Notes:

- The config uses `CROSSBROWSER_PORT` (default **3200**) rather than the base
  config's `PORT`/3000, so `reuseExistingServer` never picks up a plain
  `npm run dev` server that lacks `NEXT_PUBLIC_MOCK_AUTH=1` (app routes would
  redirect to sign-in and every `(app)` test would fail for the wrong reason).
- Caveat: `next dev` holds a per-project lock, so the suite's own webServer
  cannot boot while _any_ `npm run dev` instance is running — the port split
  prevents wrong-server reuse, it does not allow two dev servers. Stop the dev
  server first, or point `PLAYWRIGHT_BASE_URL` at a server that already has
  `NEXT_PUBLIC_MOCK_AUTH=1`. (Same limitation as `playwright.visual.config.ts`.)
- First run on a machine downloads the missing browser binaries:
  `npx playwright install chromium firefox webkit` (mobile projects reuse the
  same engine builds).
- WebKit on Linux CI needs `npx playwright install-deps webkit` (or the
  `--with-deps` flag) for system libraries.

## What the specs cover

`e2e/crossbrowser/notification-schedules.spec.ts` — `/app/account/notifications`:

- `input[type="datetime-local"]` fill → readable value → schedule row →
  localStorage (`spindle-notification-schedules`) → survives `page.reload()`
  (hydration + sanitize path in `src/lib/notifications/schedules.ts`).
- `<select>` frequency switch swaps the once-only date input for
  `input[type="time"]`; weekly summary renders `at 09:30`.
- Validation: one-shot without a date shows the inline `role="status"` error
  and keeps the typed title.

`e2e/crossbrowser/public-surface.spec.ts`:

- Referral capture: `/referral?ref=SPN-ABCD-EFGH` writes
  `spindle.referral-invite` from a post-hydration `useEffect`
  (`src/components/site/referral-tracker.tsx`).
- Sign-in: keyboard-only submit (Tab moves from the email field straight to
  the password input — `PasswordField`'s show/hide toggle follows it in tab
  order) and the invalid-credentials path.
- Files grid: `.fm-date` cells use `toLocaleDateString`; asserts non-empty,
  non-ISO output with a day number in every engine/locale.
- Marketing smoke (`/`, `/pricing`, `/docs`) with the same console/pageerror
  benign-noise filters as `e2e/route-smoke.spec.ts`.

## Known-issue triage

Failures here are usually one of:

1. **Real cross-engine bug** — e.g. a `datetime-local` value a browser can't
   parse, or a hydration mismatch that only WebKit surfaces. Fix in `src/`,
   not in the spec.
2. **Picker UI differences** — native date/time pickers render OS/browser
   chrome; specs must never click inside the picker popup. Fill the input and
   assert `toHaveValue`/the resulting state instead.
3. **Locale/Intl drift** — `toLocaleDateString`/`toLocaleString` output varies
   by engine ICU data. Assert structure (non-empty, contains digits, not raw
   ISO), never exact strings like "Jan 15" or "9:30 AM".
4. **Dev-server flakiness** — cold compiles can exceed `expect.timeout`;
   the specs already use 15s waits on first-hit headings. If a failure is a
   timeout on first navigation only, re-run before investigating.
5. **Missing system deps (WebKit on Linux)** — "error while loading shared
   libraries" means run `npx playwright install-deps`, not a code bug.

Deliberately **not** covered yet (good candidates to add):

- `src/components/ui/date-picker.tsx` — the custom calendar/range picker has
  rich keyboard navigation (`src/lib/date-picker-utils.ts`) but is currently
  only rendered in Storybook (`overlays.stories.tsx`), not on an app route.
  Once it lands on a route, add open → arrow-key → select coverage per engine.
- Drag-and-drop in the files grid (`draggable` rows) — Playwright's
  `dragTo`/manual mouse drags behave differently under touch emulation;
  needs dedicated mobile-project handling.
- `navigator.clipboard` (backup-codes panel) — requires a completed 2FA setup
  flow; clipboard permissions differ per engine and need `permissions` grants.
- Service-worker registration in `notifications-provider.tsx` — headless
  WebKit/Firefox SW support is limited; verify manually before automating.
