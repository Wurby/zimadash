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

## Phase 6 — Homebridge

A tool tile for the house. Needs a grill-me before building — the questions
below are the ones that would change the shape of it, not details.

**What already exists to build on.** `server/src/actions.ts` proxies a
configured HTTP request from the server so a credential never reaches the
browser, and `actions.json` in `DATA_DIR` is where such a credential would live.
Firing a Homebridge scene is already possible today as a 1x1 quick action with
no new code — the someday item about writing a real `actions.json` covers that.
So this phase is only worth doing for what a quick action _can't_ do.

**The fork that decides everything.** Does the tile only _fire_ things, or does
it _show state_ — which lights are on, what the thermostat reads, whether a door
is open? Firing is what already exists. Showing state means polling Homebridge
on a tier, holding a view of the house, and handling the case where the bridge
is unreachable. Those are different tools.

**Other questions to settle first:**

- [ ] How it talks to Homebridge. Its UI exposes an HTTP API behind a token,
      which is straightforward; speaking HomeKit directly is not. Whichever it
      is, the token belongs in `DATA_DIR` and the browser never sees it
- [ ] Which accessories appear, and whether that's a fixed list you configure or
      everything the bridge reports
- [ ] Refresh tier. State that's shown has to be polled — probably `ambient`,
      but a light you just toggled needs to look right immediately, which
      argues for a refetch after mutating rather than waiting for a tick
- [ ] What it looks like at tile size versus opened, given the wall display is
      the surface most likely to want it
- [ ] What happens when the bridge is down — a stale view is worse than an
      honest one for something that controls the house

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
