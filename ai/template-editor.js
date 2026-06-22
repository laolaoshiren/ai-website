/**
 * 模板编辑 Agent - 修改网站模板（带安全防护）
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { callAIForJSON } = require('./client');
const { getTemplateEditorPrompt } = require('./prompts');
const { saveTemplateHistory, getLatestTemplateHistory } = require('../db/database');
const { getAnalyticsSummary } = require('../db/database');

// 允许 AI 修改的目录
const ALLOWED_PATHS = [
  path.join(__dirname, '..', 'views', 'pages'),
  path.join(__dirname, '..', 'views', 'partials'),
  path.join(__dirname, '..', 'views', 'layouts'),
  path.join(__dirname, '..', 'public', 'css', 'style.css'),
];

function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  return ALLOWED_PATHS.some(allowed => resolved.startsWith(path.resolve(allowed)));
}

async function editTemplate(templatePath, designGoal) {
  const fullPath = path.resolve(templatePath);

  // 安全检查
  if (!isPathAllowed(fullPath)) {
    throw new Error(`安全限制：不允许修改 ${templatePath}`);
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error(`模板文件不存在: ${templatePath}`);
  }

  const currentContent = fs.readFileSync(fullPath, 'utf8');
  const analyticsData = getAnalyticsSummary(30);

  // 备份当前版本
  saveTemplateHistory(templatePath, currentContent, '修改前自动备份');

  const messages = getTemplateEditorPrompt(currentContent, templatePath, analyticsData, designGoal);
  const { data, model, tokensUsed } = await callAIForJSON(messages, {
    taskType: 'template_review',
    maxTokens: 8192,
    temperature: 0.5,
  });

  const newContent = data.new_content;
  if (!newContent) throw new Error('AI 未返回新的模板内容');

  // 验证 EJS 语法
  try {
    ejs.compile(newContent);
  } catch (ejsError) {
    throw new Error(`AI 生成的模板语法错误: ${ejsError.message}，已自动回滚`);
  }

  // 写入文件
  fs.writeFileSync(fullPath, newContent, 'utf8');

  // 记录变更
  saveTemplateHistory(templatePath, newContent, data.change_note || 'AI 模板优化');

  return { file: templatePath, changeNote: data.change_note, model, tokensUsed };
}

async function rollbackTemplate(templatePath) {
  const history = getLatestTemplateHistory(templatePath);
  if (!history) throw new Error('没有可回滚的历史版本');

  const fullPath = path.resolve(templatePath);
  if (!isPathAllowed(fullPath)) throw new Error('安全限制');

  fs.writeFileSync(fullPath, history.content, 'utf8');
  return { file: templatePath, restoredFrom: history.created_at };
}

module.exports = { editTemplate, rollbackTemplate };
