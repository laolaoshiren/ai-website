#!/usr/bin/env bash
#
# Installs a host-side update worker for Docker deployments.
# The web app writes data/self-update-request.json; this worker executes
# docker compose from the host and writes data/self-update-status.json.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/ai-website}"
WORKER_PATH="${INSTALL_DIR}/self-update-worker.sh"
SERVICE_PATH="/etc/systemd/system/ai-website-self-update.service"
TIMER_PATH="/etc/systemd/system/ai-website-self-update.timer"
CRON_PATH="/etc/cron.d/ai-website-self-update"

log() { printf '[self-update] %s\n' "$*"; }
warn() { printf '[self-update][warn] %s\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { echo "请使用 sudo 或 root 安装更新执行器" >&2; exit 1; }
mkdir -p "${INSTALL_DIR}/data"

cat > "${WORKER_PATH}" <<'WORKER'
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/ai-website}"
DATA_DIR="${INSTALL_DIR}/data"
REQUEST_FILE="${DATA_DIR}/self-update-request.json"
STATUS_FILE="${DATA_DIR}/self-update-status.json"
LOG_FILE="${DATA_DIR}/self-update.log"
LOCK_DIR="${DATA_DIR}/self-update.lock"

now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

json_value() {
  local key="$1"
  local file="$2"
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1
}

write_status() {
  local status="$1"
  local message="$2"
  local request_id="${3:-}"
  local target_revision="${4:-}"
  mkdir -p "$DATA_DIR"
  cat > "${STATUS_FILE}.tmp" <<JSON
{
  "worker_ready": true,
  "status": "${status}",
  "message": "${message}",
  "request_id": "${request_id}",
  "target_revision": "${target_revision}",
  "updated_at": "$(now_utc)"
}
JSON
  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

mkdir -p "$DATA_DIR"
if [ ! -f "$REQUEST_FILE" ]; then
  PREVIOUS_STATUS=""
  PREVIOUS_MESSAGE=""
  PREVIOUS_REQUEST_ID=""
  PREVIOUS_TARGET=""
  if [ -f "$STATUS_FILE" ]; then
    PREVIOUS_STATUS="$(json_value status "$STATUS_FILE")"
    PREVIOUS_MESSAGE="$(json_value message "$STATUS_FILE")"
    PREVIOUS_REQUEST_ID="$(json_value request_id "$STATUS_FILE")"
    PREVIOUS_TARGET="$(json_value target_revision "$STATUS_FILE")"
  fi
  if [ "$PREVIOUS_STATUS" = "success" ] || [ "$PREVIOUS_STATUS" = "failed" ]; then
    write_status "$PREVIOUS_STATUS" "${PREVIOUS_MESSAGE:-宿主机更新执行器就绪}" "$PREVIOUS_REQUEST_ID" "$PREVIOUS_TARGET"
  else
    write_status "idle" "宿主机更新执行器就绪"
  fi
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  write_status "running" "已有更新任务正在执行"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

REQUEST_ID="$(json_value id "$REQUEST_FILE")"
TARGET_REVISION="$(json_value target_revision "$REQUEST_FILE")"
PROCESSING_FILE="${REQUEST_FILE}.processing-${REQUEST_ID:-manual}"
mv "$REQUEST_FILE" "$PROCESSING_FILE"

write_status "running" "正在拉取镜像并重建服务" "$REQUEST_ID" "$TARGET_REVISION"
if {
  echo "[$(now_utc)] update started request=${REQUEST_ID:-unknown} target=${TARGET_REVISION:-latest}"
  cd "$INSTALL_DIR"
  docker compose pull
  docker compose up -d --force-recreate
  echo "[$(now_utc)] update finished"
} >> "$LOG_FILE" 2>&1; then
  rm -f "$PROCESSING_FILE"
  write_status "success" "更新完成，服务已重建" "$REQUEST_ID" "$TARGET_REVISION"
else
  mv "$PROCESSING_FILE" "${PROCESSING_FILE}.failed.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  write_status "failed" "更新失败，请查看 self-update.log" "$REQUEST_ID" "$TARGET_REVISION"
  exit 1
fi
WORKER

chmod +x "${WORKER_PATH}"

install_cron_worker() {
  cat > "$CRON_PATH" <<EOF
* * * * * root INSTALL_DIR=${INSTALL_DIR} ${WORKER_PATH} >/dev/null 2>&1
EOF
  chmod 644 "$CRON_PATH"
  log "cron 更新执行器已启用"
}

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; then
  cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=AI Website host-side self update worker
After=docker.service

[Service]
Type=oneshot
Environment=INSTALL_DIR=${INSTALL_DIR}
ExecStart=${WORKER_PATH}
EOF

  cat > "$TIMER_PATH" <<'EOF'
[Unit]
Description=Run AI Website self update worker every minute

[Timer]
OnBootSec=45s
OnUnitActiveSec=60s
AccuracySec=10s
Unit=ai-website-self-update.service

[Install]
WantedBy=timers.target
EOF

  if systemctl daemon-reload && systemctl enable --now ai-website-self-update.timer; then
    log "systemd 更新执行器已启用"
  else
    warn "systemd timer 启用失败，改用 cron"
    install_cron_worker
  fi
else
  install_cron_worker
fi

if INSTALL_DIR="$INSTALL_DIR" "$WORKER_PATH"; then
  log "更新执行器就绪"
else
  warn "更新执行器首次运行失败，后台会显示未就绪"
fi
