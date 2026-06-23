/**
 * 一键启动脚本
 * 自动初始化数据库、设置管理员密码、迁移旧配置、启动服务器
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initDb, setAdminPassword, addAIProvider, getAIProviders, setSetting, getAdmin } = require('./database');

async function bootstrap() {
  await initDb();

  // 设置默认管理员密码 (admin)
  const admin = getAdmin();
  if (!admin.setup) {
    setAdminPassword(crypto.createHash('sha256').update('admin').digest('hex'));
    console.log('✅ 管理员密码已设置为: admin');
  }

  // 旧服务器迁移逻辑已移除（无用代码，原为 fetch localhost:3000）

  // 检查是否有 AI 提供商
  if (getAIProviders().length === 0) {
    // 检查环境变量
    const envKey = process.env.AI_API_KEY;
    const envUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const envModel = process.env.AI_MODEL || 'gpt-4o';
    const envName = process.env.AI_NAME || 'AI Provider';

    if (envKey) {
      addAIProvider({ name: envName, base_url: envUrl, api_key: envKey, model: envModel });
      console.log(`✅ 从环境变量添加提供商: ${envModel}`);
      setSetting('ai_loop_enabled', '1');
    } else {
      console.log('');
      console.log('⚠️  没有配置 AI 提供商！请通过以下方式之一配置:');
      console.log('   1. 设置环境变量: AI_API_KEY=你的key npm start');
      console.log('   2. 访问 http://localhost:3000/admin/providers 手动添加');
      console.log('');
    }
  }
}

module.exports = { bootstrap };
