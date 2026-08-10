# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

What's next is at the top. [What's already built](#built-so-far) is at the
bottom — it's reference, not work.

---

## Loose ends

Gaps and bugs in things that already work. Each one has an obvious fix and none
is a project — this is the list to raid when there's an hour spare. Roughly
best-first.

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

---

## Sizing needs a rethink

Not an hour's work and not a bug — the model itself wants re-deciding, so this
gets a brainstorm before any code. What's here is the state of play, not a plan.

**Where it stands.** `SIZE_OPTIONS` is a closed ladder of thirteen rungs, from
1x1 to 6x6, every one fitting inside a phone's eight columns. Sizes are stored
per surface; the order is one shared list. The picker is seven across by two
down and **must stay two rows** — a two-row block is shorter than a 3-row tile
at every unit size, so it still fits beside one, and a third row drops most of
the grid to below-placement.

**What just changed.** The reset chip is gone. It was a bare `↺` whose `title`
never fires on touch, for the tool's opinion about a size you've already
overridden. Removing it means **a first pick is now one-way** — nothing clears
an override, so a declared size that isn't a rung can't be returned to.

**The two that are off the ladder.** The stats badge's expanded `8x6`, measured
to fit its readout without scrolling, and calories' `8x5` on a phone. Both are
now unreachable once their tile is resized. Last Time, Countdowns and Weather
were deliberately declared on-ladder to avoid adding to this.

Things worth settling in the brainstorm, roughly in the order they'd change the
answer:

- [ ] Is a closed ladder still right? It buys "a tile only lands on a size it
      was designed for", and it costs any size nobody thought of. A drag-handle
      with snapping is the obvious alternative and a real departure
- [ ] If the ladder stays: does it need a full-width rung? Everything on it caps
      at 6 of a phone's 8 columns, so **no tile can currently fill a phone's
      width** — which is why both off-ladder defaults are 8 wide. That may be
      the actual bug here
- [ ] Fourteen cells now hold thirteen rungs. One free cell, and widening the
      picker is explicitly cheap while heightening it isn't — so there is room
      for one or two more rungs without touching the placement maths
- [ ] Should a tool declaring an off-ladder size be an error at startup, the way
      a slug mismatch is? It would have caught both of these
- [ ] What happens on a surface a size was never chosen for. Sizes are per
      surface by design, but that means picking on a phone leaves the wall on
      the declared size — correct, and confusing the first time it happens
- [ ] Whether the tile-clipping problem is a sizing problem in disguise. Tool
      tiles below about 3x2 are just the title band, so a third of the ladder is
      unusable for tools while being the whole point of it for badges

---

## New tools

Each one needs a grill-me before building — what's here is the shape and the
forks, not a spec. Roughly in the order I'd build them.

### Personal trainer

Replaces `Personal/fitness/workout-guide.md` and `workout-log.md` in the vault,
and expands on both. The guide is already a complete brief — session rotation
(Upper A → Lower → Upper B → Lower), an exercise pool per day type, the
equipment inventory and its loaded-weight ceilings, a knee protocol with its own
override on the adjustment rule, the conditioning-without-cardio levers, and a
0–10 difficulty scale that feeds forward into next session's load. The log is
four sessions of exercise / weight / sets×reps / difficulty. All of that
survives; what it doesn't have is a UI, and it's being read by a chat window
that has to be handed the whole doc every time.

This is the estimator pattern pointed at generation rather than extraction, so
the Claude CLI shell-out already in the calorie tracker is the mechanism, with
the same several-second wait to design around.

**Two constraints before anything else is decided:**

- **The brief lives in `DATA_DIR`.** It carries health information — a GLP-1
  protocol, a family injury history — and this repo is public. Not in the tool
  folder, not in a fixture, not in a test.
- **Mid-session state has to survive a lock and a reload.** The chat version
  never needed this because the conversation held it. A tool walking you through
  exercise four of six, on a phone that sleeps between sets, does not get to
  lose its place.

- [ ] Does the vault stay the source of truth, does the tool become the only
      home, or do they sync? "Replace" suggests the tool wins, but the archive
      is years of history and nothing should eat it
- [ ] Is the whole session generated up front, or one exercise at a time? Up
      front means one wait and a plan you can see; per-exercise means the model
      can react to the difficulty you just reported, at the cost of a wait
      between every exercise
- [ ] Is the brief editable in the UI, or a file you edit by hand? It's long,
      it's prose, and most of it changes rarely — but the equipment list changes
      the day a heavier dumbbell arrives
- [ ] What the tile shows. Next session type is the obvious answer; a
      per-lift progression chart is the one that earns the space
- [ ] Does it need to work with no network mid-session? A garage or a basement
      is exactly where this gets used, and a generated session that can't be
      logged is worse than a paper note
- [ ] The 2-week window and monthly archive files in the guide are a workaround
      for living in a vault. A real store makes both moot — don't port them in
- [ ] Weight and the GLP-1 context overlap with the calorie tracker, but tools
      don't reach into each other. Either the trainer asks for what it needs, or
      the overlap stays unjoined

### Homebridge

A tool tile for the house.

`server/src/actions.ts` already proxies a configured HTTP request so a
credential never reaches the browser, and firing a scene is a 1x1 quick action
with no new code — the `actions.json` loose end covers that. **So this is only
worth building for what a quick action can't do.**

**The fork that decides everything:** does the tile only _fire_ things, or does
it _show state_ — which lights are on, what the thermostat reads, whether a door
is open? Firing already exists. Showing state means polling on a tier, holding a
view of the house, and handling an unreachable bridge. Those are different tools.

- [ ] How it talks to Homebridge. Its UI exposes an HTTP API behind a token,
      which is straightforward; speaking HomeKit directly is not. Either way the
      token lives in `DATA_DIR` and the browser never sees it
- [ ] Which accessories appear — a fixed list you configure, or everything the
      bridge reports
- [ ] Refresh tier. Probably `ambient`, but a light you just toggled has to look
      right immediately, which argues for a refetch after mutating rather than
      waiting for a tick
- [ ] What it looks like at tile size versus opened, given the wall display is
      the surface most likely to want it
- [ ] What happens when the bridge is down. A stale view is worse than an honest
      one for something that controls the house

### Habit tracker

Still just an idea. A year of dots is the best wall visual on this list, and
it's pure `event-driven` — but the design question isn't the data, it's whether
the tile shows one habit large or every habit small.

---

## Decided, not doing yet

Each of these is blocked on a trigger, not on effort. They're recorded so the
reasoning doesn't get re-litigated — don't pick one up until its trigger fires.

- **Swap the estimator from the Claude CLI to the API.** Roughly a third of the
  latency, at the cost of a metered key. _Trigger:_ the wait annoys.
- **Server-sent events instead of polling.** _Trigger:_ the wall display wants
  it; nothing else does.
- **Settle the calorie target on a weekly cadence**, with a recompute-now
  button. It recalculates on every read today, so it drifts as data arrives
  rather than holding still. The EWMA and the 28-day window damp it heavily.
  _Trigger:_ the number moving under you turns out to be annoying in practice.
- **A per-device order, not just per-device sizes.** Sizes already split by
  surface; the order is one shared list and dense packing makes that mostly
  fine. _Trigger:_ a real screen disagrees.
- **Prune stale size overrides.** `applyOrder` drops unknown ids from the order
  but nothing does the same for `sizes`, so an uninstalled tool leaves its entry
  behind forever. One filter on write. _Trigger:_ ids churn enough to matter —
  and not before pruning can't eat something that was about to come back.
- **Migrate-on-read for `layout.json`.** `Layout.version` is written and never
  read. Two additions have been absorbed as optional fields with defaults, which
  is simpler than a migrate function. _Trigger:_ a schema change that has to
  rewrite stored data — then copy the pattern from the calorie settings.

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

**Last time I, Countdowns and Weather.** Three tools at once, and the first
proof that the registry scales past one real tool — each needed a folder, a
server file and one line in the server registry, and picked up a route, a tile,
a manifest and an install identity for free.

They share a shape that turned out to be worth naming: **the tile is the tool
and the route is its settings.** Last time I logs a tap on the grid and keeps
configuration behind the title band; Countdowns and Weather are readouts whose
route is nothing but switches. That inverts the calorie tracker, where the tile
is a summary and the work happens inside.

Making that possible added `interactiveTile` to the tool contract — opt in and
the title band carries the link so the tile body can take its own taps, rather
than the whole tile being one link. Tools that don't opt in are untouched.

Two things fell out of building them that are now written into AGENTS.md:

- **Tier by what's on screen, not where the data came from.** All three hold
  self-entered or rarely-changing data, and all three are `ambient`, because
  what they render is elapsed time — it moves while the record sits still, and a
  countdown has to have rolled over by morning on the wall display.
- **Open-Meteo's `timezone=auto` returns local times with no offset on them**,
  which `new Date()` reads in the viewer's zone. The offset is resolved
  server-side into a real instant once, on the way through. Verified against
  London and Tokyo landing on the same UTC instant.

Phase numbering stopped here — everything above is a tool, not a phase.
