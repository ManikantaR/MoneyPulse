#!/usr/bin/env bash
# MoneyPulse — Reset Script
# Wipes all local data and re-initialises the database from scratch.
#
# Usage:
#   ./scripts/reset.sh              # Interactive (asks before destructive actions)
#   ./scripts/reset.sh --force      # Non-interactive (skips confirmation)
#   ./scripts/reset.sh --db-only    # Reset database only (keep uploads, watch-folder)
#
# Works with both:
#   - Dev Mode (infra-only containers, apps run locally)
#   - Full Podman Compose mode (everything containerised)
#
# Prerequisites:
#   - podman-compose installed
#   - .env file configured (POSTGRES_PASSWORD, JWT_SECRET)
#   - pnpm available for migrations/seed

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DATA_DIR="$HOME/moneypulse-data"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FORCE=false
DB_ONLY=false

for arg in "$@"; do
  case $arg in
    --force) FORCE=true ;;
    --db-only) DB_ONLY=true ;;
    *) echo -e "${RED}Unknown option: $arg${NC}"; exit 1 ;;
  esac
done

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

confirm() {
  if $FORCE; then return 0; fi
  echo ""
  echo -e "${RED}⚠ WARNING: This will permanently delete all MoneyPulse data!${NC}"
  if $DB_ONLY; then
    echo "  - PostgreSQL database (users, accounts, transactions, budgets, etc.)"
    echo "  - Redis cache and queues"
  else
    echo "  - PostgreSQL database (users, accounts, transactions, budgets, etc.)"
    echo "  - Redis cache and queues"
    echo "  - Uploaded files"
    echo "  - Watch-folder contents"
    echo "  - Backup files"
  fi
  echo ""
  read -rp "Type 'RESET' to confirm: " response
  if [[ "$response" != "RESET" ]]; then
    echo "Aborted."
    exit 0
  fi
}

# ─── Load .env for DATABASE_URL ───────────────────────────
load_env() {
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    # shellcheck disable=SC2046
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
  fi

  POSTGRES_USER="${POSTGRES_USER:-moneypulse}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD not set. Configure .env first.}"
  POSTGRES_DB="${POSTGRES_DB:-moneypulse}"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
}

# ─── Detect running mode ─────────────────────────────────
detect_compose() {
  if command -v podman-compose &>/dev/null; then
    COMPOSE_CMD="podman-compose"
  elif command -v podman &>/dev/null && podman compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="podman compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  elif command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  else
    err "Neither podman-compose nor docker compose found."
    exit 1
  fi
}

# ─── Main ─────────────────────────────────────────────────
main() {
  cd "$SCRIPT_DIR"
  detect_compose
  load_env
  confirm

  echo ""
  echo "Resetting MoneyPulse..."
  echo ""

  # Step 1: Stop containers
  log "Stopping containers..."
  $COMPOSE_CMD down 2>/dev/null || true

  # Step 2: Wipe data directories
  log "Wiping data directories..."
  rm -rf "${DATA_DIR}/pg"/* 2>/dev/null || true
  rm -rf "${DATA_DIR}/redis"/* 2>/dev/null || true

  if ! $DB_ONLY; then
    rm -rf "${DATA_DIR}/uploads"/* 2>/dev/null || true
    rm -rf "${DATA_DIR}/watch-folder"/* 2>/dev/null || true
    rm -rf "${DATA_DIR}/backup"/* 2>/dev/null || true
    log "Wiped: pg, redis, uploads, watch-folder, backup"
  else
    log "Wiped: pg, redis (uploads and watch-folder preserved)"
  fi

  # Step 3: Recreate data dirs (in case rm removed them entirely)
  mkdir -p "${DATA_DIR}"/{pg,redis,uploads,watch-folder,ollama,backup}

  # Step 4: Start infrastructure
  log "Starting containers..."
  if [[ -f docker-compose.dev.yml ]]; then
    $COMPOSE_CMD -f docker-compose.yml -f docker-compose.dev.yml up -d 2>/dev/null || \
    $COMPOSE_CMD up -d
  else
    $COMPOSE_CMD up -d
  fi

  # Step 5: Wait for postgres to be ready
  log "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T postgres pg_isready -U "$POSTGRES_USER" &>/dev/null 2>&1; then
      break
    fi
    if [[ $i -eq 30 ]]; then
      err "PostgreSQL failed to start within 30 seconds"
      exit 1
    fi
    sleep 1
  done
  log "PostgreSQL is ready"

  # Step 6: Run migrations
  log "Running database migrations..."
  if command -v pnpm &>/dev/null; then
    pnpm --filter @moneypulse/api run db:migrate
  else
    warn "pnpm not found — skipping migrations. Run manually:"
    warn "  DATABASE_URL=$DATABASE_URL pnpm --filter @moneypulse/api run db:migrate"
  fi

  # Step 7: Seed categories and rules
  log "Seeding default categories and rules..."
  if command -v pnpm &>/dev/null; then
    pnpm --filter @moneypulse/api run db:seed
  else
    warn "pnpm not found — skipping seed. Run manually:"
    warn "  DATABASE_URL=$DATABASE_URL pnpm --filter @moneypulse/api run db:seed"
  fi

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  MoneyPulse reset complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Start the apps:  pnpm dev"
  echo "  2. Open http://localhost:3000"
  echo "  3. Register a new admin account"
  echo "  4. Add bank accounts and import transactions"
  echo ""
}

main
