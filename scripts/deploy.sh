#!/usr/bin/env bash
#
# Build the dashboard locally, then push the built artifact to the server.
#
# The server stays "dumb": it never talks to git, never builds, never installs
# packages. It receives a self-contained artifact and restarts a systemd
# user unit. All of the intelligence lives here.
#
# Outstanding work is committed and pushed first, so whatever ships can always
# be traced back to a commit. grok -p writes the commit message; --no-git skips
# the whole step.
#
# Usage:  npm run deploy [-- <flags>]
# Flags:  --dry-run  --skip-build  --clean  --install-service  --no-verify
#         --no-git  --host <ssh-host>
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Configuration ───────────────────────────────────────────────────────────
# Real hosts, paths, and interpreter live in deploy.local.env, which is
# gitignored. Copy deploy.local.env.example to create it. Anything already set
# in the environment wins, so one-off overrides still work.
LOCAL_ENV="$REPO_ROOT/deploy.local.env"
if [ -f "$LOCAL_ENV" ]; then
  set -a; . "$LOCAL_ENV"; set +a
fi

REMOTE_HOST="${DEPLOY_HOST:-}"
REMOTE_DIR="${DEPLOY_DIR:-}"                      # relative to remote $HOME
SERVICE="${DEPLOY_SERVICE:-zimadash.service}"
NODE_BIN="${DEPLOY_NODE_BIN:-node}"
# Must stay an unauthenticated endpoint — the deploy has no session token.
HEALTH_PATH="${DEPLOY_HEALTH_PATH:-/api/health}"
HEALTH_PORT="${DEPLOY_HEALTH_PORT:-3107}"
STAGE="$REPO_ROOT/.deploy/stage"
PRODDEPS="$REPO_ROOT/.deploy/prod-deps"

DRY_RUN=0; SKIP_BUILD=0; CLEAN=0; INSTALL_SERVICE=0; VERIFY=1; SYNC_GIT=1

# ─── Output helpers ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; N=$'\033[0m'
else
  B=""; DIM=""; R=""; G=""; Y=""; C=""; N=""
fi
step() { printf '\n%s==>%s %s%s%s\n' "$C" "$N" "$B" "$1" "$N"; }
info() { printf '    %s\n' "$1"; }
ok()   { printf '    %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '    %s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '\n%serror:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

# ─── Argument parsing ────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)         DRY_RUN=1 ;;
    --skip-build)      SKIP_BUILD=1 ;;
    --clean)           CLEAN=1 ;;
    --install-service) INSTALL_SERVICE=1 ;;
    --no-verify)       VERIFY=0 ;;
    --no-git)          SYNC_GIT=0 ;;
    --host)            REMOTE_HOST="${2:-}"; [ -n "$REMOTE_HOST" ] || die "--host needs a value"; shift ;;
    -h|--help)         sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                 die "unknown flag: $1" ;;
  esac
  shift
done

# Run a script (stdin) on the remote host. The remote login shell is fish, so
# every remote command is explicitly handed to bash.
remote_sh() { ssh "$REMOTE_HOST" bash -s -- "$REMOTE_DIR" "$SERVICE" "$HEALTH_PORT" "$HEALTH_PATH"; }

cd "$REPO_ROOT"

# ─── 1. Preflight ────────────────────────────────────────────────────────────
step "Preflight"
command -v ssh   >/dev/null || die "ssh not found"
command -v rsync >/dev/null || die "rsync not found"
command -v npm   >/dev/null || die "npm not found"

[ -n "$REMOTE_HOST" ] || die "no deploy target set.
       cp deploy.local.env.example deploy.local.env  and fill it in,
       or pass --host <ssh-host>."
[ -n "$REMOTE_DIR" ] || die "DEPLOY_DIR is not set — see deploy.local.env.example"

info "local node   $(node --version)"
info "local rsync  $(rsync --version 2>&1 | head -1 | sed 's/^ *//')"

ssh -o BatchMode=yes -o ConnectTimeout=20 "$REMOTE_HOST" true 2>/dev/null \
  || die "cannot reach '$REMOTE_HOST' over ssh (check ~/.ssh/config and cloudflared)"
ok "ssh to $REMOTE_HOST"

# ─── 2. Commit and push outstanding work ─────────────────────────────────────
# What ships should always be reconstructible from a commit, so anything
# outstanding is committed and pushed before the artifact is built.
#
# grok -p writes the message from the staged diff and does nothing else — the
# staging, committing, and pushing are plain git. Handing it the whole job would
# mean granting a headless agent permission to run git against your repo during
# a deploy, and the failure modes get much harder to see. This way the only
# thing that can go wrong is a bad message, and that falls back to a generic one.

# Ask Grok for a commit message describing what is currently staged.
commit_message() {
  local diff prompt msg
  diff="$(
    git diff --cached --stat -- . ':!*package-lock.json'
    printf '\n---\n'
    git diff --cached -- . ':!*package-lock.json' | head -c 30000
  )"

  prompt="Write a git commit message for the staged diff below.

Format: a conventional-commit subject line of at most 72 characters, then a
blank line, then one to three short lines saying why the change was made.
Output only the message itself — no code fences, no preamble, no sign-off.

$diff"

  msg="$(
    GROK_DISABLE_AUTOUPDATER=1 GROK_MEMORY=0 \
      grok -p "$prompt" \
      --tools '' \
      --no-subagents \
      --no-plan \
      --disable-web-search \
      --verbatim \
      2>/dev/null || true
  )"
  # Drop any code fences it wrapped the message in, then leading blank lines.
  printf '%s' "$msg" | sed '/^```/d' | sed '/./,$!d'
}

sync_git() {
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  [ "$SYNC_GIT" -eq 1 ] || { info "git sync skipped (--no-git)"; return 0; }
  # A dry run must not rewrite history or push anything.
  [ "$DRY_RUN" -eq 0 ] || { info "git sync skipped (dry run)"; return 0; }

  local branch upstream message
  branch="$(git rev-parse --abbrev-ref HEAD)"

  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    info "staging:"
    git diff --cached --stat | sed 's/^/      /'

    if command -v grok >/dev/null; then
      info "writing a commit message…"
      message="$(commit_message)"
    else
      warn "grok not found — using a generic message"
      message=""
    fi
    [ -n "$message" ] || message="chore: pre-deploy snapshot"

    git commit -q -m "$message"
    ok "committed $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
  else
    ok "working tree clean"
  fi

  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    if [ -n "$(git log "$upstream"..HEAD --oneline)" ]; then
      git push -q && ok "pushed to $upstream"
    else
      ok "already pushed"
    fi
  else
    git push -q -u origin "$branch" && ok "pushed to origin/$branch (new upstream)"
  fi
}

step "Git"
sync_git

GIT_SHA="nogit"; GIT_DIRTY=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-commits')"
  if [ -n "$(git status --porcelain)" ]; then
    GIT_DIRTY=" (dirty)"
    warn "working tree still has uncommitted changes — deploying anyway"
  fi
  ok "deploying $GIT_SHA$GIT_DIRTY"
fi

# ─── 3. Build ────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 1 ]; then
  step "Build (skipped)"
  [ -d dist ] && [ -d server/dist ] || die "--skip-build needs existing dist/ and server/dist/"
  warn "using existing build output"
else
  step "Build"
  if [ "$CLEAN" -eq 1 ]; then
    info "clean build — removing node_modules and previous output"
    rm -rf node_modules server/node_modules dist server/dist "$PRODDEPS"
  fi

  [ -d node_modules ]        || { info "installing frontend deps…"; npm ci --no-audit --no-fund >/dev/null; }
  [ -d server/node_modules ] || { info "installing server deps…";   npm --prefix server ci --no-audit --no-fund >/dev/null; }

  rm -rf dist server/dist
  info "building frontend (tsc -b && vite build)…"
  npm run build
  info "building server (tsc)…"
  npm run build:server

  [ -f dist/index.html ]       || die "frontend build produced no dist/index.html"
  [ -f server/dist/index.js ]  || die "server build produced no server/dist/index.js"
  ok "build complete"
fi

# ─── 4. Production dependencies ──────────────────────────────────────────────
# The artifact ships with its own node_modules so zima never runs npm. These
# deps (express, systeminformation) are pure JS with no native bindings, so a
# tree resolved on macOS runs unchanged on Linux. Re-resolved only when the
# server lockfile changes.
step "Production dependencies"
LOCK_HASH="$(shasum -a 256 server/package-lock.json | cut -d' ' -f1)"
if [ -f "$PRODDEPS/.lock-hash" ] && [ "$(cat "$PRODDEPS/.lock-hash")" = "$LOCK_HASH" ] \
   && [ -d "$PRODDEPS/node_modules" ]; then
  ok "cached (server lockfile unchanged)"
else
  info "resolving production-only tree…"
  rm -rf "$PRODDEPS"; mkdir -p "$PRODDEPS"
  cp server/package.json server/package-lock.json "$PRODDEPS/"
  npm --prefix "$PRODDEPS" ci --omit=dev --no-audit --no-fund >/dev/null
  printf '%s' "$LOCK_HASH" > "$PRODDEPS/.lock-hash"
  ok "resolved $(find "$PRODDEPS/node_modules" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ') packages"
fi

if find "$PRODDEPS/node_modules" -name '*.node' -print -quit 2>/dev/null | grep -q .; then
  die "production deps contain native binaries — these will not port from macOS to Linux.
       Build them on zima, or vendor a linux-x64 tree, before deploying."
fi
ok "no native binaries — artifact is portable"

# ─── 5. Stage the artifact ───────────────────────────────────────────────────
# The stage directory is an exact mirror of what zima will hold. Anything not
# here gets deleted on the remote by rsync --delete.
step "Stage artifact"
rm -rf "$STAGE"
mkdir -p "$STAGE/server"

cp -R dist            "$STAGE/dist"           # frontend, served as static files
cp -R server/dist     "$STAGE/server/dist"    # compiled server
cp -R "$PRODDEPS/node_modules" "$STAGE/server/node_modules"
cp server/package.json server/package-lock.json "$STAGE/server/"

cat > "$STAGE/DEPLOYED" <<EOF
commit:   $GIT_SHA$GIT_DIRTY
built at: $(date -u '+%Y-%m-%dT%H:%M:%SZ') (UTC)
built by: $(whoami)@$(hostname -s)
node:     $(node --version)
source:   $REPO_ROOT
EOF

ok "staged $(du -sh "$STAGE" | cut -f1 | tr -d ' ') → dist/, server/{dist,node_modules,package.json}"

# ─── 6. Sync to the remote ───────────────────────────────────────────────────
# Conservative flag set: macOS ships openrsync (protocol 29), which does not
# support --info, --delete-delay, or --partial-dir.
step "Sync to $REMOTE_HOST:~/$REMOTE_DIR"
RSYNC_FLAGS=(-az --delete --exclude '.DS_Store')
[ "$DRY_RUN" -eq 1 ] && RSYNC_FLAGS+=(--dry-run -v)

if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY RUN — nothing will be written or restarted"
else
  remote_sh <<'REMOTE' || die "could not prepare remote directory"
set -euo pipefail
mkdir -p "$HOME/$1"
REMOTE
fi

rsync "${RSYNC_FLAGS[@]}" -e ssh "$STAGE/" "$REMOTE_HOST:$REMOTE_DIR/"
ok "synced"

if [ "$DRY_RUN" -eq 1 ]; then
  step "Dry run finished"
  info "re-run without --dry-run to deploy for real"
  exit 0
fi

# ─── 7. Install unit file (optional) ─────────────────────────────────────────
if [ "$INSTALL_SERVICE" -eq 1 ]; then
  step "Install systemd unit"
  # Render the template with this machine's local config. The rendered unit is
  # gitignored so the real paths never land in a commit.
  RENDERED="$REPO_ROOT/deploy/$SERVICE"
  sed -e "s|@REMOTE_DIR@|$REMOTE_DIR|g" \
      -e "s|@NODE_BIN@|$NODE_BIN|g" \
      -e "s|@PORT@|$HEALTH_PORT|g" \
      "$REPO_ROOT/deploy/service.template" > "$RENDERED"
  info "rendered deploy/service.template → $SERVICE"
  remote_sh <<'REMOTE' || die "could not create the systemd user directory"
set -euo pipefail
mkdir -p "$HOME/.config/systemd/user"
REMOTE
  scp -q "$RENDERED" "$REMOTE_HOST:.config/systemd/user/$SERVICE"
  remote_sh <<'REMOTE'
set -euo pipefail
systemctl --user daemon-reload
systemctl --user enable "$2"
REMOTE
  ok "unit installed and enabled"
fi

# ─── 8. Restart ──────────────────────────────────────────────────────────────
step "Restart $SERVICE"
remote_sh <<'REMOTE' || die "restart failed — run: ssh $REMOTE_HOST 'bash -c \"journalctl --user -u $SERVICE -n 50\"'"
set -euo pipefail
systemctl --user restart "$2"
REMOTE
ok "restarted"

# ─── 9. Verify ───────────────────────────────────────────────────────────────
if [ "$VERIFY" -eq 0 ]; then
  step "Verify (skipped)"
  exit 0
fi

step "Verify"
remote_sh <<'REMOTE' || die "deployment is NOT healthy — check: journalctl --user -u $SERVICE -n 50"
set -euo pipefail
DIR="$HOME/$1"; SERVICE="$2"; PORT="$3"; PATH_="$4"

for f in dist/index.html server/dist/index.js server/node_modules/express/package.json; do
  [ -e "$DIR/$f" ] || { echo "missing on remote: $f" >&2; exit 1; }
done
echo "    layout ok"

systemctl --user is-active --quiet "$SERVICE" || { echo "unit is not active" >&2; exit 1; }
echo "    unit active"

for i in $(seq 1 15); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}${PATH_}" || true)"
  [ "$code" = "200" ] && { echo "    http ${PATH_} -> 200"; exit 0; }
  sleep 1
done
echo "health check failed after 15s (last code: ${code:-none})" >&2
exit 1
REMOTE

ok "deployment healthy"
printf '\n%s✓ deployed %s%s to %s%s\n\n' "$G" "$GIT_SHA$GIT_DIRTY" "$N" "$REMOTE_HOST" ""
