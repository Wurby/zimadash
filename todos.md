# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

Phase 0 (foundation), Phase 1 (the shell) and Phase 2 (the calorie tracker) are
complete and their loose ends are closed. The registry proved itself: the
calorie tool needed one line outside its own folder, and picked up a route, a
tile, a manifest and an install identity by convention.

---

## Phase 3 — the grid

Nothing here changes the calorie tracker; it ships on the grid that exists.

- [ ] Sizes become relative spans of available width rather than fixed pixels —
      `1x1`, `2x2`, `4x4`, `4x8`, `8x4`, `8x8`
- [ ] Any tool, action, or badge can be assigned any of those sizes
- [ ] Anything can be moved anywhere — tiles, actions, and the stats badge stop
      being separate systems and become one grid
- [ ] Remove nav entirely once that lands

---

## Someday / maybe

- [ ] Apple Health integration for the calorie tracker
- [ ] Swap the estimator from the Claude CLI to the API if the wait annoys —
      roughly a third of the latency, at the cost of a metered key
- [ ] Server-sent events instead of polling, mainly for the wall display
- [ ] E Ink display mode — high contrast, no color-only meaning, no motion.
      Watching the space; not a constraint today
- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Habit tracker
- [ ] Write a real `actions.json` (Homebridge scenes, robovac). The plumbing is
      done and untested against a live endpoint; no action is configured yet
