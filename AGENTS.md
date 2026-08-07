# AGENTS.md

Instructions for any coding agent working in this repo. Read this before
touching anything. See [todos.md](todos.md) for what's planned and what's next.

## What this project is

**zimadash is a personal dashboard for Joshua's life** — a container for small,
one-off tools and utilities he builds for himself. A calorie counter, a habit
tracker, whatever comes next. Tools that will never exist anywhere else in the
shape he wants them.

It is **not** a homelab monitoring dashboard. The system-stats view was an MVP
placeholder and now lives as a single expandable panel in the header, which is
all the room it gets. Do not treat it as the project's purpose, and do not
extend it as though monitoring were the goal.

Off-the-shelf dashboards (Homepage, Homarr, Dashy) were evaluated and rejected:
overkill for the job, and not extensible enough for bespoke tools.

It runs on a small home server and is reachable from outside the LAN. Real
hostnames, paths, and deployment targets live in `deploy.local.env`, which is
gitignored. **This repo is public — never write a hostname, domain, IP,
username, or absolute path on the server into a tracked file.**

## The shape of the thing

**Tools are the unit of work.** Each tool is self-contained: its own route, its
own tile on the homepage, its own data. The registry is convention-driven — a
tool declares itself and the homepage picks it up. A tool must stay
**extractable**: if one outgrows the dash, it should be liftable into its own
repo without unpicking it from everything else. Don't let tools reach into each
other.

**Two surfaces, equal weight.** A phone (where most interaction happens) and a
wall-mounted iPad mini (always on, read from across the room). Design for
`sm`/`md`/`lg` properly — neither is the afterthought. Aim for a
data-visualization aesthetic rather than plain text readouts.

**The header is actions, not navigation.** Light/dark toggle, one-tap actions
that fire real side effects (Homebridge scenes, robovac), and the system-stats
panel. A tapped action swaps its icon for a checkmark for 5 seconds. Navigation
back to the homepage is a back arrow inside each tool.

Quick actions are configured in `actions.json` in `DATA_DIR`, never in this
repo — the request usually carries a credential. The browser is told an
action's id, label, and icon and nothing else; `server/src/actions.ts` makes the
call. An action marked `"confirm": true` needs a second tap before it fires.

**Each tool is its own installable PWA** — distinct icon, distinct start URL —
so a single tool can live on the phone home screen on its own.

"Add to Home Screen" reads the manifest link, apple-touch-icon, and title from
the document **as delivered**, so those tags cannot be corrected from React
after the fact. `server/src/appShell.ts` rewrites them per URL before sending
the shell, and the Vite dev middleware does the same, so a tool installs
identically in dev and production. Adding a tool needs no work here — the tool
list is read from the generated manifests.

**An installed app keeps the shell it was installed with.** Changing a
manifest, an icon, a `<meta>`, or the safe-area handling will not show up on a
phone that already has the tool on its home screen — it has to be removed and
re-added. Deploying is not enough, so test those changes on a fresh install or
you will be debugging something you already fixed.

iOS also draws the web view under the status bar while sometimes reporting
`env(safe-area-inset-top)` as 0, which is why the header floors its top padding
behind the `installed-phone` variant in `src/index.css`.

## Refresh tiers

There is no single global refresh interval. Data is polled at the cadence it
actually changes:

| Tier           | Cadence | For                                            |
| -------------- | ------- | ---------------------------------------------- |
| `live`         | 5s      | System stats — anything genuinely in motion    |
| `ambient`      | 60s+    | Weather, calendar — a minute stale is fine     |
| `event-driven` | never   | Self-entered data; refetch after you mutate it |

Polling **pauses when the tab is hidden**. A server-side cache must never be
slower than the client tier it feeds, or the client re-fetches values that
cannot have changed.

These intervals live in `server/src/shared/tiers.ts` and are read by both sides,
so they cannot drift apart. Use `usePolled(tier, fetcher)` from
`src/lib/refresh.ts` rather than a `setInterval` in a component — there is one
timer per tier for the whole app, so tiles tick together instead of shimmering
out of step on the wall display.

## Persistence — read this before writing any file

`scripts/deploy.sh` rsyncs with `--delete`. **The deploy directory on zima is
wiped to match the local build on every deploy.** Anything written inside it is
destroyed.

All persistent state goes in `DATA_DIR` (`server/src/paths.ts`) — by default
`~/zimadash-data`, outside the artifact, overridable with `ZIMADASH_DATA_DIR`.
Use `readJson`/`writeJson` from `paths.ts`; they write atomically with `0600`.
A real database will land here eventually (likely NoSQL) — the directory
boundary exists so that migration is safe.

## Auth

One universal user, one PIN. There are no accounts and no roles. The PIN is set
on first visit and persists; the login screen is a **single PIN field** — no
confirm box, no username.

Read `server/src/auth.ts` for how it works. Rules that must hold:

- The PIN is never stored in plaintext, and its record lives in `DATA_DIR` so a
  deploy cannot destroy it.
- Everything under `/api` is gated except `/api/health` and `/api/auth/*`.
- **`/api/health` must stay unauthenticated** — `scripts/deploy.sh` curls it to
  verify a deploy and has no token.
- This faces the public internet behind nothing but a PIN. Don't weaken the
  throttling, and don't add an endpoint that leaks whether a guess was close.
- Throttling has to hold **without trusting the caller**. Anything keyed off a
  request header is friction only — the caller writes those. The guarantee comes
  from state the caller cannot influence, it survives a restart, and it must
  never be something a stranger can trigger to lock the owner out.

**Do not document auth internals** in `README.md`, this file, or `todos.md` —
no storage format, no session lifetime, no lockout thresholds. The repo is
public; the docs should not be a cheat sheet. Session lifetime in particular is
a deliberate design choice and is not to be described in any tracked file.

## Stack

- React 19 + TypeScript + Vite, Tailwind v4 (`@theme inline` tokens in
  `src/index.css`, class-based dark mode seeded by an inline script in
  `index.html` so the wall display never flashes)
- Express + `systeminformation` in `server/`, its own `package.json`
- One process serves both the API and the built frontend from `dist/`. No proxy.

### Color — slate and sky only

Every token in `src/index.css` is a stock Tailwind slate or sky — with one
deliberate exception: `--danger` is rose, because an error that shares the
accent's hue cannot be told apart from a success at a glance. Each token names
its shade in a comment beside the value.

Don't introduce a fourth hue, a bespoke palette, or a bare `text-white` — reach
for a token, or a slate/sky shade if you genuinely need one the tokens don't
cover. Hex colors in the PWA manifests and `index.html` are those same shades
written out, because neither format can take a CSS variable.

**A tool's own data colors are exempt.** A chart series or a per-macro bar has to
be told apart at a glance, and that needs hue. Those colors belong to the tool —
picked by the user where it makes sense — and don't come out of the tokens. The
chrome around them still does.

Anything that should read as **lifted off the page** — a homepage tile, the
stats badge, an action button — is `bg-surface` with a `border-line` border on
the `bg-bg` page. That one relationship is what makes them a family.

**Corners are square.** No `rounded-*` anywhere, and no `rx` on the SVGs. If you
add a surface, it gets hard edges like everything else.

**Titles run vertically.** A homepage tile and the stats badge both put their
title in a slate band flush to the left edge (`bg-slate-200 dark:bg-slate-800`,
`[writing-mode:vertical-rl]` plus `rotate-180` so it reads bottom-to-top). The
band is the element's left padding — don't add padding beside it. `vertical-rl`
rotates the line rather than stacking glyphs upright, so a title costs its
normal text width along the element's _height_, and only its line box of width.

Adjacent surfaces are judged by perceptual lightness delta, not WCAG ratio; text
pairs are judged by ratio and must clear 4.5:1 in **both** themes. `sky-600`
fails that on a light surface at 3.84:1, which is why the light accent is
`sky-700`.

## Layout

```text
src/
  App.tsx             route table: / , /:slug/* , 404
  lib/api.ts          every API call — attaches the token, handles 401 in one place
  lib/refresh.ts      tier scheduler + usePolled — ONE timer per tier, app-wide
  lib/theme.ts        light/dark, class-driven on <html>
  lib/pwa.ts          swaps the manifest <link> per route
  auth/AuthGate.tsx   PIN unlock, wraps the app
  components/         Header, StatsPanel, QuickActions, Icon, Meter
  routes/             Home (tile grid), ToolShell (back arrow), NotFound
  tools/types.ts      the tool contract
  tools/registry.ts   import.meta.glob auto-registration
  tools/<slug>/       meta.json + tool.tsx — one folder per tool
server/src/
  index.ts            routes, auth gate, static serving, tool mounting
  auth.ts             the PIN gate
  paths.ts            DATA_DIR — persistent state, outside the artifact
  cache.ts            stats polling loop
  actions.ts          quick-action proxy — credentials never reach the browser
  appShell.ts         per-tool install metadata, rewritten before the shell ships
  shared/             types.ts, tiers.ts, appShell.ts — imported by BOTH sides
  tools/registry.ts   the one list of server-side tools
  tools/<slug>.ts     a tool's /api/tools/<slug> routes
scripts/
  dev.mjs             starts the API and Vite together — what `npm run dev` runs
  deploy.sh           build locally, rsync artifact to the server
  vite-tool-manifests.ts  emits a PWA manifest + icon per tool at build time
deploy/               service.template — systemd user unit, rendered at deploy time
deploy.local.env      real deploy target — GITIGNORED, never commit
```

### Adding a tool

Create `src/tools/<slug>/` with a `meta.json` and a `tool.tsx` that
default-exports `defineTool({ meta, tier, Tile, View })`. That is the whole
registration — it gets a route, a homepage tile, and its own PWA manifest with
no central list to edit. The slug must equal the folder name or the registry
throws at startup.

If it needs server routes, add `server/src/tools/<slug>.ts` exporting
`{ slug, router }` and put it in `server/src/tools/registry.ts`. It owns
everything under `/api/tools/<slug>` and nothing outside it.

**Cross-boundary code goes in `server/src/shared/`** — it sits inside the
server's `rootDir` so `tsc -p server` still emits a flat `dist/`, and the
frontend reaches it through the `@shared/*` alias. Keep it free of Node
built-ins and browser globals.

## Commands

| Command              | Does                                               |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | API :3107 + Vite :5173 together, ctrl-c stops both |
| `npm run dev:server` | Backend only, watch mode                           |
| `npm run dev:web`    | Vite only — `/api` 502s without the backend        |
| `npm run build:all`  | Type-check + build frontend and server             |
| `npm run lint`       | ESLint                                             |
| `npm run format`     | Prettier                                           |
| `npm run deploy`     | Full build + ship to the server (see README)       |
| `npm run deploy:dry` | Stage and show the rsync diff, change nothing      |

## Conventions

- Run `npm run lint` and `npm run build:all` before claiming work is done.
- Prettier owns formatting; ESLint's `eslint-config-prettier` must stay last in
  `eslint.config.js`.
- Frontend is semicolon-free, server keeps semicolons (see `.prettierrc.json`).
- `tsconfig` has `erasableSyntaxOnly` — no parameter properties, no enums.
- Never call `fetch` directly from a component. Go through `src/lib/api.ts` so
  the token and the 401-bounce stay in one place.
- Only add **pure JavaScript** server dependencies. The deploy ships
  `server/node_modules` resolved on macOS to a Linux box and aborts if it finds
  a `.node` binary. Node built-ins (`crypto`, `fs`) are always fine.

## Deploy model

The server holds a pre-built artifact and runs it under systemd. No git clone,
no CI runner, no `npm` on the box — everything happens in `scripts/deploy.sh` on
the laptop. The unit is generated from `deploy/service.template` using the
values in `deploy.local.env`; push it with
`npm run deploy -- --install-service` and never hand-edit the copy on the box.

Full deploy, SSH, and troubleshooting detail lives in [README.md](README.md).

## Working agreements

- **Never run the dev server.** `npm run dev` starts both the API and Vite, and
  Joshua runs it himself — he wants to stay in control of those processes.
  Don't start, restart, or kill them, and don't start the halves individually
  either.
- **Never drive the browser unprompted.** Playwright (and any other browser
  automation) is only for when Joshua has explicitly approved it. He prefers to
  do the testing himself and be told _when_ and _how_ to test. Ask about testing
  only once all building is finished, as the final step.
- **Don't commit after every change.** `npm run deploy` stages, commits, and
  pushes whatever is outstanding, so per-change commits are noise. Leave work in
  the tree and let the deploy sweep it up. Commit by hand only when the tree is
  about to be disturbed — a history rewrite, a branch switch, or a change big
  enough that you'd want to revert it on its own later. The remote is
  `git@github.com:Wurby/zimadash.git`.
- **Ask before widening scope.** Don't infer features from what already exists —
  most of what exists is placeholder.
- Keep `README.md` (human-facing), this file (agent-facing), and `todos.md`
  (plan) in sync when the architecture changes.
- E Ink is watched with interest but is **not** a constraint. Don't sacrifice
  polish on the screens that exist for a display that doesn't.
