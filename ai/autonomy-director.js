function countWhere(items = [], predicate) {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function averageEventValue(analytics = [], eventType) {
  const values = analytics
    .filter(event => event.event_type === eventType)
    .map(event => Number(event.value))
    .filter(Number.isFinite);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function providerErrorRate(provider = {}) {
  const requests = Number(provider.request_count || 0);
  if (requests <= 0) return 0;
  return Number(provider.error_count || 0) / requests;
}

function buildAutonomySnapshot(db = {}) {
  const pages = db.pages || [];
  const analytics = db.analytics || [];
  const providers = db.ai_providers || [];
  const logs = db.agent_logs || [];
  const qualityBlocked = countWhere(pages, page =>
    page.status === 'planned' && /style_check_failed|content_quality_repair/i.test(String(page.last_error || ''))
  );
  const jsonFailures = countWhere(logs, log =>
    log.status === 'failed' && /JSON|解析|返回内容为空/i.test(String(log.detail || ''))
  );
  const unhealthyProviders = providers
    .filter(provider => provider.enabled && Number(provider.request_count || 0) >= 5 && providerErrorRate(provider) >= 0.5)
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      errorRate: providerErrorRate(provider),
      requests: Number(provider.request_count || 0),
      errors: Number(provider.error_count || 0),
    }));

  return {
    publishedCount: countWhere(pages, page => page.status === 'published'),
    plannedCount: countWhere(pages, page => page.status === 'planned'),
    writingCount: countWhere(pages, page => page.status === 'writing'),
    qualityBlocked,
    jsonFailures,
    avgTimeOnPage: averageEventValue(analytics, 'time_on_page'),
    avgScrollDepth: averageEventValue(analytics, 'scroll_depth'),
    pageviews: countWhere(analytics, event => event.event_type === 'pageview'),
    unhealthyProviders,
  };
}

function planAutonomyActions(snapshot = {}) {
  const actions = [];

  if (snapshot.qualityBlocked >= 3) {
    actions.push({
      type: 'article_quality',
      priority: 95,
      taskType: 'generate_content',
      title: '优先修复低质待重写文章',
      reason: `${snapshot.qualityBlocked} 篇 planned 文章卡在 style_check_failed，需要带失败原因重写。`,
    });
  }

  if (snapshot.jsonFailures >= 3) {
    actions.push({
      type: 'json_reliability',
      priority: 88,
      taskType: 'generate_content',
      title: '降低 JSON 输出失败',
      reason: `最近有 ${snapshot.jsonFailures} 次 JSON/空响应失败，应优先使用健康模型并严格输出格式。`,
    });
  }

  if ((snapshot.unhealthyProviders || []).length > 0) {
    const names = snapshot.unhealthyProviders.map(provider => provider.name || `#${provider.id}`).join(', ');
    actions.push({
      type: 'provider_health',
      priority: 84,
      taskType: 'provider_maintenance',
      title: '处理高失败率 AI Provider',
      reason: `${names} 错误率超过 50%，应降权、停用或检查密钥。`,
    });
  }

  if (
    snapshot.publishedCount > 0 &&
    ((snapshot.avgTimeOnPage !== null && snapshot.avgTimeOnPage < 30) ||
      (snapshot.avgScrollDepth !== null && snapshot.avgScrollDepth < 45))
  ) {
    actions.push({
      type: 'retention',
      priority: 72,
      taskType: 'template_review',
      title: '优化阅读路径和相关推荐',
      reason: `平均停留 ${Math.round(snapshot.avgTimeOnPage || 0)} 秒，平均滚动 ${Math.round(snapshot.avgScrollDepth || 0)}%，需要增强留存入口。`,
    });
  }

  if (snapshot.plannedCount < 5) {
    actions.push({
      type: 'content_supply',
      priority: 60,
      taskType: 'plan_structure',
      title: '补充内容计划池',
      reason: `待写计划只有 ${snapshot.plannedCount || 0} 篇，需要补充未来选题。`,
    });
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 6);
}

function buildCurrentAutonomyPlan(db) {
  const snapshot = buildAutonomySnapshot(db);
  return {
    snapshot,
    actions: planAutonomyActions(snapshot),
    generated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '),
  };
}

module.exports = {
  buildAutonomySnapshot,
  planAutonomyActions,
  buildCurrentAutonomyPlan,
};
