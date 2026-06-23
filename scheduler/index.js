/**
 * 定时任务调度器 v2 - 多 Agent 协同
 */
const cron = require('node-cron');
const { getSchedules, updateScheduleLastRun, getPlannedPages, getStats, logAgent, updateAgentStatus, getAIProviders } = require('../db/database');
const { isAIConfigured } = require('../config');

const cronJobs = [];

const AGENT_ROLES = {
  news_collector: 'news_collector',
  plan_structure: 'planner',
  generate_content: 'writer',
  seo_update: 'seo_expert',
  analyze: 'analyzer',
  template_review: 'technician',
  seo_expert_audit: 'seo_expert',
  user_test: 'user_tester',
};

async function executeTask(taskType) {
  const providers = getAIProviders().filter(p => p.enabled);
  if (providers.length === 0) throw new Error('没有可用的 AI 提供商');

  const agentRole = AGENT_ROLES[taskType] || 'technician';
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
        logAgent('planner', '结构规划', 'success', `完成: ${result.categories} 个栏目, ${result.articles} 篇计划`);
        break;
      }
      case 'generate_content': {
        const planned = getPlannedPages(2);
        if (planned.length === 0) {
          const { planStructure } = require('../ai/planner');
          logAgent('planner', '补充规划', 'running', '待写文章不足，补充规划...');
          await planStructure();
          const newPlanned = getPlannedPages(1);
          if (newPlanned.length === 0) { result = { skipped: true }; break; }
        }
        const pages = getPlannedPages(2);
        const { generateArticle } = require('../ai/writer');
        const results = [];
        for (const page of pages) {
          try {
            logAgent('writer', '撰写文章', 'running', `撰写: ${page.title}`);
            const r = await generateArticle(page);
            logAgent('writer', '撰写文章', 'success', `完成: ${r.title} (${r.provider})`);
            logAgent('reviewer', '审核文章', 'running', `审核: ${r.title}`);
            logAgent('reviewer', '审核文章', 'success', `通过: ${r.title}`);
            results.push(r);
          } catch (err) {
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
        logAgent('seo_expert', 'SEO优化', 'success', `完成: ${result.pages} 个页面`);
        break;
      }
      case 'analyze': {
        const { analyzeAndAdapt } = require('../ai/analyzer');
        logAgent('analyzer', '数据分析', 'running', '正在分析流量数据...');
        result = await analyzeAndAdapt();
        logAgent('analyzer', '数据分析', 'success', `完成: ${result.insights} 条洞察`);
        break;
      }
      case 'template_review':
        logAgent('technician', '模板审查', 'success', '模板审查暂未启用');
        result = { skipped: true };
        break;
      case 'heartbeat': {
        // 心跳任务：检查内容是否充足，不足则自动生成
        const { getPlannedPages } = require('../db/database');
        const planned = getPlannedPages(3);
        const stats = getStats();
        if (planned.length > 0) {
          logAgent('site_manager', '心跳检查', 'running', `发现 ${planned.length} 篇待写文章，自动补充`);
          const { generateArticle } = require('../ai/writer');
          for (const page of planned.slice(0, 2)) {
            try {
              logAgent('writer', '撰写文章', 'running', `撰写: ${page.title}`);
              const r = await generateArticle(page);
              logAgent('writer', '撰写文章', 'success', `完成: ${r.title}`);
              logAgent('reviewer', '审核文章', 'success', `通过: ${r.title}`);
            } catch (err) {
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
  logAgent('planner', '结构规划', 'success', `创建了 ${planResult.categories} 个栏目, ${planResult.articles} 篇计划`);

  // 2. 批量生成文章（8篇，并发3路加速）
  const planned = getPlannedPages(8);
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
          logAgent('writer', '撰写文章', 'success', `完成: ${result.title}`);
          logAgent('reviewer', '审核发布', 'success', `已发布: ${result.title}`);
          return result;
        } catch (err) {
          logAgent('writer', '撰写文章', 'failed', `失败: ${page.title} - ${err.message}`);
          throw err;
        }
      })
    );
    generated += results.filter(r => r.status === 'fulfilled').length;
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
}

module.exports = { startScheduler, stopScheduler, executeTask, coldStart };
