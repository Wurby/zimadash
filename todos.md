# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

What's next is at the top. [What's already built](#built-so-far) is at the
bottom — it's reference, not work.

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
no new code — the loose end about writing a real `actions.json` covers that. So
this phase is only worth doing for what a quick action _can't_ do.

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

## Loose ends

Gaps in things that already work. Each one has an obvious fix and none is a
project — this is the list to raid when there's an hour spare.

- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Write a real `actions.json` (Homebridge scenes, robovac). The plumbing is
      done and untested against a live endpoint; no action is configured yet
- [ ] Settle the calorie target on a weekly cadence, with a recompute-now
      button. It currently recalculates on every read, so it drifts as data
      arrives rather than holding still for a week — the EWMA and the 28-day
      window damp it heavily, so this is only worth doing if the number moving
      under you turns out to be annoying in practice. Storing the last computed
      target with its date is the change
- [ ] Where the permanent edit button sits on the grid. It's just another item
      in the order right now, which is fine at this size and probably won't be
      once there's more on the dash
- [ ] A per-device order, not just per-device sizes. Sizes already split by
      surface; the order is still one shared list. Dense packing makes that
      mostly fine, so this waits until a real screen disagrees

---

## Swaps waiting on a reason

Replacing something that works with something better. Each is blocked on a
trigger rather than on effort — don't do these until the trigger fires.

- [ ] Swap the estimator from the Claude CLI to the API — roughly a third of the
      latency, at the cost of a metered key. **Trigger:** the wait annoys
- [ ] Server-sent events instead of polling. **Trigger:** the wall display wants
      it; nothing else does

---

## New ground

Things that don't exist yet, in any form, and might not ever.

- [ ] Habit tracker
- [ ] Apple Health integration for the calorie tracker
- [ ] E Ink display mode — high contrast, no color-only meaning, no motion.
      Watching the space; not a constraint today

---

## Built so far

**Phase 0 (foundation), Phase 1 (the shell) and Phase 2 (the calorie tracker)**
are complete and their loose ends are closed. The registry proved itself: the
calorie tool needed one line outside its own folder, and picked up a route, a
tile, a manifest and an install identity by convention.

The tracker went past its original plan and now also does: estimates from a
photograph, correcting a logged meal by describing what was wrong rather than
retyping numbers, a macro-derived calorie figure offered as a suggestion, and
one-tap re-logging of recent meals.

**Phase 3 (the grid).** The header is gone; tools, actions, the theme toggle and
the system readout all live on one grid whose unit is measured per surface. Both
the arrangement and the sizes are yours: drag to reorder, and in edit mode tap a
tool tile or a badge to get a picker of sizes beside it, anywhere from 1x1 up to
6x6. A declared size is only where it starts. A badge carries two of them — its
glance and its expanded readout are different shapes with different jobs — and
both are set the same way.

Sizes are stored per surface, because six columns is three quarters of a phone
and barely a third of the wall — so setting one screen deliberately leaves the
others alone.

**Phase 4 (weight and the adaptive target).** Weigh-ins, a smoothed trend,
expenditure learned from actual intake against actual weight movement, a target
that holds steady at goal, and a non-destructive baseline reset. The weight bar
shows up on the tile and on the Today tab, each switchable off in settings; the
Weight tab always shows it, since hiding the headline on its own tab would be
odd.
