/**
 * 定时任务调度器 v2 - 多 Agent 协同
 */
const cron = require('node-cron');
const { getSchedules, updateScheduleLastRun, getPlannedPages, claimPlannedPages, releasePageClaim, retryTimeAfterAttempts, recoverExpiredWritingPages, getStats, logAgent, updateAgentStatus, getAIProviders } = require('../db/database');
const { isAIConfigured } = require('../config');
const { logArticleOutcome } = require('./article-outcome');

const cronJobs = [];

function aiMeta(result = {}) {
  return { provider: result.provider || '', model: result.model || '' };
}

const AGENT_ROLES = {
  news_collector: 'news_collector',
  plan_structure: 'planner',
  generate_content: 'writer',
  seo_update: 'seo_expert',
  analyze: 'analyzer',
  template_review: 'technician',
  seo_expert_audit: 'seo_expert',
  user_test: 'user_tester',
  vision_model_scan: 'technician',
};

async function executeTask(taskType) {
  const providers = getAIProviders().filter(p => p.enabled);
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商');
  const recovered = recoverExpiredWritingPages(`before-${taskType}`);
  if (recovered > 0) {
    logAgent('site_manager', '任务自愈', 'success', `恢复 ${recovered} 篇过期写作锁文章`);
  }

  const agentRole = AGENT_ROLES[taskType] || 'technician';
  const workerId = `${agentRole}-${taskType}-${Date.now()}`;
  const logId = logAgent(agentRole, taskType, 'running', `开始执行: ${taskType}`);
  updateAgentStatus(agentRole, 'working', taskType);
  const startTime = Date.now();

  try {
    let result;
    switch (taskType) {
      case 'news_collector': {
        const { getLatestNews, searchWeb } = require('../ai/search');
        logAgent('news_collector', '采集资讯', 'running', '正在从多个信息源获取最新资讯...');
        const news = await getLatestNews(10);
        logAgent('news_collector', '采集资讯', 'success', `获取到 ${news.length} 条最新资讯`);
        result = { news: news.length };
        break;
      }
      case 'plan_structure': {
        const { planStructure } = require('../ai/planner');
        result = await planStructure();
        logAgent('planner', '结构规划', 'success', `完成: ${result.categories} 个栏目, ${result.articles} 篇计划`, aiMeta(result));
        break;
      }
      case 'generate_content': {
        let pages = claimPlannedPages(2, workerId, 45);
        const planned = pages;
        if (planned.length === 0) {
          const { planStructure } = require('../ai/planner');
          logAgent('planner', '补充规划', 'running', '待写文章不足，补充规划...');
          await planStructure();
          pages = claimPlannedPages(2, workerId, 45);
          const newPlanned = pages;
          if (newPlanned.length === 0) { result = { skipped: true }; break; }
        }
        const { generateArticle } = require('../ai/writer');
        const results = [];
        for (const page of pages) {
          try {
            logAgent('writer', '撰写文章', 'running', `撰写: ${page.title}`);
            const r = await generateArticle(page);
            logAgent('reviewer', '审核文章', 'running', `审核: ${r.title}`);
            logArticleOutcome(logAgent, page, r, { reviewerAction: '审核文章' });
            results.push(r);
          } catch (err) {
            releasePageClaim(page.id, { status: 'planned', last_error: err.message, next_retry_at: retryTimeAfterAttempts(page.attempt_count) });
            logAgent('writer', '撰写文章', 'failed', `失败: ${page.title} - ${err.message}`);
          }
        }
        result = results;
        break;
      }
      case 'seo_update': {
        const { updateSEO } = require('../ai/seo-agent');
        logAgent('seo_expert', 'SEO优化', 'running', '正在更新 Sitemap 和 SEO 文件...');
        result = await updateSEO();
        logAgent('seo_expert', 'SEO优化', 'success', `完成: ${result.pages} 个页面`, aiMeta(result));
        break;
      }
      case 'analyze': {
        const { analyzeAndAdapt } = require('../ai/analyzer');
        logAgent('analyzer', '数据分析', 'running', '正在分析流量数据...');
        result = await analyzeAndAdapt();
        logAgent('analyzer', '数据分析', 'success', `完成: ${result.insights} 条洞察`, aiMeta(result));
        break;
      }
      case 'template_review':
        logAgent('technician', '模板审查', 'success', '模板审查暂未启用');
        result = { skipped: true };
        break;
      case 'vision_model_scan': {
        const { ensureVisionProviderCapabilities, visionCapableProviderCandidates, parseAIProviderModels } = require('../ai/client');
        const activeProviders = getAIProviders().filter(p => p.enabled);
        await ensureVisionProviderCapabilities(activeProviders, { forceVisionCheck: true });
        const totalModels = activeProviders.reduce((sum, provider) => sum + parseAIProviderModels(provider.model).length, 0);
        const visionModels = visionCapableProviderCandidates(activeProviders)
          .reduce((sum, provider) => sum + parseAIProviderModels(provider.model).length, 0);
        logAgent('technician', '视觉模型能力扫描', 'success', `完成: ${visionModels}/${totalModels} 个文字模型可用于图片审核`);
        result = { providers: activeProviders.length, totalModels, visionModels };
        break;
      }
      case 'heartbeat': {
        // 心跳任务：检查内容是否充足，不足则自动规划+生成
        let planned = claimPlannedPages(2, workerId, 45);
        const stats = getStats();

        // 如果没有待写文章，先触发规划器创建新计划
        if (planned.length === 0) {
          logAgent('site_manager', '心跳检查', 'running', '待写文章为 0，触发内容规划...');
          try {
            const { planStructure } = require('../ai/planner');
            const planResult = await planStructure();
            logAgent('planner', '补充规划', 'success', `新增 ${planResult.articles} 篇计划`, aiMeta(planResult));
            planned = claimPlannedPages(2, workerId, 45);
          } catch (err) {
            logAgent('planner', '补充规划', 'failed', err.message);
          }
        }

        if (planned.length > 0) {
          logAgent('site_manager', '心跳检查', 'running', `发现 ${planned.length} 篇待写文章，自动补充`);
          const { generateArticle } = require('../ai/writer');
          for (const page of planned) {
            try {
              logAgent('writer', '撰写文章', 'running', `撰写: ${page.title}`);
              const r = await generateArticle(page);
              logArticleOutcome(logAgent, page, r, { reviewerAction: '审核文章' });
            } catch (err) {
              releasePageClaim(page.id, { status: 'planned', last_error: err.message, next_retry_at: retryTimeAfterAttempts(page.attempt_count) });
              logAgent('writer', '撰写文章', 'failed', `失败: ${page.title} - ${err.message}`);
            }
          }
        } else {
          logAgent('site_manager', '心跳检查', 'success', `文章充足 (${stats.totalArticles}篇)，等待下次检查`);
        }
        result = { planned: planned.length, articles: stats.totalArticles };
        break;
      }
      case 'seo_expert_audit': {
        const { runSEOExpert } = require('../ai/seo-expert');
        result = await runSEOExpert();
        break;
      }
      case 'user_test': {
        const { runUserTester } = require('../ai/user-tester');
        result = await runUserTester();
        break;
      }
      default:
        throw new Error(`未知任务类型: ${taskType}`);
    }

    const duration = Date.now() - startTime;
    updateAgentStatus(agentRole, 'idle', null);
    return result;
  } catch (err) {
    logAgent(agentRole, taskType, 'failed', err.message);
    updateAgentStatus(agentRole, 'error', err.message);
    throw err;
  }
}

function startScheduler() {
  if (cronJobs.length > 0) {
    console.log('调度器已运行，重启中...');
    stopScheduler();
  }
  const schedules = getSchedules();
  console.log(`\n⏰ 启动调度器 (${schedules.filter(s => s.enabled).length} 个任务)\n`);

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (!cron.validate(schedule.cron_expr)) {
      console.error(`  ❌ 无效的 cron: ${schedule.task_type} → ${schedule.cron_expr}`);
      continue;
    }

    const job = cron.schedule(schedule.cron_expr, async () => {
      console.log(`\n⏰ [${new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}] 定时触发: ${schedule.task_type}`);
      try {
        await executeTask(schedule.task_type);
        updateScheduleLastRun(schedule.id);
      } catch (err) {
        console.error(`定时任务 ${schedule.task_type} 失败:`, err.message);
      }
    });
    cronJobs.push(job);
    console.log(`  ✅ ${schedule.task_type}: ${schedule.cron_expr} (${schedule.description})`);
  }

  // 注册故障恢复回调：API 恢复后自动补充内容
  try {
    const { setRecoveryCallback } = require('../ai/client');
    setRecoveryCallback(async () => {
      console.log('🔄 故障恢复：自动触发内容生成...');
      logAgent('site_manager', '故障恢复', 'running', 'AI 提供商已恢复，自动补充内容');
      try {
        await executeTask('generate_content');
        logAgent('site_manager', '故障恢复', 'success', '故障恢复补偿完成');
      } catch (err) {
        logAgent('site_manager', '故障恢复', 'failed', err.message);
      }
    });
  } catch {}

  // 启动后立即执行一次内容生成（如果有待写文章）
  setTimeout(async () => {
    try {
      const planned = getPlannedPages(3);
      if (planned.length > 0) {
        console.log('\n🚀 启动时自动补充内容...');
        await executeTask('generate_content');
      }
    } catch (err) {
      console.error('启动时内容生成失败:', err.message);
    }
  }, 5000);
}

async function coldStart() {
  console.log('\n🚀 冷启动...\n');

  logAgent('site_manager', '冷启动', 'running', '开始初始化网站...');

  // 1. 规划
  logAgent('planner', '结构规划', 'running', '规划网站结构和内容计划...');
  const { planStructure } = require('../ai/planner');
  const planResult = await planStructure();
  logAgent('planner', '结构规划', 'success', `创建了 ${planResult.categories} 个栏目, ${planResult.articles} 篇计划`, aiMeta(planResult));

  // 2. 批量生成文章（8篇，并发3路加速）
  const planned = claimPlannedPages(8, `cold-start-${Date.now()}`, 60);
  const { generateArticle } = require('../ai/writer');
  const CONCURRENCY = 3;
  let generated = 0;
  let failed = 0;

  for (let i = 0; i < planned.length; i += CONCURRENCY) {
    const batch = planned.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (page) => {
        logAgent('writer', '撰写文章', 'running', `撰写: ${page.title}`);
        try {
          const result = await generateArticle(page);
          logArticleOutcome(logAgent, page, result, { reviewerAction: '审核发布' });
          return result;
        } catch (err) {
          releasePageClaim(page.id, { status: 'planned', last_error: err.message, next_retry_at: retryTimeAfterAttempts(page.attempt_count) });
          logAgent('writer', '撰写文章', 'failed', `失败: ${page.title} - ${err.message}`);
          throw err;
        }
      })
    );
    generated += results.filter(r => r.status === 'fulfilled' && r.value?.published).length;
    failed += results.filter(r => r.status === 'rejected').length;
  }

  // 3. SEO
  try {
    const { updateSEO } = require('../ai/seo-agent');
    await updateSEO();
    logAgent('seo_expert', 'SEO初始化', 'success', 'Sitemap 和 SEO 文件已生成');
  } catch {}

  // 4. 生成站标
  try {
    const { hasFavicon, generateFavicon } = require('../ai/favicon');
    if (!hasFavicon()) {
      logAgent('technician', '生成站标', 'running', 'AI 正在生成网站站标...');
      await generateFavicon();
      logAgent('technician', '生成站标', 'success', '站标已生成');
    }
  } catch (err) {
    logAgent('technician', '生成站标', 'failed', err.message);
  }

  logAgent('site_manager', '冷启动', 'success', `初始化完成: ${generated} 篇成功, ${failed} 篇失败`);
  const stats = getStats();
  console.log(`\n🎉 冷启动完成！已发布 ${stats.totalArticles} 篇文章, ${stats.totalCategories} 个栏目`);
  return stats;
}

function stopScheduler() {
  for (const job of cronJobs) job.stop();
  cronJobs.length = 0;
  // 停止狂暴模式
  if (rageModeTimer) { clearInterval(rageModeTimer); rageModeTimer = null; }
  rageModeActive = false;
  console.log('⏰ 调度器已停止');
}

// ============ 狂暴模式 ============
let rageModeActive = false;
let rageModeTimer = null;

/**
 * 启动狂暴模式：AI 无休止持续工作
 * @param {number} level - 并发档位 1-10
 */
function startRageMode(level = 3) {
  if (rageModeActive) { console.log('狂暴模式已在运行'); return; }
  rageModeActive = true;
  const concurrency = Math.max(1, Math.min(10, level));
  const CYCLE_INTERVAL = 10000; // 每批次间隔 10 秒

  console.log(`\n🔥 狂暴模式启动！档位 ${concurrency}，${concurrency} 路并发\n`);
  logAgent('site_manager', '狂暴模式', 'running', `档位 ${concurrency}，${concurrency} 路并发`);

  let cycleCount = 0;

  rageModeTimer = setInterval(async () => {
    if (!rageModeActive) return;

    cycleCount++;
    let planned = claimPlannedPages(concurrency, `rage-${cycleCount}-${Date.now()}`, 45);

    // 如果计划不足，先规划
    if (planned.length < concurrency) {
      try {
        const { planStructure } = require('../ai/planner');
        logAgent('planner', '狂暴规划', 'running', `第 ${cycleCount} 轮：补充规划...`);
        await planStructure();
        planned = claimPlannedPages(concurrency, `rage-${cycleCount}-${Date.now()}`, 45);
      } catch (err) {
        logAgent('planner', '狂暴规划', 'failed', err.message);
      }
    }

    if (planned.length === 0) {
      logAgent('site_manager', '狂暴模式', 'success', `第 ${cycleCount} 轮：无待写文章，等待...`);
      return;
    }

    // 并发写文章
    logAgent('site_manager', '狂暴模式', 'running', `第 ${cycleCount} 轮：${planned.length} 路并发写作`);
    const { generateArticle } = require('../ai/writer');

    const results = await Promise.allSettled(
      planned.map(async (page) => {
        const writerId = Math.floor(Math.random() * 100);
        logAgent('writer', `写手#${writerId}`, 'running', `撰写: ${page.title.slice(0, 30)}`);
        try {
          const r = await generateArticle(page);
          logArticleOutcome(logAgent, page, r, { reviewerAction: '审核' });
          return r;
        } catch (err) {
          releasePageClaim(page.id, { status: 'planned', last_error: err.message, next_retry_at: retryTimeAfterAttempts(page.attempt_count) });
          logAgent('writer', `写手#${writerId}`, 'failed', err.message.slice(0, 60));
          throw err;
        }
      })
    );

    const success = results.filter(r => r.status === 'fulfilled' && r.value?.published).length;
    const failed = results.filter(r => r.status === 'rejected').length;
    const stats = getStats();
    console.log(`🔥 第 ${cycleCount} 轮完成: ${success} 成功, ${failed} 失败 | 总计 ${stats.totalArticles} 篇`);
    logAgent('site_manager', '狂暴模式', 'success', `第 ${cycleCount} 轮: +${success} 篇 | 总计 ${stats.totalArticles} 篇`);

  }, CYCLE_INTERVAL);
}

/**
 * 获取狂暴模式状态
 */
function getRageModeStatus() {
  return { active: rageModeActive, level: parseInt(require('../config').getSetting('rage_level') || '3') };
}

module.exports = { startScheduler, stopScheduler, executeTask, coldStart, startRageMode, getRageModeStatus };
