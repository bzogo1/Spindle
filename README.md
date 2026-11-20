# Spindle — research workspace site

A dark, product-led site for a unified research platform. Every project gets its own home with
files, a live lab, local search, automations, an agent, and private team chat.

Built with **Next.js 16 (App Router)**, React 19, TypeScript, Tailwind CSS v4 + shadcn/ui, and
hand-written CSS per page. The design follows a Linear / Cloudflare-style pattern: Inter
typography, neutral graphite surfaces, one restrained green accent, left-aligned section headers,
and a consistent grid.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

`npm run typecheck` runs the TypeScript checker on its own. Every route is statically prerendered.
`npm run lint` runs ESLint, `npm test` runs the Vitest suite, and `npm run format:check` verifies
Prettier formatting (`npm run format` rewrites files). `npm run test:e2e` runs the browser smoke
test for `/infrastructure`; it expects a server at `INFRA_URL`, default
`http://127.0.0.1:3000/infrastructure`.

### CI

`.github/workflows/ci.yml` runs four jobs on every pull request and on `main`:

| Job                  | What it checks                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Formatting           | `prettier --check .` — fails on any unformatted file                                                                                |
| Unit tests           | `vitest run`                                                                                                                        |
| Database migrations  | Applies `prisma/migrations` to a throwaway Postgres, seeds it, and fails when the migrations and `prisma/schema.prisma` drift apart |
| Build and smoke test | ESLint, `tsc --noEmit`, `next build`, then the Playwright `/infrastructure` smoke test                                              |

npm and `.next/cache` are cached between runs, and a new push cancels the previous run for the same
branch.

### Sentry

Sentry is optional locally. Set `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_RELEASE` (see
the environment checklist below). `SENTRY_AUTH_TOKEN` is a CI-only secret used by
`withSentryConfig` for source-map uploads.

Session replays are aggressively masked: all text and media are hidden, and the search box, chat
composers, invite field, and auth dialog are explicitly masked or blocked.

Replay is also consent-gated. `src/lib/consent.ts` holds the cookie/storage registry and the
first-party `spindle_consent` cookie; `src/components/site/cookie-consent.tsx` renders the
first-visit banner and the settings dialog (re-openable from the footer and the changelog).
`src/instrumentation-client.ts` only adds the Replay integration after the `replay`
category is allowed, and stops recording without flushing when it is withdrawn. The banner is
mounted on both root layouts because the changelog loads the same Sentry client; it is hidden
on `/cookies` so the policy stays readable. The policy table is generated from the registry, so
a key must be added there before it can be written.

### Logging and request tracing

`src/lib/logger.ts` is the Pino JSON logger. Import `logger` from there instead of using `console`;
values are sanitised recursively before Pino writes them, so cookies, bearer tokens, API keys, signed
URL query parameters, and file contents (`content`, `fileContents`, `fileData`) become `[Redacted]`.

Wrap route handlers with `withRequestLogging` from `src/lib/request-logging.ts`:

```ts
export const POST = withRequestLogging(async (request) => {
  const session = await requireSession(request)
  setRequestLogContext(request, { userId: session.userId, projectId: session.projectId })

  return Response.json({ ok: true })
})
```

Every request then produces exactly one `api.request` line with the request id, method, path, status,
client-supplied or generated `x-request-id` (echoed on the response), duration, and the user and
project ids. Query strings are never logged. Responses with a 4xx status and thrown errors also add a
Sentry breadcrumb; `onRequestError` in `src/instrumentation.ts` still reports the exception itself.

### Environment configuration

All environment variables are declared in the Zod schemas in `src/lib/env.ts` and
`src/lib/env.server.ts`, and documented in `.env.example`. Nothing else reads `process.env`; an
ESLint rule and a CI grep enforce that.

| Variable                 | Required   | Used by                                           |
| ------------------------ | ---------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`   | Production | Canonical links, changelog feed, sharing metadata |
| `NEXT_PUBLIC_SENTRY_DSN` | No         | Browser Sentry, including session replay          |
| `DATABASE_URL`           | No         | Pooled Postgres connection; needed at runtime     |
| `DIRECT_URL`             | No         | Direct Postgres connection used by Prisma CLI     |
| `SENTRY_DSN`             | No         | Server and edge Sentry                            |
| `SENTRY_RELEASE`         | No         | Sentry release name; defaults to `spindle@1.0.0`  |
| `SENTRY_AUTH_TOKEN`      | No         | Build only: `withSentryConfig` source-map upload  |
| `NEXT_PUBLIC_MOCK_AUTH`  | No         | Enables the mock `/app` shell; set to `1`         |

The production secret contract lives in `src/lib/secrets/catalog.ts`. These values are injected at
runtime from the secret store and stay empty in `.env.example`:

| Service      | Variables                                                     | Rotation                   |
| ------------ | ------------------------------------------------------------- | -------------------------- |
| B2           | `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` | Dual key, 90 days          |
| Resend       | `RESEND_API_KEY`                                              | Provider overlap, 180 days |
| LLM provider | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`                    | Provider overlap, 90 days  |
| Postgres     | `DATABASE_URL`, `DIRECT_URL`                                  | Role overlap, 90 days      |
| Session      | `SESSION_SECRET` (+ `SESSION_SECRET_PREVIOUS`)                | Dual key, 30 days          |
| Edge HMAC    | `EDGE_HMAC_SECRET` (+ `EDGE_HMAC_SECRET_PREVIOUS`)            | Dual key, 90 days          |
| Worker       | `WORKER_SECRET` (+ `WORKER_SECRET_PREVIOUS`)                  | Dual key, 90 days          |

`next build`, `next start`, `npm run env:check -- --production`, and the production container
entrypoint validate the same schema. A missing or malformed value stops the build or container start
with one message that lists every problem variable and never prints the values.

### Mock-authenticated app shell

Setting `NEXT_PUBLIC_MOCK_AUTH=1` enables the `(app)` route group: a signed-in shell with a
collapsible sidebar (Dashboard, Projects, Files, Lab, Chat, Agent, Settings), workspace switcher,
search entry point, account menu, and theme control. `/app` redirects to `/dashboard`; project
screens live at `/projects/[projectId]/*`, while the standalone tools that would collide with
marketing pages (`/lab`, `/agent`) are namespaced under `/app/*` (`/app/files`, `/app/lab`,
`/app/chat`, `/app/agent`, `/app/settings`). The whole group is `noindex` while it is mocked.

Every authenticated screen reads through the `ApiClient` selected by `NEXT_PUBLIC_API_MODE`, so
changing the mode swaps the data source for the dashboard, project, files, lab, chat, and agent
screens alike. In mock mode they render the success case by default. Append `?mock=loading`,
`?mock=empty`, or `?mock=error` to any app URL (development and test only, while
`NEXT_PUBLIC_API_MODE=mock`) to see that screen's skeleton, zero-data, and failed-load
presentations; add `?mockLatency=<ms>` to hold the loading state long enough to inspect it.
`src/lib/api/mock-state.ts` owns the controls and `useApiQuery` applies them to every screen query.
The files, lab, chat, and agent screens use the workspace hooks built on it, which call
`api.workspace` and forward each request's `AbortSignal` so in-flight work is cancelled on unmount.
Loading panels announce `role="status"`, error panels use `role="alert"` with a support reference,
and retry re-runs the fetch in place.

The "session" is a plain cookie named `spindle_mock_session` (30-day `Max-Age`, base64url JSON)
written by `src/lib/auth/mock-session.ts`. There is no backend: `/?signin=1` opens the marketing
auth dialog, and signing in stores a mock user/workspace cookie. The `(app)` layout guard redirects
visitors without a valid cookie back to `/?signin=1`. With the flag unset, every app route
(`/dashboard`, `/projects/*`, `/app/*`) returns 404.

To inspect or seed the session locally, sign in through the dialog once, then check
DevTools → Application → Cookies for `spindle_mock_session`; deleting the cookie signs you out
(equivalently, use the account menu's **Sign out**). The provider interface in
`src/components/app/mock-session-provider.tsx` (`user`, `workspace`, `status`, `signIn`,
`signOut`) mirrors the future server session so DEV-27 can swap the implementation.

### Secrets

Production values live in Infisical Cloud, scoped per service. The container entrypoint runs
`scripts/secrets/entrypoint.sh`, which injects them with `infisical run`; no `.env` file is copied
into an image. See [`docs/decisions/0002-secrets-management.md`](docs/decisions/0002-secrets-management.md)
and [`docs/runbooks/secrets-rotation.md`](docs/runbooks/secrets-rotation.md).

```bash
npm run secrets:check              # names and shape, never values
npm run secrets:check -- --production  # require every production name
npm run secrets:verify-rotation    # both keys accepted for session, edge, worker
npm run secrets:drill              # ephemeral B2/edge overlap rehearsal
npm run secrets:scan               # no repository .env files, keys, or tokens
```

`src/lib/secrets/keyring.ts` signs with the current key and verifies with the previous key during a
rotation window. B2 retries once with the previous application key on an auth error. The CI
`secrets` job runs the repository check and gitleaks on every pull request.

### Production hosting

The origin layout is fixed by [`docs/decisions/0001-container-host-topology.md`](docs/decisions/0001-container-host-topology.md):
one self-managed Hetzner box runs the app, worker, Postgres, Valkey, and the session orchestrator,
with Cloudflare Tunnel as the only ingress and a separate staging instance.

- `infra/origin/compose.yaml` defines the production stack: app, worker, Postgres, Valkey, the
  restricted Docker socket proxy, and two tunnel connectors. Nothing publishes a public port.
- `infra/host/bootstrap.sh` installs Docker, creates the host directories and networks, and seeds
  `/srv/spindle/host.env` without overwriting an existing file.
- `.github/workflows/deploy-staging.yml` deploys every push to `main` to staging.
- `scripts/hosting/verify-topology.sh` runs the container, WebSocket, and warm-start checks from
  ADR §7 on the origin.

See [`docs/runbooks/hosting.md`](docs/runbooks/hosting.md) for provisioning, tunnel setup, staging
secrets, spending caps, and the verification procedure.

### Deployment checklist

- **CI**: set `SENTRY_AUTH_TOKEN` as a repository secret. CI supplies `NEXT_PUBLIC_SITE_URL` for the
  production build.
- **Secret store**: populate the `dev`, `staging`, and `prod` environments and give the deploy
  identity read-only access to `prod`. Do not put runtime secrets in the hosting dashboard.
- **Host**: provide `INFISICAL_TOKEN`, `INFISICAL_PROJECT_ID`, and `SPINDLE_ENV` to the entrypoint,
  then run `npm run secrets:check -- --production` before starting.
- **Local**: copy `.env.example` to `.env.local`. Development falls back to the compose Postgres
  database; a production deployment needs `NEXT_PUBLIC_SITE_URL` and the store values.

## Routes

| Route                                 | Page                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                                   | Homepage: hero, integrations, platform, automations, lab, search, files, agent, chat, collaboration, plans, CTA        |
| `/platform`                           | Full platform tour                                                                                                     |
| `/solutions`                          | Audiences and how they use Spindle                                                                                     |
| `/pricing`                            | Free allowance, team card, referral bonus                                                                              |
| `/docs`                               | Documentation, quickstart, guides, FAQ                                                                                 |
| `/about`                              | Company story and contact                                                                                              |
| `/lab`                                | Green-on-graphite Lab with dither-field hero and eight tool previews                                                   |
| `/automations`                        | Three-mode automation studio: ask AI, visual builder, raw cron                                                         |
| `/agent`                              | Agent page with run previews                                                                                           |
| `/infrastructure`                     | Privacy-first infrastructure and animated request topology                                                             |
| `/collaboration`                      | Chat, roles, shared documents, and globes                                                                              |
| `/changelog`                          | Standalone light/dark changelog                                                                                        |
| `/changelog/feed.xml`                 | RSS feed generated from the changelog data                                                                             |
| `/cookies`                            | Cookie Policy, with a table generated from the consent registry                                                        |
| `/accessibility`                      | Accessibility statement, tested scope, known gaps, and feedback contact                                                |
| `/dashboard`, `/projects/*`, `/app/*` | Mock authenticated shell (only with `NEXT_PUBLIC_MOCK_AUTH=1`): dashboard, projects, files, lab, chat, agent, settings |

> Any `dist/` directory is a stale legacy Vite artifact, not the production output. It is
> gitignored, and its `changelog.html` only links correctly inside `dist/`. The real production
> build is written to `.next/` by `npm run build`.

## Structure

- `src/app/(site)/` — root layout for the marketing pages (fonts, icon sprite, header, footer),
  plus one folder per route. Page files import only the CSS they need.
- `src/app/(changelog)/` — separate root layout for the standalone changelog, with its pre-paint
  theme script and its own stylesheet (no site header/footer).
- `src/app/(app)/` — separate root layout for the mock-authenticated shell (`/app/*`), gated on
  `NEXT_PUBLIC_MOCK_AUTH=1`; see "Mock-authenticated app shell" above.
- `src/app/styles/` — `styles.css` (tokens, layout, motion), `pages.css` (supporting pages),
  `ui.css` + `index.css` (shadcn/Tailwind layer), and one stylesheet per special page.
- `src/components/site/` — shared shell: header, navigation (desktop dropdowns + mobile panel),
  auth dialog, footer, social links, tooltip provider, icon sprite, and the interaction runners.
- `src/components/home-islands.tsx`, `lab-islands.tsx` — the shadcn/ui islands that used to mount
  into `id="ui-*"` placeholders, now rendered as regular client components.
- `src/components/ui/` — shadcn/ui components (client), reskinned in `ui.css`.
- `src/components/app/` — authenticated shell pieces: `app-shell.tsx` (sidebar, top bar, mobile
  drawer), `mock-session-provider.tsx`, `app-page.tsx`, and shared screen states.
- `src/lib/interactions/` — the original DOM behaviors (header scroll state, hero/lab tabs, search
  mode switch, file preview, agent examples, chat, automations studio, cron humanizer, lab demos,
  infrastructure trace, changelog theme) wrapped as `init*()` functions.
- `public/assets/` — changelog fonts/video/images, the Nym diagram, and the planet texture.
- `legacy/` — the original Vite HTML pages, page scripts, React entry points, `vite.config.ts`, and
  the one-time migration scripts, kept for reference.
- `docs/decisions/` — architecture decision records; `0001-container-host-topology.md` fixes the
  production container topology (DEV-7).

## How interactions work

The interactive previews are DOM-driven demos, so they run from small client components after
hydration: `SiteInteractions` handles the shell and homepage, `PageInteractions` lazy-loads a
route's script, and `ChangelogInteractions` owns the changelog. Internal links are plain anchors,
so each route loads with a clean DOM and its own demo state.

## shadcn/ui components

Installed through the shadcn CLI and reskinned in `src/app/styles/ui.css`:

| Component                                            | Where it appears                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Badge                                                | Hero announcement, synced status                                         |
| Button                                               | Hero CTAs, sign-in, plan cards                                           |
| Card                                                 | Platform features, pricing plans                                         |
| Dialog + Tabs + Input + Label + Checkbox + Separator | Header sign-in modal                                                     |
| NavigationMenu                                       | Header navigation: grouped dropdowns, direct Pricing link, active states |
| DropdownMenu                                         | File manager "New" button                                                |
| Tooltip                                              | Hero status badge, footer social links                                   |
| Switch                                               | Chat Anonymous mode (wired to the preview toggle)                        |
| Progress                                             | File manager storage meter                                               |
| Avatar                                               | Collaboration presence tag                                               |
| Alert                                                | Local search privacy note                                                |
| Accordion                                            | FAQ                                                                      |
| Magic UI DitherField                                 | Animated green hero + CTA backgrounds on `/lab`                          |
| Magic UI Globe                                       | Collaboration globes                                                     |

## Notes

- Interactions are previews/prototypes — no live search, file, agent, or chat backend is wired up.
  The sign-in dialog and FAQ are interface demos too.
- All motion respects `prefers-reduced-motion`.
- To change the palette, edit the variables at the top of `src/app/styles/styles.css` (`:root`) and
  the `--ui-*` values in `src/app/styles/index.css`.
- Changelog entries live in `src/lib/changelog.ts`; the page and the RSS feed at
  `/changelog/feed.xml` both render from that same data. Add new releases to the top of the array.
