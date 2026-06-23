#!/usr/bin/env bash
#
# AI 智能网站 - 一键部署脚本
# 用法: ./deploy.sh [服务器SSH别名]
#
set -euo pipefail

SERVER="${1:-tx}"
COMPOSE_DIR="/opt/ai-website"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[  ✅  ]${NC} $*"; }
warn() { echo -e "${YELLOW}[  ⚠️  ]${NC} $*"; }
err()  { echo -e "${RED}[  ❌  ]${NC} $*"; exit 1; }

cd "$SCRIPT_DIR"

# ---- Step 1: Check prerequisites ----
log "检查本地环境..."
command -v git >/dev/null || err "需要 git"
command -v ssh >/dev/null || err "需要 ssh"

# ---- Step 2: Push code to GitHub ----
log "推送代码到 GitHub..."
git add -A
if ! git diff --cached --quiet; then
  git commit -m "feat: add Docker production deployment"
fi
git push origin master
ok "代码已推送，GitHub Actions 正在构建 Docker 镜像"

# ---- Step 3: Extract local AI config and generate .env ----
log "读取本地 AI 配置并生成 .env..."
python3 -c "
import json
db = json.load(open('data/db.json'))
providers = db.get('ai_providers', [])
settings = db.get('settings', {})
p = providers[0] if providers else {}
akey = p.get('api_key', '')
lines = [
    'AI_API_KEY=' + akey,
    'AI_BASE_URL=' + p.get('base_url', 'https://api.openai.com/v1'),
    'AI_MODEL=' + p.get('model', 'gpt-4o'),
    'AI_NAME=' + p.get('name', 'AI Provider'),
    'SITE_URL=https://aiweb.bt199.com',
    'SITE_TITLE=' + settings.get('site_title', 'AI 纪元'),
    'SITE_DESCRIPTION=' + settings.get('site_description', '追踪人工智能最新进展，深度解读前沿技术'),
]
with open('/tmp/ai-website.env', 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('.env 文件已生成')
" || err "无法读取本地配置"

# ---- Step 4: Setup server ----
log "配置服务器: $SERVER..."
ssh "$SERVER" "mkdir -p $COMPOSE_DIR/data $COMPOSE_DIR/logs"

# Upload .env and docker-compose.yml
log "上传配置文件..."
scp /tmp/ai-website.env "$SERVER:$COMPOSE_DIR/.env"
scp docker-compose.yml "$SERVER:$COMPOSE_DIR/docker-compose.yml"
rm -f /tmp/ai-website.env
ok "配置文件已上传"

# ---- Step 5: Configure Caddy ----
log "配置 Caddy 反向代理..."
ssh "$SERVER" 'python3 -c "
caddyfile = \"/root/cliproxyapi/caddy/Caddyfile\"
with open(caddyfile, \"r\") as f:
    content = f.read()

if \"aiweb.bt199.com\" not in content:
    new_block = \"\"\"# AI 智能网站
aiweb.bt199.com {
    encode gzip zstd

    reverse_proxy ai-website:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }

    log {
        output file /var/log/caddy/aiweb.log {
            roll_size 20mb
            roll_keep 5
            roll_keep_for 720h
        }
    }
}

\"\"\"
    content = content.replace(\":80 {\", new_block + \":80 {\")
    with open(caddyfile, \"w\") as f:
        f.write(content)
    print(\"Caddy 配置已更新\")
else:
    print(\"Caddy 配置已存在，跳过\")
"'
ok "Caddy 配置完成"

# ---- Step 6: Pull and start ----
log "拉取镜像并启动容器..."
ssh "$SERVER" "cd $COMPOSE_DIR && docker compose pull && docker compose up -d --force-recreate"
ok "容器已启动"

# ---- Step 7: Connect to Caddy network ----
log "连接 Docker 网络..."
ssh "$SERVER" "docker network connect cliproxyapi_default ai-website 2>/dev/null || true"

# ---- Step 8: Restart Caddy ----
log "重启 Caddy..."
ssh "$SERVER" "docker restart caddy"
ok "Caddy 已重启"

# ---- Step 9: Health check ----
log "等待服务就绪（最多60秒）..."
for i in $(seq 1 30); do
  if ssh "$SERVER" "curl -sf http://localhost:3001/api/health" >/dev/null 2>&1; then
    ok "健康检查通过！"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "健康检查超时，检查容器日志..."
    ssh "$SERVER" "docker logs ai-website --tail 20"
    err "服务未就绪，请手动检查"
  fi
  sleep 2
done

# ---- Done ----
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       🎉 AI 智能网站 部署成功！                   ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  🌐 网站: https://aiweb.bt199.com                ║${NC}"
echo -e "${GREEN}║  ⚙️  后台: https://aiweb.bt199.com/admin          ║${NC}"
echo -e "${GREEN}║  📊 API:  https://aiweb.bt199.com/api/health      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
