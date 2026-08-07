# AGENTS.md

Instructions for any coding agent working in this repo. Read this before
touching anything. See [todos.md](todos.md) for what's planned and what's next.

## What this project is

**zimadash is a personal dashboard for Joshua's life** — a container for small,
one-off tools and utilities he builds for himself. A calorie counter, a habit
tracker, whatever comes next. Tools that will never exist anywhere else in the
shape he wants them.

It is **not** a homelab monitoring dashboard. The system-stats view that
currently fills the page was an MVP placeholder, and it is on its way to
becoming a single expandable panel in the header. Do not treat it as the
project's purpose, and do not extend it as though monitoring were the goal.

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

**Each tool is its own installable PWA** — distinct icon, distinct start URL —
so a single tool can live on the phone home screen on its own.

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

## Layout

```text
src/
  lib/api.ts        every API call — attaches the token, handles 401 in one place
  auth/AuthGate.tsx PIN setup + unlock, wraps the app
server/src/
  index.ts          routes, auth gate, static serving
  auth.ts           PIN hashing, session tokens, lockout
  paths.ts          DATA_DIR — persistent state, outside the artifact
  cache.ts          stats polling loop
deploy/             service.template — systemd user unit, rendered at deploy time
scripts/deploy.sh   build locally, rsync artifact to the server
deploy.local.env    real deploy target — GITIGNORED, never commit
```

## Commands

| Command                       | Does                                              |
| ----------------------------- | ------------------------------------------------- |
| `npm run dev`                 | Vite dev server on :5173, proxies `/api` to :3107 |
| `npm --prefix server run dev` | Backend in watch mode                             |
| `npm run build:all`           | Type-check + build frontend and server            |
| `npm run lint`                | ESLint                                            |
| `npm run format`              | Prettier                                          |
| `npm run deploy`              | Full build + ship to the server (see README)      |
| `npm run deploy:dry`          | Stage and show the rsync diff, change nothing     |

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

- **Never run the dev server.** Joshua keeps `npm run dev` and the backend
  running himself and wants to stay in control of them. Don't start, restart, or
  kill them.
- **Never drive the browser unprompted.** Playwright (and any other browser
  automation) is only for when Joshua has explicitly approved it. He prefers to
  do the testing himself and be told *when* and *how* to test. Ask about testing
  only once all building is finished, as the final step.
- **Commit after every approval.** When Joshua approves a change, commit it
  before moving on. The remote is `git@github.com:Wurby/zimadash.git`.
- **Ask before widening scope.** Don't infer features from what already exists —
  most of what exists is placeholder.
- Keep `README.md` (human-facing), this file (agent-facing), and `todos.md`
  (plan) in sync when the architecture changes.
- E Ink is watched with interest but is **not** a constraint. Don't sacrifice
  polish on the screens that exist for a display that doesn't.
