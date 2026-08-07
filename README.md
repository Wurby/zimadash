# zimadash

A personal dashboard — a container for small, self-built tools that don't exist
anywhere else in quite the right shape. A calorie counter, a habit tracker,
whatever comes next.

React 19 + TypeScript + Vite on the front, Express on the back. It runs on a
small home server and is designed for two screens at once: a phone, and a
wall-mounted tablet read from across the room.

The system-stats view currently on the homepage is placeholder. This is not a
homelab monitoring dashboard, and the monitoring is on its way to becoming a
single panel in the header rather than the point of the thing.

---

## Architecture

```
zimadash/
├── src/                  React frontend (Vite)
│   ├── auth/             PIN gate, wraps the app
│   └── lib/api.ts        every API call goes through here
├── server/
│   └── src/
│       ├── index.ts      Express app: /api routes + serves the built frontend
│       ├── auth.ts       the PIN gate
│       ├── paths.ts      persistent state, kept outside the build artifact
│       ├── cache.ts      stats polling loop
│       └── zimaStats.ts  CPU / memory / disk / network
├── deploy/
│   └── service.template  systemd user unit template
└── scripts/
    └── deploy.sh         build locally, ship the artifact to the server
```

One process does double duty: it exposes the API **and** serves the built
frontend as static files from `dist/`. There is no separate web server in front
of it and no proxy.

The dashboard is behind a PIN. Everything under `/api` requires it except the
health endpoint, which has to stay open so the deploy can verify itself.

### Refresh tiers

There is no single global refresh interval — data is polled at the cadence it
actually changes.

| Tier           | Cadence | For                                            |
| -------------- | ------- | ---------------------------------------------- |
| `live`         | 5s      | System stats — anything genuinely in motion    |
| `ambient`      | 60s+    | Weather, calendar — a minute stale is fine     |
| `event-driven` | never   | Self-entered data; refetch after you mutate it |

Polling pauses when the tab is hidden.

---

## Local development

```bash
npm install
npm --prefix server install
```

Run the backend and the Vite dev server in two terminals:

```bash
npm --prefix server run dev
```

```bash
npm run dev
```

Vite serves on `:5173` and proxies `/api` to the backend on `:3107` (see
`vite.config.ts`). Stats will reflect **your own machine** — the server reads
whatever it happens to be running on.

| Command                | Does                                         |
| ---------------------- | -------------------------------------------- |
| `npm run build`        | Type-check and build the frontend to `dist/` |
| `npm run build:server` | Compile the server to `server/dist/`         |
| `npm run build:all`    | Both                                         |
| `npm run lint`         | ESLint                                       |
| `npm run format`       | Prettier                                     |
| `npm start`            | Run the compiled server                      |

---

## Persistence

`scripts/deploy.sh` rsyncs with `--delete`, so the deploy directory is wiped to
match the local build every time. Anything written inside it is destroyed.

All persistent state lives in a data directory **outside** the artifact, set by
`ZIMADASH_DATA_DIR` and defaulting to `~/zimadash-data`. Use `readJson` /
`writeJson` from `server/src/paths.ts`; they write atomically. A real database
will land here eventually — the directory boundary exists so that migration is
safe.

That directory is the only thing on the server that can't be rebuilt from this
repo. Back it up.

---

## Deploying

### Configure the target

Deployment settings are per-machine and are **not** committed:

```bash
cp deploy.local.env.example deploy.local.env
```

Fill in the SSH host, the remote directory, the unit name, and the path to node
on the box. `deploy.local.env` is gitignored — keep real hostnames, paths, and
usernames out of tracked files.

### The model

The server is deliberately **dumb**. It has no idea git exists — no clone, no
`git pull`, no webhook listener, no CI runner. It holds a pre-built artifact and
runs it under systemd. Every moving part lives in `scripts/deploy.sh`, which
runs on your laptop.

```
laptop                                    server
──────                                    ──────
npm run deploy
  ├─ build frontend      → dist/
  ├─ build server        → server/dist/
  ├─ resolve prod deps   → node_modules/
  ├─ stage the artifact
  ├─ rsync --delete ─────── ssh ─────────► <remote dir>
  ├─ systemctl --user restart <unit>
  └─ verify: layout + unit active + HTTP 200
```

### Deploy

```bash
npm run deploy
```

That is the whole workflow. It is safe to run repeatedly and fails loudly rather
than leaving a half-deployed box. Preview without changing anything:

```bash
npm run deploy:dry
```

| Flag                | Effect                                                        |
| ------------------- | ------------------------------------------------------------- |
| `--dry-run`         | Build and stage, show the rsync diff, change nothing remotely |
| `--skip-build`      | Ship the existing `dist/` and `server/dist/` as-is            |
| `--clean`           | Wipe `node_modules` and all build output, then build from zero |
| `--install-service` | Also render and install the systemd unit                      |
| `--no-verify`       | Skip the post-deploy health check                             |
| `--host <ssh-host>` | Deploy to a different SSH host                                |

Flags go after `--`, e.g. `npm run deploy -- --clean --install-service`.

### What lands on the server

The remote directory is an exact mirror of the staged artifact — rsync runs with
`--delete`, so anything not in the artifact is removed:

```
<remote dir>/
├── dist/                    frontend build
├── server/
│   ├── dist/                compiled server
│   ├── node_modules/        production deps only
│   ├── package.json
│   └── package-lock.json
└── DEPLOYED                 commit, timestamp, and build host
```

No source, no tsconfigs, no dev dependencies, no toolchain. `cat DEPLOYED` tells
you which commit is live.

### Why dependencies are shipped rather than installed

The artifact includes its own `server/node_modules` so the box never runs `npm`.
This works because both runtime dependencies are pure JavaScript with no native
bindings — `express`, and `systeminformation` (which shells out to OS commands).

The deploy script **verifies this on every run**: if any `.node` binary appears
in the production tree it aborts, because a macOS-resolved native module will
not run on Linux. Only add pure-JS server dependencies, or you'll need to build
the tree on the target instead.

### The systemd unit

`deploy/service.template` is the source of truth. `scripts/deploy.sh` renders it
with your `deploy.local.env` values and installs the result:

```bash
npm run deploy -- --install-service
```

Don't hand-edit the copy on the box — the next render overwrites it. A user unit
needs lingering enabled for its account so it runs without an interactive login.

---

## Troubleshooting

**Deploy fails at "cannot reach ..."**
Check the host resolves and accepts your key: `ssh <host> true`. If you reach it
through a tunnel, make sure the tunnel client is running locally.

**Deploy succeeds but the health check fails**
The unit restarted but the server didn't come up. Check the unit's journal:
`journalctl --user -u <unit> -n 50 --no-pager`.

**Page loads but stats are empty**
The API is up but `systeminformation` is failing. Curl the stats endpoint
directly on the box.

**Disk numbers look wrong**
`server/src/zimaStats.ts` reports a specific data mount plus `/` separately as
`rootDisk`. Change `DATA_MOUNT` if the disk layout changes.
