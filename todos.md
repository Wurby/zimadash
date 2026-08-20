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
- [ ] Check the trainer's three session-type hues hold up at cell size in both
      themes. Colour is the only carrier at 11px, and violet/teal/amber were
      picked on paper rather than on the wall display. There is real data in the
      grid now, so this is a look rather than a guess
- [ ] Check whether midpointing the imported difficulty ranges distorted the
      early history. "5-6" became 5.5 and then "hard"; if a few of those should
      have been "easy" the first fortnight of the trend is off by a rung. Only
      worth touching if the early curve looks wrong

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

Still just an idea, but the trainer has now answered most of its unknowns: the
year-of-dots grid exists, hued by category and shaded by intensity, with the
weekly-target-and-streak counting that stops a daily grid implying every filled
day is better. Whether that generalises is the open question — the trainer's
grid reads a session shape, not an arbitrary habit, and tools don't reach into
each other, so this would be a rebuild rather than an import.

The design fork is unchanged: one habit large, or every habit small.

---

## Decided, not doing yet

Each of these is blocked on a trigger, not on effort. They're recorded so the
reasoning doesn't get re-litigated — don't pick one up until its trigger fires.

- **Swap the estimator from Grok Build (`grok -p`) to the API.** Roughly a
  third of the latency, at the cost of a metered key. _Trigger:_ the wait
  annoys.
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
- **Join the trainer's weight data to the calorie tracker's.** Both hold body
  weight and both care about it, but tools don't reach into each other and
  breaking that for one convenience is a bad trade. _Trigger:_ wanting the
  expenditure figure to account for training load, which is the only thing the
  split actually costs.

---

## To be reviewed

A holding pen for things noticed while building but Joshua hasn't ruled on.
Nothing here is agreed work — it gets promoted, or it gets deleted.

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

**The trainer.** Replaces the vault's workout guide and log, and expands on
both. The rules that govern it live in AGENTS.md under _The trainer_; this is
what got built.

The move that decided everything: **the guide was three things wearing one hat**
— structured data pretending to be prose, actual policy, and procedure. The
procedure became code, the policy stayed a prompt, and the data became data. So
the equipment now generates every achievable load rather than a list being
maintained by hand, and the model never sees most of the brief.

- **Progress is the landing tab**, not one of four. A day grid hued by session
  type and shaded by effort, a weekly 0/3 target with a streak that survives a
  two-session week, a PR board with per-lift drill-down, and load-per-session.
  The vault import meant it had real data on day one.
- **Sessions run one exercise a screen**, one tap to rate and advance, with
  swap, skip and adjust behind it. Results write on every tap, so a sleeping
  phone can't lose a workout. Two exits: end early and keep what you did, or
  abandon — which confirms, and says what it's about to destroy.
- **Voice** reads each exercise out. Piper on the box when it's there, the
  browser voice when it isn't.
- **The model plans**, given the pool, the ladders and the rule's already-
  computed suggestions. Verified: it followed every one of them. The rules
  planner stays underneath as the offered fallback.

**Detailed instructions, on request.** The cue on the exercise screen is one or
two sentences, which is what you want between sets and thin when you're learning
a movement. "How to do it" expands a full write-up — setup, each rep, and what
commonly goes wrong — and reads it aloud when voice is on.

Generated per **exercise**, not per session, and cached: a goblet squat is
performed the same way in March as in August, so only the first ask waits on the
model. The cache is keyed on the exercise plus a hash of the brief, so rewriting
the brief invalidates guidance written under the old one rather than leaving
advice that contradicts it. `rewrite` forces a new one.

A full guide takes the better part of two minutes to read aloud, so it has its
own stop — toggling the voice off would work but that's a setting, not a
control.

**Voice bug, found in use and fixed.** Piper and the browser voice spoke over
each other. Four things in a chain: the voice toggle both spoke and flipped the
state whose effect also speaks, so two requests went out for one sentence; both
computed the same cache path and therefore the same temp file, so two Piper
processes wrote one file and both renamed it; the loser threw; and the client
read any failure as "this box has no voice" and dropped to `speechSynthesis`
while the winner was still playing. Now: only the effect speaks, temp files are
unique per render, identical concurrent renders are coalesced to one process,
`stop()` invalidates work in flight, and only a 503 switches engines. Verified
with six concurrent identical requests — one render, zero failures.

Voice is now `en_US-lessac-medium`. **Swapping means removing the old `.onnx`**,
not just adding the new one: the resolver takes the first alphabetically, so
`en_GB-alan` would have silently kept winning.

Piper install, in case it needs redoing: the standalone `rhasspy/piper` tarball
into `~/opt/piper`, symlinked into `~/.local/bin` — the bundled libs resolve
through `$ORIGIN`, so a symlink is enough. **`extra/piper` in the Arch repos is
a gaming-mouse configurator**, an entirely different project, and the newer
`piper1-gpl` ships Python wheels rather than a binary, which on Arch means venv
juggling for no gain.

**The inbox.** A file-drop tool, prompted by needing to hand a non-markdown
file (an audio recording) to the vault outside the chat-based tooling that can
only write notes. The rules that govern it live in AGENTS.md under _The
inbox_; this is what got built.

The design fork that mattered: no fixed destination list. Rather than
hardcoding folders, the model is pointed at `ZIMADASH_INBOX_ROOT` and told to
read `AGENTS.md` there first — the same convention this repo uses on itself —
then explore with `list_dir` and `grep`. It only ever returns a decision; the server
validates the chosen path and performs the write, the same judgement/execution
split as the trainer's weight snapping.

Fire-and-forget end to end: the tile confirms the moment bytes are safely on
disk (staged in `DATA_DIR`, not `os.tmpdir()`, since this file _is_ the
payload) and files in the background with no polling UI. Never silently
dropped — low confidence or a failed validation lands the file in
`Unsorted/`, and a real failure keeps the bytes in `incoming/`; both get a
logged reason, checkable from the tool's own View.

`ZIMADASH_INBOX_ROOT` is set by the systemd unit to `%h/inbox`. The other
`ZIMADASH_*` vars (`ZIMADASH_GROK_BIN`/`ZIMADASH_PIPER_BIN`) still have no
tracked provisioning — the brains find `grok` on the installer PATH without an
override.

**Grok Build.** The estimator, trainer, inbox, and the deploy commit-message
step all shell out to `grok -p` on the subscription that already exists, not a
metered key. Grants stay tight: `web_search` (plus `read_file` for a photo) on
calories; nothing on the trainer; `read_file,grep,list_dir` on the inbox.
Verified in use: a text meal, a photo meal, a trainer model plan, and an inbox
drop.

Phase numbering stopped here — everything above is a tool, not a phase.
