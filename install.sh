#!/usr/bin/env bash
#
# One-click server installer for AI Website.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash
#
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/ai-website}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_PORT="${APP_PORT:-3001}"
DOMAIN=""
ENABLE_CADDY="0"

COMPOSE_IMAGE='ghcr.io/laolaoshiren/ai-website:${IMAGE_TAG:-latest}'
APP_LOCAL_PORT='127.0.0.1:${APP_PORT:-3001}:3000'
APP_PUBLIC_PORT='0.0.0.0:${APP_PORT:-3001}:3000'

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

Run without parameters:
  curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash

The installer only asks whether to configure a reverse-proxy domain.
Leave the domain empty to skip Caddy and expose the app on port 3001.
All website, AI provider, search, image, and content settings are configured in /admin after installation.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

[ "$#" -eq 0 ] || fail "一键安装命令不需要附加参数。请直接运行：curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash"
[ "$(id -u)" -eq 0 ] || fail "请使用 sudo 或 root 运行安装脚本"
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || fail "APP_PORT 必须是数字"

prompt_domain() {
  echo
  echo "是否需要自动设置反代域名？"
  echo "输入域名将自动启用 Caddy HTTPS 反向代理；留空则跳过，只开放服务器 ${APP_PORT} 端口。"
  if [ -r /dev/tty ]; then
    read -r -p "是否需要自动设置反代域名？请输入域名（留空则跳过）: " DOMAIN < /dev/tty || DOMAIN=""
  else
    DOMAIN=""
  fi
  DOMAIN="$(printf '%s' "$DOMAIN" | tr -d '[:space:]')"
  if [ -n "$DOMAIN" ]; then
    ENABLE_CADDY="1"
    ok "将为 ${DOMAIN} 自动配置 HTTPS 反代"
  else
    ENABLE_CADDY="0"
    warn "未输入域名，将跳过反代配置。安装后请通过 http://服务器IP:${APP_PORT} 访问后台。"
  fi
}

ensure_curl() {
  if command -v curl >/dev/null 2>&1; then
    return
  fi

  log "安装 curl..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y ca-certificates curl
  else
    fail "未找到 curl，且无法识别包管理器"
  fi
}

ensure_docker() {
  ensure_curl

  if ! command -v docker >/dev/null 2>&1; then
    log "未检测到 Docker，开始安装 Docker Engine..."
    curl -fsSL https://get.docker.com | sh
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    service docker start >/dev/null 2>&1 || true
  fi

  docker info >/dev/null 2>&1 || fail "Docker 已安装但未运行"
  docker compose version >/dev/null 2>&1 || fail "需要 Docker Compose 插件"
  ok "Docker 已就绪"
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
    printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG"
    printf 'APP_PORT=%s\n' "$APP_PORT"
    printf 'NODE_ENV=production\n'
    printf 'PORT=3000\n'
    if [ "$ENABLE_CADDY" = "1" ]; then
      printf 'SITE_URL=https://%s\n' "$DOMAIN"
    fi
  } > "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
}

write_caddyfile() {
  mkdir -p "${INSTALL_DIR}/caddy"
  cat > "${INSTALL_DIR}/caddy/Caddyfile" <<EOF
${DOMAIN} {
    encode gzip zstd
    reverse_proxy ai-website:3000
}
EOF
}

write_compose_file() {
  backup_file "${INSTALL_DIR}/docker-compose.yml"

  if [ "$ENABLE_CADDY" = "1" ]; then
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
  else
    cat > "${INSTALL_DIR}/docker-compose.yml" <<EOF
services:
  ai-website:
    image: ${COMPOSE_IMAGE}
    container_name: ai-website
    restart: unless-stopped
    ports:
      - "${APP_PUBLIC_PORT}"
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
  fi
}

wait_for_health() {
  log "等待服务就绪：http://127.0.0.1:${APP_PORT}/api/health"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      ok "健康检查通过"
      return
    fi
    sleep 2
  done

  docker logs ai-website --tail 80 || true
  fail "服务未在预期时间内就绪"
}

main() {
  prompt_domain
  log "安装目录：${INSTALL_DIR}"
  ensure_docker

  mkdir -p "${INSTALL_DIR}/data" "${INSTALL_DIR}/logs" "${INSTALL_DIR}/public/images"
  if [ "$ENABLE_CADDY" = "1" ]; then
    mkdir -p "${INSTALL_DIR}/caddy_data" "${INSTALL_DIR}/caddy_config"
  fi

  write_env_file
  write_compose_file

  log "拉取镜像并启动服务..."
  cd "$INSTALL_DIR"
  docker compose pull
  docker compose up -d --force-recreate
  wait_for_health

  echo
  ok "AI 智能网站安装完成"
  if [ "$ENABLE_CADDY" = "1" ]; then
    printf '前台:   https://%s\n' "$DOMAIN"
    printf '后台:   https://%s/admin\n' "$DOMAIN"
  else
    printf '前台:   http://服务器IP:%s\n' "$APP_PORT"
    printf '后台:   http://服务器IP:%s/admin\n' "$APP_PORT"
  fi
  printf '健康:   http://127.0.0.1:%s/api/health\n' "$APP_PORT"
  warn "安装脚本不配置 AI 提供商和站点参数。请登录后台完成网站设置、AI 提供商、Tavily、生图等配置。"
}

main
