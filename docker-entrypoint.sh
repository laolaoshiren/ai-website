#!/bin/sh
set -e

echo "🚀 AI 智能网站 Docker 启动中..."

# Ensure data directories exist
mkdir -p /app/data /app/logs /app/public/images

# Auto-configure AI provider from environment variables (first run only)
if [ -n "$AI_API_KEY" ]; then
  node -e "
    const { initDb } = require('./db/database');
    (async () => {
      await initDb();
      const { getAIProviders, addAIProvider, setSetting } = require('./db/database');
      if (getAIProviders().length === 0) {
        addAIProvider({
          name: process.env.AI_NAME || 'AI Provider',
          base_url: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
          api_key: process.env.AI_API_KEY,
          model: process.env.AI_MODEL || 'gpt-4o'
        });
        setSetting('ai_loop_enabled', '1');
        console.log('✅ AI 提供商已从环境变量自动配置');
      }
    })();
  " 2>/dev/null || true
fi

# Auto-configure site settings from environment variables (first run only)
if [ -n "$SITE_URL" ]; then
  node -e "
    const { initDb } = require('./db/database');
    (async () => {
      await initDb();
      const { getSetting, setSetting } = require('./db/database');
      if (!getSetting('site_url') || getSetting('site_url') === 'http://localhost:3000') {
        if (process.env.SITE_URL) setSetting('site_url', process.env.SITE_URL);
        if (process.env.SITE_TITLE) setSetting('site_title', process.env.SITE_TITLE);
        if (process.env.SITE_DESCRIPTION) setSetting('site_description', process.env.SITE_DESCRIPTION);
        console.log('✅ 网站设置已从环境变量自动配置');
      }
    })();
  " 2>/dev/null || true
fi

exec "$@"
