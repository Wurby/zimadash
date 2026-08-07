# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — foundation (done)

- [x] Replace oxlint with ESLint + Prettier
- [x] Tailwind v4 with light/dark theme tokens, class-based, no flash on load
- [x] `DATA_DIR` outside the deploy artifact so `rsync --delete` can't eat it
- [x] PIN auth — single field, set on first visit
- [x] Failed-attempt throttling
- [x] `/api/health` left unauthenticated so the deploy verify still works
- [x] Keep deploy targets and infra detail out of tracked files (public repo)
- [x] Align client polling with the server cache (both 5s, the `live` tier)
- [x] Pause polling when the tab is hidden

---

## Phase 1 — the shell

Everything needed before the first real tool can be written.

### Routing

- [x] Add a router; every tool gets its own URL (`/calories`, `/habits`)
- [x] Homepage at `/` is the tile grid
- [x] Back arrow inside each tool returns to `/` — the header is not navigation
- [x] 404 route for an unknown tool slug

### Tool registry

- [x] Define the tool contract: slug, display name, icon, tile component, view
      component, refresh tier
- [x] Convention-driven registration — drop a folder in `src/tools/<slug>/` and
      it appears on the homepage without editing a central list
- [x] Server-side counterpart: a tool can register its own `/api/tools/<slug>`
      routes without `server/src/index.ts` growing a branch per tool
- [x] Keep tools isolated enough to lift into their own repo later — no tool
      imports another tool
- [x] `scratch` — a permanent tool, and the reference implementation to copy
      when starting a new one

### Refresh tiers

- [x] Implement `live` / `ambient` / `event-driven` as a shared hook
- [x] One scheduler for all tiles rather than a timer per component
- [x] Server cache TTL derives from the tier, so the two can't drift apart again
- [ ] Later: swap polling for server-sent events, mainly for the wall display

### Header

- [x] Header component: light/dark toggle writing to `zimadash.theme`
- [x] System stats become an expandable header panel — tap to expand, tap away
      to collapse. No `/system` route; delete the stats view from the homepage
- [x] Quick-action contract: icon, label, endpoint
- [x] Tapped action swaps its icon for a checkmark for 5 seconds
- [x] Server-side action proxy — credentials live in `DATA_DIR`, the browser
      never holds a secret
- [x] Destructive actions need a second tap, not a modal — `"confirm": true` in
      `actions.json`
- [ ] Write a real `actions.json` (Homebridge scenes, robovac) — the plumbing is
      done, but no action is configured yet

### PWA

- [x] Web app manifest per tool — distinct icon and `start_url` so a single tool
      installs to the phone home screen on its own
- [x] Generated icon per tool from its `meta.json` color and glyph
- [ ] Real icon art. The generated SVGs are placeholders, and iOS wants a PNG
      `apple-touch-icon` — the current SVG one may not take
- [ ] Verify install works from iOS Safari, which is fussy about this

### Homepage

- [x] Tile grid that reads well on a phone and scales to a wall display
- [x] Tiles render live data at rest — a tile is informative before you tap it
- [x] Empty and error states for a tile whose data won't load

### Housekeeping

- [x] Share types between client and server — one declaration in
      `server/src/shared/`, reached from the frontend via `@shared/*`
- [x] Rewrite README around the real project, not the stats dashboard
- [ ] Rename the systemd unit and remote dir to `zimadash` (set in
      `deploy.local.env`, then `npm run deploy -- --install-service`)
- [ ] Back up the data directory — the only thing on the server that can't be
      rebuilt from this repo
- [ ] Harden the failed-attempt throttle: the client-supplied header it keys on
      is spoofable, and the counter is in-memory so a restart clears it

---

## Phase 2 — the first real tool

- [ ] Pick the persistence layer and wire it into `DATA_DIR` (likely NoSQL)
- [ ] Migration story — how a tool's schema changes without losing data
- [ ] Calorie counter as the first genuine tool, and the proof the registry works

---

## Someday / maybe

- [ ] Server-sent events instead of polling
- [ ] E Ink display mode — high contrast, no color-only meaning, no motion.
      Watching the space; not a constraint today
- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Habit tracker
