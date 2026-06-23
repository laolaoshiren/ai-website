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
