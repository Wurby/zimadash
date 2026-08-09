# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

What's next is at the top. [What's already built](#built-so-far) is at the
bottom — it's reference, not work.

---

## Loose ends

Gaps in things that already work. Each one has an obvious fix and none is a
project — this is the list to raid when there's an hour spare. Roughly
best-first; the last two are conditional and say so.

- [ ] The Log tab stops at a fortnight. Reach any entry, not just recent ones —
      a month or date-range picker rather than a fixed window
- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Write a real `actions.json` (Homebridge scenes, robovac). The plumbing is
      done and untested against a live endpoint; no action is configured yet
- [ ] Persist whether a badge is expanded. It's component state today, so a
      reload collapses it — and now that both forms are separately sizeable, a
      refresh throws away the expanded size you just set. The wall display is
      the case that wants it: always on, and it would probably live expanded.
      Belongs in `layout.json` next to the sizes
- [ ] Tool tiles below about 3x2 are just the vertical title band. The band is
      24px and the padding another 24px, which already exceeds one 38px unit, so
      1x1 and 2x1 clip to nothing readable. The ladder goes that small for the
      badges' sake, so the fix is at the tile end: either a per-item minimum, or
      `ToolTile` drops the band below some span and shows the glyph alone
- [ ] Debounce the size writes. Tapping through a few sizes to compare fires a
      PUT each time. They're chained so they can't land out of order, and it's a
      home server — but a short debounce would be politer
- [ ] Drop the reset chip from the size picker. Thirteen labelled sizes and one
      bare `↺` whose `title` never fires on touch; once you own the size, the
      tool's opinion isn't worth a cell. **One thing to settle first:** two
      declared defaults are off-ladder — the stats badge's expanded `8x6`, and
      calories' `8x5` on a phone — and reset is currently the only way back to
      them. Either put those sizes on the ladder, accept that a first pick is
      one-way, or leave the chip alone
- [ ] Settle the calorie target on a weekly cadence, with a recompute-now
      button. It currently recalculates on every read, so it drifts as data
      arrives rather than holding still for a week — the EWMA and the 28-day
      window damp it heavily, so this is only worth doing if the number moving
      under you turns out to be annoying in practice. Storing the last computed
      target with its date is the change
- [ ] Where the permanent edit button sits on the grid. It's just another item
      in the order right now, which is fine at this size and probably won't be
      once there's more on the dash
- [ ] _If a real screen disagrees:_ a per-device order, not just per-device
      sizes. Sizes already split by surface; the order is still one shared list,
      and dense packing makes that mostly fine
- [ ] _If ids ever churn:_ prune stale size overrides. `applyOrder` drops
      unknown ids from the order but nothing does the same for `sizes`, so an
      uninstalled tool leaves its entry behind forever. One filter on write —
      but not before ids are stable enough that pruning can't eat something that
      was about to come back
- [ ] _At the first schema change that needs it:_ migrate-on-read for
      `layout.json`. `Layout.version` is written and never read. Two additions
      have now been absorbed as optional fields with defaults, which is simpler
      than a migrate function and is the deliberate approach until something
      needs to actually rewrite stored data — at which point copy the pattern
      from the calorie settings

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

## To be reviewed

A holding pen for things Claude noticed while building but Joshua hasn't ruled
on. Nothing here is agreed work — it gets promoted, or it gets deleted.

_Empty. Last cleared after the tile-sizing work._

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

---

## Phases 0–5, retired as a numbering scheme

Phase 5 was one bullet — a date-range picker on the Log tab — which is a loose
end, not a phase, and it now sits there. Everything numbered below 6 is built.
Homebridge keeps its number because it's a genuinely new tool with an unresolved
fork in it; if another lands, number it 7.
