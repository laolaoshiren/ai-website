#!/usr/bin/env bash
#
# One-click server installer for AI Website.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash -s -- --domain example.com
#
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/ai-website}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_PORT="${APP_PORT:-3001}"
SITE_TITLE="${SITE_TITLE:-AI Website}"
SITE_DESCRIPTION="${SITE_DESCRIPTION:-AI maintained website}"
AI_API_KEY="${AI_API_KEY:-}"
AI_BASE_URL="${AI_BASE_URL:-https://api.openai.com/v1}"
AI_MODEL="${AI_MODEL:-gpt-4o}"
AI_NAME="${AI_NAME:-AI Provider}"
NO_CADDY="${NO_CADDY:-0}"

COMPOSE_IMAGE='ghcr.io/laolaoshiren/ai-website:${IMAGE_TAG:-latest}'
APP_LOCAL_PORT='127.0.0.1:${APP_PORT:-3001}:3000'

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { printf "${CYAN}[install]${NC} %s\n" "$*"; }
ok() { printf "${GREEN}[ok]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
fail() { printf "${RED}[error]${NC} %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
AI Website one-click Docker installer

Required:
  --domain DOMAIN              Domain already resolved to this server

Optional:
  --email EMAIL                Email for Caddy ACME account
  --ai-key KEY                 Initial text AI provider key
  --ai-base-url URL            Initial text AI provider base URL
  --ai-model MODEL             Initial text AI model
  --ai-name NAME               Initial text AI provider name
  --site-title TITLE           Initial site title
  --site-description TEXT      Initial site description
  --image-tag TAG              Docker image tag, default: latest
  --app-port PORT              Local health/check port, default: 3001
  --install-dir PATH           Install directory, default: /opt/ai-website
  --no-caddy                   Do not install Caddy; expose app on 0.0.0.0:APP_PORT
  -h, --help                   Show this help

Example:
  curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash -s -- --domain your-domain.com
EOF
}

need_value() {
  [ "${2:-}" ] || fail "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) need_value "$1" "${2:-}"; DOMAIN="$2"; shift 2 ;;
    --email) need_value "$1" "${2:-}"; EMAIL="$2"; shift 2 ;;
    --ai-key) need_value "$1" "${2:-}"; AI_API_KEY="$2"; shift 2 ;;
    --ai-base-url) need_value "$1" "${2:-}"; AI_BASE_URL="$2"; shift 2 ;;
    --ai-model) need_value "$1" "${2:-}"; AI_MODEL="$2"; shift 2 ;;
    --ai-name) need_value "$1" "${2:-}"; AI_NAME="$2"; shift 2 ;;
    --site-title) need_value "$1" "${2:-}"; SITE_TITLE="$2"; shift 2 ;;
    --site-description) need_value "$1" "${2:-}"; SITE_DESCRIPTION="$2"; shift 2 ;;
    --image-tag) need_value "$1" "${2:-}"; IMAGE_TAG="$2"; shift 2 ;;
    --app-port) need_value "$1" "${2:-}"; APP_PORT="$2"; shift 2 ;;
    --install-dir) need_value "$1" "${2:-}"; INSTALL_DIR="$2"; shift 2 ;;
    --no-caddy) NO_CADDY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "Please run with sudo or as root"
[ -n "$DOMAIN" ] || fail "Missing --domain. Example: --domain your-domain.com"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || fail "--app-port must be a number"

if [ "$NO_CADDY" != "1" ]; then
  SITE_URL="${SITE_URL:-https://${DOMAIN}}"
else
  SITE_URL="${SITE_URL:-http://${DOMAIN}:${APP_PORT}}"
fi

sanitize_env_value() {
  local value="${1:-}"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

write_env_line() {
  local key="$1"
  local value
  value="$(sanitize_env_value "${2:-}")"
  printf '%s=%s\n' "$key" "$value"
}

ensure_curl() {
  if command -v curl >/dev/null 2>&1; then
    return
  fi

  log "Installing curl..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y ca-certificates curl
  else
    fail "curl is missing and no supported package manager was found"
  fi
}

ensure_docker() {
  ensure_curl

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker not found; installing Docker Engine..."
    curl -fsSL https://get.docker.com | sh
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    service docker start >/dev/null 2>&1 || true
  fi

  docker info >/dev/null 2>&1 || fail "Docker is installed but not running"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
  ok "Docker is ready"
}

backup_file() {
  local file="$1"
  if [ -f "$file" ]; then
    cp "$file" "${file}.bak.$(date +%Y%m%d%H%M%S)"
  fi
}

write_env_file() {
  backup_file "${INSTALL_DIR}/.env"
  {
    write_env_line "IMAGE_TAG" "$IMAGE_TAG"
    write_env_line "APP_PORT" "$APP_PORT"
    write_env_line "NODE_ENV" "production"
    write_env_line "PORT" "3000"
    write_env_line "SITE_URL" "$SITE_URL"
    write_env_line "SITE_TITLE" "$SITE_TITLE"
    write_env_line "SITE_DESCRIPTION" "$SITE_DESCRIPTION"
    write_env_line "AI_API_KEY" "$AI_API_KEY"
    write_env_line "AI_BASE_URL" "$AI_BASE_URL"
    write_env_line "AI_MODEL" "$AI_MODEL"
    write_env_line "AI_NAME" "$AI_NAME"
  } > "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
}

write_caddyfile() {
  mkdir -p "${INSTALL_DIR}/caddy"
  if [ -n "$EMAIL" ]; then
    cat > "${INSTALL_DIR}/caddy/Caddyfile" <<EOF
{
    email ${EMAIL}
}

${DOMAIN} {
    encode gzip zstd
    reverse_proxy ai-website:3000
}
EOF
  else
    cat > "${INSTALL_DIR}/caddy/Caddyfile" <<EOF
${DOMAIN} {
    encode gzip zstd
    reverse_proxy ai-website:3000
}
EOF
  fi
}

write_compose_file() {
  backup_file "${INSTALL_DIR}/docker-compose.yml"

  if [ "$NO_CADDY" = "1" ]; then
    cat > "${INSTALL_DIR}/docker-compose.yml" <<EOF
services:
  ai-website:
    image: ${COMPOSE_IMAGE}
    container_name: ai-website
    restart: unless-stopped
    ports:
      - "0.0.0.0:\${APP_PORT:-3001}:3000"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./public/images:/app/public/images
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - PORT=3000
EOF
  else
    write_caddyfile
    cat > "${INSTALL_DIR}/docker-compose.yml" <<EOF
services:
  ai-website:
    image: ${COMPOSE_IMAGE}
    container_name: ai-website
    restart: unless-stopped
    ports:
      - "${APP_LOCAL_PORT}"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./public/images:/app/public/images
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - PORT=3000

  caddy:
    image: caddy:2-alpine
    container_name: ai-website-caddy
    restart: unless-stopped
    depends_on:
      - ai-website
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy_data:/data
      - ./caddy_config:/config
EOF
  fi
}

wait_for_health() {
  log "Waiting for health check on http://127.0.0.1:${APP_PORT}/api/health ..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      ok "Health check passed"
      return
    fi
    sleep 2
  done

  docker logs ai-website --tail 80 || true
  fail "Service did not become healthy in time"
}

main() {
  log "Installing AI Website into ${INSTALL_DIR}"
  ensure_docker

  mkdir -p "${INSTALL_DIR}/data" "${INSTALL_DIR}/logs" "${INSTALL_DIR}/public/images" "${INSTALL_DIR}/caddy_data" "${INSTALL_DIR}/caddy_config"
  write_env_file
  write_compose_file

  log "Pulling images and starting services..."
  cd "$INSTALL_DIR"
  docker compose pull
  docker compose up -d --force-recreate
  wait_for_health

  echo
  ok "AI Website has been installed"
  if [ "$NO_CADDY" = "1" ]; then
    printf 'Website: %s\n' "$SITE_URL"
    printf 'Admin:   %s/admin\n' "$SITE_URL"
  else
    printf 'Website: https://%s\n' "$DOMAIN"
    printf 'Admin:   https://%s/admin\n' "$DOMAIN"
  fi
  printf 'Health:  http://127.0.0.1:%s/api/health\n' "$APP_PORT"
  if [ -z "$AI_API_KEY" ]; then
    warn "No --ai-key was provided. Configure AI providers in /admin before starting autonomous generation."
  fi
}

main
