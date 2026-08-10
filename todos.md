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
- [ ] The back arrow in `ToolShell` measures 34x34, under the 44px touch
      minimum — and it is the only way out of a tool, on a surface that is
      entirely touch. It's shared, so this lands on calories and scratch as much
      as the new tools. The config screens were brought up to 44 during the
      mobile pass; this was left alone only because it sits outside those tools

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
- [ ] **A tile's size sets its tap targets, and nothing checks that.** Measured
      on a phone: Last Time at its declared `6x4` gives five rows 29px each,
      against a 44px touch minimum. The tool can't fix it from inside — rows
      divide whatever height the grid hands down — so the levers are a taller
      declared default, a per-item minimum that clips honestly, or the tool
      declaring how many rows it needs. Everything in the config screens now
      clears 44px; it's only the tiles that can't guarantee it

---

## New tools

Each one needs a grill-me before building — what's here is the shape and the
forks, not a spec. Roughly in the order I'd build them.

### Personal trainer

**Designed and agreed — this section is the spec, not a sketch.** It replaces
`Personal/fitness/workout-guide.md` and `workout-log.md` in the vault and
expands on both.

**Two constraints before anything else.**

- **The brief lives in `DATA_DIR`.** It carries personal health information —
  the kind that has no business in a public repo, which is why this paragraph
  doesn't enumerate it either. Not in the tool folder, not in a fixture, not in
  a test, not in this file.
- **Mid-session state has to survive a lock and a reload.** The chat version
  never needed this because the conversation held it. A tool walking you
  through exercise four of six, on a phone that sleeps between sets, does not
  get to lose its place.

#### The central move: the doc is three things wearing one hat

The guide jams together **structured data pretending to be prose** (equipment,
exercise pools, available weights, rotation order, the adjustment table),
**actual policy** (the knee protocol, never-prescribe-cardio, bias toward
progression, the density-set format) and **procedure** ("check the log, work out
the rotation, log the results, archive anything over a fortnight").

The procedure isn't a prompt at all — it's the tool. So: split the doc three
ways, turn the procedure into code, keep the policy as a prompt, and make the
data actually data. **Don't ship the whole brief to the model.**

#### Equipment is the source of truth, and the ladders are derived

The plates you own plus the bar generate every achievable load as a subset sum.
**That list is computed and must never appear as a constant** — it regrows the
day a heavier pair arrives, which is the whole point.

Ladders are **per implement**, not global: the bar adds its own weight, the
bench's leg attachment loads plates without it, and dumbbell movements depend
on which pairs exist and whether the movement holds one or two. The existing
vault log is inconsistent about exactly this — the same exercise appears at a
weight only reachable on one ladder and later at one only reachable on the
other — because prose lets it be and code can't.

Every prescription snaps to a real rung, so the model cannot ask for a load you
can't build.

#### What the model does, and what code does

**Model:** which exercises this session given recent history, what got skipped
and the time budget; when a compound complex or a density set earns its slot;
what to load a lift with no history from a related one; and **writing the
instructions** — form cues and execution, including the knee cueing.

**Code:** rotation, the adjustment-rule lookup, ladder snapping, PR detection,
logging, archiving. The suggested weight is computed from your last rating and
handed to the model as context — it may override, but only with a stated
reason, and the result snaps either way.

This is why the wait is bearable: the arithmetic is free and instant, and only
the judgement costs seconds.

**Generated instructions are saved into the session record**, so History replays
exactly what you were told and re-reading an old session costs nothing.

**Unlike the calorie estimator, a fallback is correct here.** Rotation plus pool
plus the adjustment table can build a serviceable session with no model at all.
When the estimator is down, _offer_ that — never silently. A dead model
shouldn't cost a workout.

#### Progress is the point, not a tab

Importing the vault means Progress has real data on day one, so build it first.

- **A GitHub-style day grid is the hero.** Hue by session type (so the rotation
  becoming regular is the thing you watch form), intensity by how hard the
  session was, averaged from the ratings. A month where legs got skipped is
  visibly wrong in a way a single-colour grid would hide.
- **Careful with the metaphor:** a daily contribution grid implies "every day
  filled is better", which is false here — rest is the program. So the grid is
  texture and the habit is measured in **weeks**.
- **Three a week is the target; two keeps the streak.** The week reads 0/3 →
  3/3, the streak breaks only below two, and a 3/3 week is marked distinctly on
  the grid. Honest without being punishing.
- **PRs get a board, not a chart per lift** — newest first, what it beat, how
  long it stood — plus cumulative PRs over time as one line that goes up.
  Per-lift detail is a drill-down, not the main view.
- Two aggregate charts that aren't lift-specific: load moved per session, and
  sessions per week.
- **Tile:** the mini grid, this week's count, and what's next.

#### Session flow

Summary of the next session (type, exercises, weight × sets × reps, rough time)
→ **Start** → one exercise per screen → rate it, which advances → after the last
one it's stored, with a summary of what you did and any PRs.

The happy path is **one tap per exercise**: weight and reps default to what was
prescribed, and you only touch them if reality differed.

**Ratings are words, four of them, and "Hard" is the target** — a working set
should feel hard, so naming the target "just right" would be smoothing something
that doesn't need it.

| Rating   | Does                                   |
| -------- | -------------------------------------- |
| Too easy | up two rungs                           |
| Easy     | up one rung                            |
| Hard     | stay here — **target**                 |
| Too hard | down one (**two** on knee-loaded work) |

Each row shows its consequence, so the control teaches the rule instead of
requiring you to remember it. The word maps to a canonical number underneath, so
the imported log stays compatible and a finer scale could return without a
migration.

**The rating says how it felt; code picks the lever.** At the bar or dumbbell
ceiling there is no next rung, so "Easy" adds reps instead of weight — which is
what the brief already asks for, with no extra button.

#### Voice mode

A toggle in the session reads each exercise aloud as you land on it — name,
load, sets and reps, then the cues — so the whole workout is one tap per
exercise without looking at the screen.

**`speechSynthesis`, the browser's own Web Speech API.** No dependency, no key,
no metered call, nothing server-side, and it works on the phone. That is the
same reasoning that put the estimator on the Claude CLI: use what's already
there rather than adding a bill.

- **Per device, in `localStorage`**, like the theme — voice on in your hand and
  off on the wall is a reasonable thing to want, and it is a UI preference
  rather than state a deploy could destroy.
- **iOS needs a user gesture before it will ever speak.** The **Start** tap is
  that gesture, so prime the synthesiser there — not on arriving at the first
  exercise, which is too late.
- `getVoices()` is async and often empty on first call; wait for
  `voiceschanged` before picking one.
- A **replay** control, because a missed cue mid-set shouldn't need the screen.
- **Known limit to test on a real phone:** iOS stops speech when the screen
  locks, and may route it through the silent switch. Neither is fixable from a
  web page — if it bites, the answer is keeping the screen awake during a
  session, not fighting the audio stack.

**Swap sits below the ratings, not among them** — it replaces the exercise
rather than logging a set. It offers alternatives hitting the same muscle group,
and for knee-loaded lifts leads with the low-stress options the brief names.
Also needed: **skip with a reason**, and **add an exercise** before finishing,
since the existing log shows exercises added on the fly.

#### Settled

- **Tool becomes the only home.** Import the vault once, never write back —
  two-way sync between a markdown table and a JSON store is a project and a
  corruption source. Ship a markdown **export** in the existing log format so
  nothing is trapped.
- **Whole session generated up front**, with a per-exercise escape hatch. One
  wait beats six, the plan is visible, and the brief already says you adjust on
  the go yourself.
- **No offline handling.** Home gym, fine wifi — logging is a plain POST. Results
  still persist per exercise as you tap, because the phone sleeps between sets;
  the session merely _counts_ as finished at the end.
- **Split the brief:** equipment and pools get UI editing (a dumbbell arriving
  shouldn't need SSH), policy prose gets a textarea. Both in `DATA_DIR`.
- **Don't port the fortnight window or the monthly archives** — vault
  workarounds, both. And learn from the calorie tracker's open loose end: build
  History with a real date range from day one.
- **No `interactiveTile`.** Starting a workout opens a full screen, so the
  ordinary whole-tile link is right.
- Tabs: **Progress · Session · History · Settings**, landing on Progress unless
  a session is active.

#### Still open

- [ ] Weight overlaps with the calorie tracker, but tools don't reach into each
      other. Either the trainer asks for what it needs, or the overlap stays
      unjoined
- [ ] Imported ratings are ranges ("5-6"); the four-point scale is a single
      value. Midpoint on import is the plan — check it doesn't distort the
      early history
- [ ] Three hues for session type need to survive both themes and hold up at
      cell size, where colour is the only carrier. The legend and the
      tap-through carry anything colour can't

#### Phasing

1. Foundation and Progress — data model, equipment → ladders, vault import, the
   grid, PR board, tile. The fun part exists before anything else does.
2. Session flow — rule-based planning, the walkthrough, ratings, persistence,
   and voice mode.
3. The model layer — exercise selection and written instructions on top.

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

Three things fell out of building them that are now written into AGENTS.md:

- **Tier by what's on screen, not where the data came from.** Last Time and
  Countdowns hold self-entered data and are still `ambient`, because what they
  render is elapsed time — it moves while the record sits still, and a countdown
  has to have rolled over by morning on the wall display.
- **A fourth tier, `slow` (15m), for when the _source_ is the bound.** The cache
  rule cuts both ways: a server cache may not be slower than the client tier it
  feeds, so putting weather on `ambient` forced every upstream fetch to 60s — about
  1,400 Open-Meteo calls a day for a forecast that updates every few minutes.
  Moving it to `slow` took that to 96. Safe because a tier only bounds the steady
  state: every tab still fetches on mount and on becoming visible, so a phone out
  of a pocket is current regardless.
- **Open-Meteo's `timezone=auto` returns local times with no offset on them**,
  which `new Date()` reads in the viewer's zone. The offset is resolved
  server-side into a real instant once, on the way through. Verified against
  London and Tokyo landing on the same UTC instant.

**Then a browser pass over all three, on a phone viewport.** Confirmed working:
`interactiveTile` logs rather than navigating; tap-and-undo removes exactly the
newest entry and the 5-second window expires on its own; all three age states
render distinctly in both themes; a learned interval was picked up off a four-tap
cadence; countdowns coloured by nearness, sank the passed one, enforced the cap
and rolled the yearly one to next year; geocoding, the hourly strip's start hour
and the 5-/10-day mutual exclusion all behaved. Zero console errors.

What it caught, all since fixed:

- **`humanElapsed` returns phrases, not durations.** Dropping it into an "… ago"
  frame produced "last never ago" and "last just now ago". `humanLast` now owns
  the whole phrase, and the tile's `aria-label` with it.
- **`humanInterval` rounded 30 days to "4w"** while the field beside it read 30,
  and the pin button said "pin 4w" while pinning 30. Weeks only on exact
  division now.
- **Every control was under the 44px touch minimum** — checkbox 13x13, delete
  27x26, buttons ~34 tall. All three config screens now carry an explicit
  `min-h-11` floor.
- **Captions sat beside their fields, not above** — inconsistently, since an
  inline span only wraps when its input happens to be full-width. "Name" was
  right by accident and "Every"/"Date" were wrong.
- **Countdowns' add form collapsed on a phone**, squeezing Name to about 30px —
  narrower than its own placeholder.
- **The config band was 24px wide.** On a normal tile the whole thing is the
  link so the strip's width is decoration; on an interactive tile it is the only
  way in. Widened to 44 for those only.

Worth remembering for the next mobile check: **desktop Chrome never matches
`(pointer: coarse)`**, so it renders fields at 12–14px — sizes that do not exist
on a phone. Injecting the rule from `index.css` unconditionally is what surfaced
all of the above; without it the first pass looked clean.

Phase numbering stopped here — everything above is a tool, not a phase.
