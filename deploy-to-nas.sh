#!/usr/bin/env bash
# deploy-to-nas.sh — Sync local MoneyPulse repo to NAS and rebuild containers
#
# Usage:
#   ./deploy-to-nas.sh              # Rebuild & deploy API + Web
#   ./deploy-to-nas.sh api          # Rebuild & deploy API only
#   ./deploy-to-nas.sh web          # Rebuild & deploy Web only
#   ./deploy-to-nas.sh sync-only    # Just sync code, no rebuild
#   ./deploy-to-nas.sh db:migrate   # Sync + run Drizzle migrations on NAS DB

set -euo pipefail

# ── Config ──────────────────────────────────────────────────
NAS_HOST="nas"
REPO_DIR="$HOME/repo/MyMoney"
NAS_REPO="/volume1/docker/moneypulse/repo"
NAS_COMPOSE="/volume1/docker/docker-compose.moneypulse.yml"
NAS_ENV="$NAS_REPO/.env"
TMP_ARCHIVE="/tmp/moneypulse-sync.tar.gz"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

# ── Pre-flight checks ──────────────────────────────────────
cd "$REPO_DIR" || { err "Repo not found at $REPO_DIR"; exit 1; }

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    warn "You have uncommitted changes:"
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || { log "Aborting."; exit 0; }
fi

# Check SSH connectivity
log "Testing SSH to $NAS_HOST..."
ssh -o ConnectTimeout=5 "$NAS_HOST" "echo ok" > /dev/null 2>&1 || {
    err "Cannot reach NAS via SSH. Check your connection."
    exit 1
}
ok "NAS reachable"

# ── Step 1: Sync code ──────────────────────────────────────
sync_code() {
    log "Packaging repo (excluding node_modules, .git, dist)..."
    # Use POSIX format to avoid macOS extended attributes that UGOS BusyBox tar can't parse
    COPYFILE_DISABLE=1 tar czf "$TMP_ARCHIVE" \
        --no-xattrs \
        --exclude=node_modules \
        --exclude=.git \
        --exclude=dist \
        --exclude=.next \
        --exclude=coverage \
        --exclude=tmp \
        --exclude=.turbo \
        . 2>/dev/null || \
    COPYFILE_DISABLE=1 tar czf "$TMP_ARCHIVE" \
        --exclude=node_modules \
        --exclude=.git \
        --exclude=dist \
        --exclude=.next \
        --exclude=coverage \
        --exclude=tmp \
        --exclude=.turbo \
        .

    local size
    size=$(du -h "$TMP_ARCHIVE" | cut -f1)
    log "Uploading to NAS ($size)..."
    scp -O "$TMP_ARCHIVE" "$NAS_HOST:/tmp/"

    log "Extracting on NAS..."
    ssh "$NAS_HOST" "cd $NAS_REPO && tar xzf /tmp/moneypulse-sync.tar.gz && rm /tmp/moneypulse-sync.tar.gz"

    rm -f "$TMP_ARCHIVE"
    ok "Code synced to NAS"
}

# ── Step 2: Build & deploy ─────────────────────────────────
build_and_deploy() {
    local service="$1"
    log "Building $service on NAS (this may take a few minutes)..."
    ssh "$NAS_HOST" "cd /volume1/docker && docker compose -f $NAS_COMPOSE --env-file $NAS_ENV build $service"
    ok "$service image built"

    log "Deploying $service..."
    ssh "$NAS_HOST" "cd /volume1/docker && docker compose -f $NAS_COMPOSE --env-file $NAS_ENV up -d --force-recreate $service"
    ok "$service deployed"

    # Wait for health check
    log "Waiting for $service to be healthy..."
    local attempts=0
    while [ $attempts -lt 30 ]; do
        local health
        health=$(ssh "$NAS_HOST" "docker inspect --format='{{.State.Health.Status}}' moneypulse-$service 2>/dev/null" || echo "unknown")
        if [ "$health" = "healthy" ]; then
            ok "$service is healthy"
            return 0
        fi
        sleep 2
        attempts=$((attempts + 1))
    done
    warn "$service health check timed out — check logs with: ssh nas docker logs moneypulse-$service"
}

# ── Step 3: Run migrations ─────────────────────────────────
run_migrations() {
    log "Running Drizzle migrations on NAS DB..."
    ssh "$NAS_HOST" "docker exec moneypulse-api node -e \"
        const { drizzle } = require('drizzle-orm/postgres-js');
        const { migrate } = require('drizzle-orm/postgres-js/migrator');
        const postgres = require('postgres');
        const sql = postgres(process.env.DATABASE_URL);
        const db = drizzle(sql);
        migrate(db, { migrationsFolder: './db/migrations' })
            .then(() => { console.log('Migrations complete'); sql.end(); })
            .catch(e => { console.error('Migration failed:', e); sql.end(); process.exit(1); });
    \""
    ok "Migrations complete"
}

# ── Main ────────────────────────────────────────────────────
TARGET="${1:-all}"

case "$TARGET" in
    sync-only)
        sync_code
        ;;
    api)
        sync_code
        build_and_deploy api
        ;;
    web)
        sync_code
        build_and_deploy web
        ;;
    db:migrate)
        sync_code
        build_and_deploy api
        run_migrations
        ;;
    all)
        sync_code
        build_and_deploy api
        build_and_deploy web
        ;;
    *)
        echo "Usage: $0 [api|web|all|sync-only|db:migrate]"
        exit 1
        ;;
esac

echo ""
ok "Deploy complete!"
log "View logs:  ssh nas docker logs -f moneypulse-api"
log "Open app:   http://moneypulse.home.lab"
