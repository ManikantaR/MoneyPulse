#!/usr/bin/env bash
# coxd-deploy.sh — container-native deploy, run by the coxd orchestrator on the NAS
# when you tap "Deploy" on its board (or on an opt-in post-merge auto-deploy).
#
# Unlike deploy-to-nas.sh (which pushes from your workstation → NAS over ssh/scp),
# this runs INSIDE the coxd container, which already holds this repo at $PWD and
# talks to the host Docker via the mounted /var/run/docker.sock — so there is NO ssh
# hop. Same three phases as the human script: sync build context → build+recreate →
# migrate. Idempotent; safe to re-run (deploys current main). deploy-to-nas.sh stays
# the workstation path; keep the two in sync when the build/migrate recipe changes.
set -euo pipefail

REPO_SRC="${COXD_REPO_SRC:-$PWD}"                        # coxd sets cwd to the repo (/repo/MoneyPulse)
NAS_REPO="/volume1/docker/moneypulse/repo"              # build context the compose file expects
NAS_COMPOSE="/volume1/docker/docker-compose.moneypulse.yml"
NAS_ENV="$NAS_REPO/.env"                                 # live secrets — never in git, never overwritten

log() { echo "[coxd-deploy] $*"; }

[ -d /volume1/docker ] || { echo "[coxd-deploy] /volume1/docker not mounted — not the NAS coxd container?" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "[coxd-deploy] docker CLI missing in container" >&2; exit 2; }

# ── 1. Sync build context (authoritative, mirrors deploy-to-nas.sh) ──────────
# Prune the source trees first so a file removed/renamed in git can't linger on the
# NAS and get compiled (stale build context). Never touch the live .env.
log "sync build context: $REPO_SRC → $NAS_REPO"
mkdir -p "$NAS_REPO"
rm -rf "$NAS_REPO/apps" "$NAS_REPO/packages"
tar cf - \
    --exclude=node_modules --exclude=.git --exclude=dist --exclude=.next \
    --exclude=coverage --exclude=tmp --exclude=.turbo \
    --exclude=./.env --exclude=./.env.local \
    -C "$REPO_SRC" . | tar xf - -C "$NAS_REPO"

# Keep the repo's tracked compose file as the single source of truth on the NAS.
if [ -f "$REPO_SRC/deploy/docker-compose.moneypulse.yml" ]; then
    cp "$REPO_SRC/deploy/docker-compose.moneypulse.yml" "$NAS_COMPOSE"
fi

[ -f "$NAS_ENV" ] || { echo "[coxd-deploy] missing $NAS_ENV (live secrets) — aborting before build" >&2; exit 3; }

# ── 2. Build + recreate (api, web) ───────────────────────────────────────────
log "build api web"
docker compose -f "$NAS_COMPOSE" --env-file "$NAS_ENV" build api web
log "up -d --force-recreate api web"
docker compose -f "$NAS_COMPOSE" --env-file "$NAS_ENV" up -d --force-recreate api web

# Wait for the API to report healthy before migrating (same guard as deploy-to-nas.sh).
log "waiting for moneypulse-api health"
for _ in $(seq 1 30); do
    h="$(docker inspect --format='{{.State.Health.Status}}' moneypulse-api 2>/dev/null || echo unknown)"
    [ "$h" = "healthy" ] && { log "api healthy"; break; }
    sleep 2
done

# ── 3. Drizzle migrations (idempotent — skips already-applied) ────────────────
log "run drizzle migrations"
docker exec moneypulse-api node -e "
    const { drizzle } = require('drizzle-orm/postgres-js');
    const { migrate } = require('drizzle-orm/postgres-js/migrator');
    const postgres = require('postgres');
    const sql = postgres(process.env.DATABASE_URL);
    migrate(drizzle(sql), { migrationsFolder: './db/migrations' })
        .then(() => { console.log('Migrations complete'); return sql.end(); })
        .catch((e) => { console.error('Migration failed:', e); sql.end(); process.exit(1); });
"

log "done — MoneyPulse deployed at current main"
