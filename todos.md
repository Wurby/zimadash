# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

Phase 0 (foundation) and Phase 1 (the shell) are complete and their loose ends
are closed — routing, the tool registry, refresh tiers, the header, per-tool
PWAs, and the tile grid all exist and are verified on device.

---

## Phase 2 — the calorie tracker

The first genuine tool, and the proof the registry works. Free, ad-free, no
bloat, no upsell — MacroFactor's shape without the price.

### Persistence

- [ ] Flat JSON, one file per month (`calories/2026-08.json`) in `DATA_DIR`.
      Roughly 2,000 entries a year, a few hundred KB — a database is machinery
      this doesn't need, and the only dependency-free option (`node:sqlite`) is
      still experimental
- [ ] `version` field per file plus migrate-on-read — the migration story

### The brain

- [ ] `claude -p` via the CLI already installed and authenticated on the box, so
      it runs on the existing subscription rather than a metered API key
- [ ] Server stamps the time so the estimate knows breakfast from dinner
- [ ] Returns every configured field **plus a one-line statement of what it
      assumed** — correcting a stated assumption converges in one round, guessing
      at what it got wrong takes three
- [ ] Store the description and the raw response, not just the numbers, so
      history can be re-estimated if the prompt improves later
- [ ] Unavailable means error and log nothing. No fallback to a plain number
- [ ] Malformed output retries once, then errors. One call at a time

### Entry

- [ ] Home-screen PWA at `/calories` opens with the keyboard up on a magic
      input. A whole-string number is calories; anything else is a description
- [ ] Description → estimate → save, hand-adjust, or give feedback for a
      contextual back-and-forth **on that entry only**
- [ ] Pending entry survives a phone lock and app-switching, and is cleared by a
      server reboot or a force-close — the thread lives in server memory, the
      client holds a reference that dies with the app
- [ ] Recent meals: tap a previous entry to log an identical one, no brain call

### Fields

- [ ] Calories, protein, fat, carbs, fibre — permanent, never removable
- [ ] User-defined fields: free-text name, free-text unit, chosen color. Every
      configured field is required of the brain
- [ ] Toggling a field off keeps its data; deleting takes the data, on confirm
- [ ] Optional goal per field, drawn as a reference line on that field's graph
- [ ] Per-field colors are set by the user — a tool's data colors are exempt from
      the slate/sky rule

### Tabs

- [ ] **Main** — magic input, full day summary across every field, plus any
      graphs promoted here from Reports
- [ ] **Reports** — a daily-total graph per field; range selector across week,
      2-week (default), month, quarter, half, year; "average over range" per
      field
- [ ] **Log** — every meal in a row, about two weeks visible. Overwrite numbers
      by hand (no re-running the brain), delete a row
- [ ] **Settings** — goals, field management, colors, which fields show on the
      tile

### Elsewhere

- [ ] Tile: day summary plus latest meal, fields chosen by checkbox, defaulting
      to calories and macros
- [ ] The day rolls over at 4am on the server clock. Timezone is explicitly not
      a concern

---

## Phase 3 — the grid

Nothing here touches the calorie tracker; it ships on the grid that exists.

- [ ] Sizes become relative spans of available width rather than fixed pixels —
      `1x1`, `2x2`, `4x4`, `4x8`, `8x4`, `8x8`
- [ ] Any tool, action, or badge can be assigned any of those sizes
- [ ] Anything can be moved anywhere — tiles, actions, and the stats badge stop
      being separate systems and become one grid
- [ ] Remove nav entirely once that lands

---

## Someday / maybe

- [ ] Apple Health integration for the calorie tracker

- [ ] Server-sent events instead of polling, mainly for the wall display
- [ ] E Ink display mode — high contrast, no color-only meaning, no motion.
      Watching the space; not a constraint today
- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Habit tracker
- [ ] Write a real `actions.json` (Homebridge scenes, robovac). The plumbing is
      done and untested against a live endpoint; no action is configured yet
