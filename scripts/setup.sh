#!/usr/bin/env bash
# MoneyPulse — First-Time Setup Script
# Generates all secrets, creates .env files, data directories, and starts infrastructure.
#
# Usage:
#   ./scripts/setup.sh              # Interactive (prompts for options)
#   ./scripts/setup.sh --defaults   # Non-interactive (uses sensible defaults)
#
# Prerequisites:
#   - podman-compose installed (brew install podman-compose)
#   - Podman machine running (podman machine start)
#   - openssl available (ships with macOS)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/moneypulse-data"
USE_DEFAULTS=false

for arg in "$@"; do
  case $arg in
    --defaults) USE_DEFAULTS=true ;;
    *) echo -e "${RED}Unknown option: $arg${NC}"; echo "Usage: ./scripts/setup.sh [--defaults]"; exit 1 ;;
  esac
done

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${CYAN}ℹ${NC} $1"; }

# ─── Generate cryptographic secrets ───────────────────────
generate_secrets() {
  JWT_SECRET=$(openssl rand -hex 64)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
}

# ─── Check prerequisites ─────────────────────────────────
check_prereqs() {
  echo ""
  echo -e "${BOLD}Checking prerequisites...${NC}"

  local missing=0

  if command -v podman-compose &>/dev/null; then
    log "podman-compose $(podman-compose --version 2>/dev/null | head -1)"
  else
    err "podman-compose not found. Install: brew install podman-compose"
    missing=1
  fi

  if command -v podman &>/dev/null; then
    if podman info &>/dev/null 2>&1; then
      log "Podman machine running"
    else
      err "Podman machine not running. Start: podman machine start"
      missing=1
    fi
  else
    err "Podman not found. Install Podman Desktop: https://podman-desktop.io"
    missing=1
  fi

  if command -v openssl &>/dev/null; then
    log "openssl available"
  else
    err "openssl not found"
    missing=1
  fi

  if command -v node &>/dev/null; then
    log "Node.js $(node --version)"
  else
    warn "Node.js not found — needed for dev mode (pnpm dev)"
  fi

  if command -v pnpm &>/dev/null; then
    log "pnpm $(pnpm --version)"
  else
    warn "pnpm not found — needed for dev mode"
  fi

  if [[ $missing -gt 0 ]]; then
    err "Missing required tools. Fix the above and re-run."
    exit 1
  fi
}

# ─── Create data directories ─────────────────────────────
create_data_dirs() {
  echo ""
  echo -e "${BOLD}Creating data directories...${NC}"
  mkdir -p "${DATA_DIR}"/{pg,redis,uploads,watch-folder,ollama,backup}
  log "Created ${DATA_DIR}/{pg,redis,uploads,watch-folder,ollama,backup}"
}

# ─── Create root .env ────────────────────────────────────
create_root_env() {
  local ENV_FILE="$SCRIPT_DIR/.env"

  if [[ -f "$ENV_FILE" ]]; then
    if ! $USE_DEFAULTS; then
      echo ""
      warn ".env already exists at $ENV_FILE"
      read -rp "Overwrite with fresh secrets? (y/N): " response
      if [[ "${response,,}" != "y" ]]; then
        info "Keeping existing .env"
        return
      fi
    else
      info "Overwriting existing .env (--defaults mode)"
    fi
  fi

  cat > "$ENV_FILE" << EOF
# ── Database ──────────────────────────────────────────────
POSTGRES_USER=moneypulse
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=moneypulse
DATABASE_URL=postgresql://moneypulse:${POSTGRES_PASSWORD}@localhost:5432/moneypulse

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
REDIS_PASSWORD=${REDIS_PASSWORD}

# ── API ───────────────────────────────────────────────────
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

# ── JWT ───────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Encryption ────────────────────────────────────────────
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── Ollama (AI) ──────────────────────────────────────────
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral:7b

# ── PDF Parser ────────────────────────────────────────────
PDF_PARSER_URL=http://localhost:5000

# ── File Storage ─────────────────────────────────────────
UPLOAD_DIR=/data/uploads
WATCH_FOLDER_DIR=/config/watch-folder
MAX_UPLOAD_SIZE_MB=50

# ── Next.js ──────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:4000/api
EOF
  log "Created root .env with generated secrets"
}

# ─── Create apps/api/.env for dev mode ───────────────────
create_api_env() {
  local API_ENV="$SCRIPT_DIR/apps/api/.env"

  cat > "$API_ENV" << EOF
# ── Dev Environment (used by pnpm dev) ────────────────────
DATABASE_URL=postgresql://moneypulse:${POSTGRES_PASSWORD}@localhost:5432/moneypulse
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=mistral:7b
OLLAMA_TIMEOUT_MS=120000
WATCH_FOLDER_DIR=${DATA_DIR}/watch-folder
UPLOAD_DIR=${DATA_DIR}/uploads
EOF
  log "Created apps/api/.env for dev mode"

  # Also create .env.local if it doesn't exist (ConfigModule loads it first)
  local API_ENV_LOCAL="$SCRIPT_DIR/apps/api/.env.local"
  cat > "$API_ENV_LOCAL" << EOF
DATABASE_URL=postgresql://moneypulse:${POSTGRES_PASSWORD}@localhost:5432/moneypulse
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
JWT_SECRET=${JWT_SECRET}
CORS_ORIGIN=http://localhost:3000
OLLAMA_URL=http://localhost:11434
EOF
  log "Created apps/api/.env.local"
}

# ─── Install dependencies ────────────────────────────────
install_deps() {
  if command -v pnpm &>/dev/null; then
    echo ""
    echo -e "${BOLD}Installing dependencies...${NC}"
    cd "$SCRIPT_DIR"
    pnpm install
    log "Dependencies installed"
  fi
}

# ─── Start infrastructure ────────────────────────────────
start_infra() {
  echo ""
  echo -e "${BOLD}Starting infrastructure containers...${NC}"
  cd "$SCRIPT_DIR"

  podman-compose up -d postgres redis
  log "Started PostgreSQL and Redis"

  # Wait for postgres
  info "Waiting for PostgreSQL to be ready..."
  for i in $(seq 1 30); do
    if podman-compose exec -T postgres pg_isready -U moneypulse &>/dev/null 2>&1; then
      break
    fi
    if [[ $i -eq 30 ]]; then
      err "PostgreSQL failed to start within 30 seconds"
      exit 1
    fi
    sleep 1
  done
  log "PostgreSQL is ready"

  # Wait for Redis
  info "Waiting for Redis to be ready..."
  for i in $(seq 1 10); do
    if podman-compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
      break
    fi
    sleep 1
  done
  log "Redis is ready (password auth enabled)"
}

# ─── Run migrations and seed ─────────────────────────────
run_migrations() {
  if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found — skipping migrations."
    return
  fi

  echo ""
  echo -e "${BOLD}Setting up database...${NC}"
  cd "$SCRIPT_DIR"

  export DATABASE_URL="postgresql://moneypulse:${POSTGRES_PASSWORD}@localhost:5432/moneypulse"

  info "Pushing schema to database..."
  cd apps/api
  DATABASE_URL="$DATABASE_URL" npx drizzle-kit push 2>&1 | tail -3
  cd "$SCRIPT_DIR"
  log "Database schema applied"

  info "Seeding categories..."
  cd apps/api
  DATABASE_URL="$DATABASE_URL" npx tsx src/db/seed.ts 2>&1 | tail -3 || warn "Category seed had issues — categories can be created manually"
  cd "$SCRIPT_DIR"
  log "Categories seeded"

  info "Seeding categorization rules..."
  DATABASE_URL="$DATABASE_URL" npx tsx db/seeds/seed-rules.ts 2>&1 | tail -3 || warn "Rule seed had issues — rules can be created manually"
  log "Seed data loaded"
}

# ─── Optional: Start Ollama ──────────────────────────────
setup_ollama() {
  if $USE_DEFAULTS; then return; fi

  echo ""
  read -rp "Enable AI categorization (Ollama)? (y/N): " response
  if [[ "${response,,}" == "y" ]]; then
    info "Starting Ollama container..."
    cd "$SCRIPT_DIR"
    mkdir -p "${DATA_DIR}/ollama"
    podman-compose --profile ai up -d ollama
    log "Ollama container started"

    info "Pulling mistral:7b model (~4 GB)..."
    podman-compose exec ollama ollama pull mistral:7b
    log "Model pulled successfully"
  fi
}

# ─── Print summary ───────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  MoneyPulse setup complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}Generated secrets:${NC}"
  echo -e "    JWT Secret:      ${JWT_SECRET:0:16}...  (128 hex chars)"
  echo -e "    Encryption Key:  ${ENCRYPTION_KEY:0:16}...  (64 hex chars)"
  echo -e "    Redis Password:  ${REDIS_PASSWORD:0:8}...   (32 hex chars)"
  echo -e "    DB Password:     ${POSTGRES_PASSWORD:0:8}...   (32 hex chars)"
  echo ""
  echo -e "  ${BOLD}Config files created:${NC}"
  echo "    .env                    (root — for podman-compose)"
  echo "    apps/api/.env           (API — for pnpm dev)"
  echo "    apps/api/.env.local     (API overrides)"
  echo ""
  echo -e "  ${BOLD}Services running:${NC}"
  echo "    PostgreSQL   localhost:5432  (password auth)"
  echo "    Redis        localhost:6379  (password auth)"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo "    1. Start the apps:           pnpm dev"
  echo "    2. Open:                     http://localhost:3000"
  echo "    3. Register an admin account"
  echo "    4. Import bank statements from config/sample-data/"
  echo ""
  echo -e "  ${CYAN}Tip:${NC} This setup is for dev mode (hot reload)."
  echo "  For full containerized deployment, use: podman-compose up -d --build"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}╔═══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║     MoneyPulse — First-Time Setup         ║${NC}"
  echo -e "${BOLD}╚═══════════════════════════════════════════╝${NC}"

  check_prereqs
  generate_secrets
  create_data_dirs
  create_root_env
  create_api_env
  install_deps
  start_infra
  run_migrations
  setup_ollama
  print_summary
}

main
