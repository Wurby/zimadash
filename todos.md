# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

Phase 0 (foundation), Phase 1 (the shell) and Phase 2 (the calorie tracker) are
complete and their loose ends are closed. The registry proved itself: the
calorie tool needed one line outside its own folder, and picked up a route, a
tile, a manifest and an install identity by convention.

The tracker went past its original plan and now also does: estimates from a
photograph, correcting a logged meal by describing what was wrong rather than
retyping numbers, a macro-derived calorie figure offered as a suggestion, and
one-tap re-logging of recent meals.

Phase 4 (weight and the adaptive target) is done: weigh-ins, a smoothed trend,
expenditure learned from actual intake against actual weight movement, a target
that holds steady at goal, and a non-destructive baseline reset.

Phase 3 (the grid) is done as well. The header is gone; tools, actions, the
theme toggle and the system readout all live on one grid whose unit is measured
per surface, and the arrangement is yours to drag. Per-device layouts were
deliberately left out — one shared order packs differently on each screen — and
so was the permanent edit button's placement, which is worth revisiting once the
dashboard has more on it.

---

## Phase 5 — edit all history

- [ ] The Log tab stops at a fortnight. Reach any entry, not just recent ones —
      a month or date-range picker rather than a fixed window

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
