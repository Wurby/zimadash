# todos

Ideas and implementation plan for zimadash. See [AGENTS.md](AGENTS.md) for what
the project is and the rules that govern it.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

Phase 0 (foundation) and Phase 1 (the shell) are complete — routing, the tool
registry, refresh tiers, the header, per-tool PWAs, and the tile grid all exist
and are verified on device. What follows is what they left behind and what comes
next.

---

## Loose ends

- [ ] Rename the systemd unit and remote dir to `zimadash` (set in
      `deploy.local.env`, then `npm run deploy -- --install-service`)

---

## Phase 2 — the first real tool

- [ ] Pick the persistence layer and wire it into `DATA_DIR` (likely NoSQL)
- [ ] Migration story — how a tool's schema changes without losing data
- [ ] Calorie counter as the first genuine tool, and the proof the registry works

---

## Someday / maybe

- [ ] Server-sent events instead of polling, mainly for the wall display
- [ ] E Ink display mode — high contrast, no color-only meaning, no motion.
      Watching the space; not a constraint today
- [ ] A way to reset or change the PIN from the UI rather than by SSH
- [ ] Habit tracker
- [ ] Write a real `actions.json` (Homebridge scenes, robovac). The plumbing is
      done and untested against a live endpoint; no action is configured yet
