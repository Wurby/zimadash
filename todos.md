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

Everything needed before the first real tool can be written. Roughly in order.

### Routing

- [ ] Add a router; every tool gets its own URL (`/calories`, `/habits`)
- [ ] Homepage at `/` is the tile grid
- [ ] Back arrow inside each tool returns to `/` — the header is not navigation
- [ ] 404 route for an unknown tool slug

### Tool registry

- [ ] Define the tool contract: slug, display name, icon, tile component, view
      component, refresh tier
- [ ] Convention-driven registration — drop a folder in `src/tools/<slug>/` and
      it appears on the homepage without editing a central list
- [ ] Server-side counterpart: a tool can register its own `/api/tools/<slug>`
      routes without `server/src/index.ts` growing a branch per tool
- [ ] Keep tools isolated enough to lift into their own repo later — no tool
      imports another tool

### Refresh tiers

- [ ] Implement `live` / `ambient` / `event-driven` as a shared hook
- [ ] One scheduler for all tiles rather than a timer per component
- [ ] Server cache TTL derives from the tier, so the two can't drift apart again
- [ ] Later: swap polling for server-sent events, mainly for the wall display

### Header

- [ ] Header component: light/dark toggle writing to `zimadash.theme`
- [ ] System stats become an expandable header panel — tap to expand, tap away
      to collapse. No `/system` route; delete the stats view from the homepage
- [ ] Quick-action contract: icon, label, endpoint
- [ ] Tapped action swaps its icon for a checkmark for 5 seconds
- [ ] Server-side action proxy — credentials live in `DATA_DIR`/env on zima, the
      browser never holds a secret
- [ ] Decide whether destructive actions need a confirm (robovac by pocket-tap)

### PWA

- [ ] Web app manifest per tool — distinct icon and `start_url` so a single tool
      installs to the phone home screen on its own
- [ ] Icon set and theme colors for light and dark
- [ ] Verify install works from iOS Safari, which is fussy about this

### Homepage

- [ ] Tile grid that reads well on a phone and scales to a wall display
- [ ] Tiles render live data at rest — a tile is informative before you tap it
- [ ] Empty and error states for a tile whose data won't load

### Housekeeping

- [ ] Share types between client and server — `Stats` is currently declared twice
      ([src/App.tsx](src/App.tsx) and [server/src/types.ts](server/src/types.ts))
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
