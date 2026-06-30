const test = require('node:test');
const assert = require('node:assert/strict');

const { auditArticleStyle } = require('../ai/style-guardian');
const { humanizeArticleDraft } = require('../ai/humanized-writing');

const aiLikeDraft = {
  title: '2026年AI投资冷静期复盘：资本流向了哪里？什么样的AI公司拿到了钱？',
  summary: '本文基于最新数据，深度复盘资本从基础模型向垂直应用、从纯软件向软硬一体、从通用技术向场景深化的三大核心流向转变。',
  content_md: [
    '## 引言：从狂热到理性，2026年AI投融资进入价值验证期',
    '',
    '2026年上半年，全球人工智能投融资市场呈现出与前几年截然不同的态势。本文将深入剖析资本趋势，解码资金流向的三大关键转变。',
    '',
    '## 一、资本流向的三大结构性转变',
    '',
    '资本的新选择是深度融入特定行业场景，创造可衡量商业价值。',
    '',
    '## 二、投资机构青睐的AI公司画像',
    '',
    '真正决定公司估值的是技术壁垒、商业化能力与合规适应性。',
    '',
    '## 三、展望：冷静期孕育新黄金时代',
    '',
    '总的来说，这一趋势意义深远，标志着行业进入新的发展阶段。',
  ].join('\n'),
};

const humanDraft = {
  title: 'AI投资人不再抢大模型了',
  summary: '今年的钱开始流向能直接落地的AI公司。基础模型仍然重要，但投资人更关心客户是否续费、推理成本是否降下来。',
  content_md: [
    '今年上半年，几个投资人聊到同一件事：他们还看基础模型，但出手慢了。',
    '',
    '原因不玄。训练成本还在涨，客户预算却更谨慎。一个做客服 Agent 的团队给出的数字更直白：5 月份他们把单次会话成本从 0.18 元压到 0.07 元，续费谈判才真正推进下去。',
    '',
    '## 钱往哪里走',
    '',
    '第一类是能省钱的工具。不是演示视频好看，而是上线后能少雇几个人、少开几台机器、少等几分钟。',
    '',
    '第二类是懂行业数据的公司。医疗、法律、工业质检都一样，客户不缺聊天机器人，缺的是能接进旧系统、能解释结果、出错后有人兜底的产品。',
    '',
    '## 这对创业公司意味着什么',
    '',
    '融资故事要变短。以前可以讲模型路线图，现在要先说三个数字：获客成本、毛利率、客户留存。',
    '',
    '这类变化已经反映到条款里。一个做工业质检模型的团队说，去年客户还愿意为“模型准确率 95%”买单，今年合同里新增了现场误报率、返工时间、推理成本三项指标。销售周期没变短，但验收标准变硬了。',
    '',
    '也有钱继续投向基础设施，只是理由变了。GPU 调度、模型压缩、私有化部署这些公司还在融资，因为它们能直接降低每月账单。某云厂商渠道商给出的报价显示，同样 100 万次调用，客户愿意多花钱买稳定 SLA，却不愿再为一个泛泛的“更聪明模型”付溢价。',
    '',
    '对创业者来说，这不是坏消息。它逼团队早点面对真实客户：谁在用、每天用几次、坏一次谁负责、续费预算从哪个部门出。能答清楚这些问题的公司，融资不一定快，但谈判桌上会轻松很多。',
    '',
    '投资人内部的评审表也在变。以前一页 PPT 里最显眼的是模型参数、榜单排名和创始团队履历；现在排在前面的通常是试点转正式的比例、单客户部署周期、客户侧需要投入多少工程人天。一个华东的 SaaS 团队把实施周期从 42 天压到 19 天后，才拿到老客户扩容订单。',
    '',
    '还有一个容易被忽略的变化：客户开始要求退出方案。合同里会写清楚数据怎么导出、模型服务中断后谁接管、提示词和工作流资产归谁。这些条款听起来不性感，但能减少采购部门的阻力。真正能签下来的 AI 产品，往往先解决了这些琐碎问题。',
    '',
    '这不浪漫，但更接近真实生意。',
  ].join('\n'),
};

function issueCodes(audit) {
  return new Set(audit.issues.map((issue) => issue.code));
}

test('flags formulaic AI article style before publication', () => {
  const audit = auditArticleStyle(aiLikeDraft);
  const codes = issueCodes(audit);

  assert.equal(audit.status, 'review');
  assert.ok(audit.humanScore < 72, `expected low human score, got ${audit.humanScore}`);
  assert.ok(codes.has('formulaic_title'));
  assert.ok(codes.has('summary_ai_opener'));
  assert.ok(codes.has('rigid_heading_structure'));
  assert.ok(codes.has('ai_phrase_density'));
  assert.ok(codes.has('weak_fact_anchors'));
});

test('passes direct article style with concrete details and varied rhythm', () => {
  const audit = auditArticleStyle(humanDraft);

  assert.equal(audit.status, 'pass');
  assert.ok(audit.humanScore >= 78, `expected strong human score, got ${audit.humanScore}`);
  assert.equal(audit.issues.filter((issue) => issue.severity >= 3).length, 0);
});

test('blocks empty and too-short articles before publication', () => {
  const emptyAudit = auditArticleStyle({
    title: '只有标题没有正文',
    summary: '摘要看起来正常，但正文为空。',
    content_md: '',
  });
  const shortAudit = auditArticleStyle({
    title: 'MCP落地避坑',
    summary: '这篇文章太短，不应该进入发布队列。',
    content_md: '一个数据库权限穿透案例说明，MCP 接入不是把工具挂上去就结束。2026 年 6 月，一个团队在灰度环境里发现查询权限没有按租户隔离。',
  });

  assert.equal(emptyAudit.status, 'review');
  assert.ok(issueCodes(emptyAudit).has('empty_body'));
  assert.equal(shortAudit.status, 'review');
  assert.ok(issueCodes(shortAudit).has('thin_body'));
});

test('rewrites AI-flavored drafts until the style gate passes', async () => {
  let calls = 0;
  const result = await humanizeArticleDraft(aiLikeDraft, {
    minHumanScore: 78,
    maxRewriteRounds: 2,
    rewriteFn: async ({ draft, audit }) => {
      calls += 1;
      assert.equal(draft.title, aiLikeDraft.title);
      assert.equal(audit.status, 'review');
      return humanDraft;
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, 'rewritten');
  assert.equal(result.attempts, 1);
  assert.equal(result.draft.title, humanDraft.title);
  assert.ok(result.audit.humanScore >= 78);
});

test('default humanizing rewrite carries creator model into reviewer routing', async () => {
  const client = require('../ai/client');
  const original = client.callAIForJSON;
  let capturedOptions = null;

  client.callAIForJSON = async (messages, options) => {
    capturedOptions = options;
    assert.ok(messages.length >= 2);
    return { data: humanDraft, provider: 'Reviewer AI', model: 'claude-4.8-opus' };
  };

  try {
    const result = await humanizeArticleDraft(aiLikeDraft, {
      minHumanScore: 78,
      maxRewriteRounds: 1,
      context: {
        creatorModel: 'gpt-4.1-mini',
      },
    });

    assert.equal(result.status, 'rewritten');
    assert.equal(result.reviewerMeta.provider, 'Reviewer AI');
    assert.equal(result.reviewerMeta.model, 'claude-4.8-opus');
    assert.equal(capturedOptions.taskType, 'style_review');
    assert.equal(capturedOptions.reviewCapability, 'writing');
    assert.equal(capturedOptions.preferReviewerOverModel, 'gpt-4.1-mini');
  } finally {
    client.callAIForJSON = original;
  }
});

test('publication preparation stores reviewer model metadata when a rewrite uses LLM', async () => {
  const { prepareArticleForPublication } = require('../ai/writer');
  const prepared = await prepareArticleForPublication(aiLikeDraft, {
    articleTitle: aiLikeDraft.title,
    humanizeArticleDraft: async () => ({
      status: 'rewritten',
      attempts: 1,
      draft: humanDraft,
      audit: { status: 'pass', humanScore: 88, issues: [], metrics: {} },
      reviewerMeta: {
        provider: 'OpenRouter',
        model: 'claude-4.8-opus',
        reason: 'stronger_model',
      },
    }),
  });

  assert.equal(prepared.meta.reviewer_provider, 'OpenRouter');
  assert.equal(prepared.meta.reviewer_model, 'claude-4.8-opus');
  assert.equal(prepared.meta.reviewer_reason, 'stronger_model');
});
