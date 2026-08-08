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

Phase 3 (the grid) is done as well. The header is gone; tools, actions, the
theme toggle and the system readout all live on one grid whose unit is measured
per surface, and the arrangement is yours to drag. Per-device layouts were
deliberately left out — one shared order packs differently on each screen — and
so was the permanent edit button's placement, which is worth revisiting once the
dashboard has more on it.

---

## Phase 4 — weight, and a target that learns

Weight tracking inside the calorie tool, with a daily calorie target derived
from what you actually burn rather than a formula. Pounds throughout.

### The maths

- [ ] Expenditure is computed from **actual logged intake** against **actual
      trend-weight change** — never from the target. This is the part that
      matters: eat 2,800 against a 2,200 target and it correctly reads "burns
      2,800, lost nothing" and holds the target steady. Overeating cannot drag
      the number down; only under-logging can, which is what the outlier filter
      below is for
- [ ] Trend weight is a smoothed series (EWMA), not raw readings — a single
      morning weight swings pounds on water alone
- [ ] 1 lb ≈ 3,500 kcal
- [ ] Recompute **weekly**, plus a recompute-now button. Daily would move the
      number under you off what is mostly noise
- [ ] Needs **at least 7 days with both food and weight logged** before it will
      show a computed target at all. Until then it falls back to the manual goal
      and says it is still learning — no formula-from-height-and-age estimate,
      which would need details the tool doesn't ask for
- [ ] **Under-logged days are excluded**: more than 2 standard deviations below
      the rolling average, downward only. Over-logging isn't a thing; forgetting
      a snack is. Excluded days are ignored **by the expenditure maths only** —
      they stay visible in the Log and still count in Reports
- [ ] On reaching goal weight it **holds steady** — recomputes for maintenance
      rather than silently carrying on cutting

### Reset to baseline

- [ ] Marks a date; the expenditure maths ignores everything before it, so a
      stretch of bad logging can't poison the estimate forever
- [ ] **Non-destructive.** No weight reading and no food entry is ever deleted,
      and the graphs still show the full span

### Weight tab

- [ ] Enter a reading by hand, in pounds. Habit is daily before the shower, but
      once a week has to be enough — the trend is long-term
- [ ] Two readings on one day: the later one wins
- [ ] Trend graph, and the learned expenditure shown as a number — watching it
      is half the appeal
- [ ] A log of readings with edit and delete, a week or a month at a time
- [ ] Goal weight and the rate toggle — 1 / 1.5 / 2 lb per week — live here

### Elsewhere

- [ ] **Settings** gets the manual-goal-versus-computed-target toggle, showing
      both numbers beside it so the choice is informed rather than blind, and a
      checkbox for whether the weight bar appears on the tile
- [ ] **Tile**: a progress bar from starting weight to goal, labelled with
      current weight, goal weight, and the projected date at the current rate.
      It takes the place of the latest-meal line
- [ ] **Calories graph**: with the computed target on, the reference line moves
      week to week instead of sitting flat
- [ ] Weight readings get their own versioned file, migrate-on-read like entries

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
