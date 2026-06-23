const test = require('node:test');
const assert = require('node:assert/strict');

const { initDb } = require('../db/database');
const { getPlannerPrompt, getWriterPrompt } = require('../ai/prompts');
const { buildRewriteMessages } = require('../ai/humanized-writing');
const { prepareArticleForPublication } = require('../ai/writer');

test.before(async () => {
  await initDb();
});

test('writer prompt asks for human-readable articles instead of SEO report templates', () => {
  const messages = getWriterPrompt(
    'AI投资人不再抢大模型了',
    { name: '产业动态' },
    ['AI投资', '创业公司'],
    '写清楚投资人为什么从基础模型转向应用公司。',
    [],
    [{ title: '某基金合伙人谈AI投资', url: 'https://example.com/a', snippet: '投资人更关心续费和毛利。' }],
  );
  const text = messages.map((message) => message.content).join('\n');

  assert.match(text, /1200-2200/);
  assert.match(text, /禁止使用固定/);
  assert.match(text, /每 300-500 字至少/);
  assert.match(text, /不要写“本文将|本文深入|总的来说”/);
  assert.doesNotMatch(text, /字数 2000-4000 字/);
});

test('planner prompt creates specific editorial angles instead of report-style titles', () => {
  const messages = getPlannerPrompt([], [], null, [
    { title: 'AI 应用公司融资升温', date: '2026-06-24' },
  ]);
  const text = messages.map((message) => message.content).join('\n');

  assert.match(text, /18-32/);
  assert.match(text, /具体切口/);
  assert.match(text, /不要使用“深度解析/);
  assert.match(text, /读者为什么现在要看/);
});

test('publication preparation runs the style gate and stores style metadata', async () => {
  let called = false;
  const rawDraft = {
    title: '2026年AI投资冷静期复盘：资本流向了哪里？',
    summary: '本文深入探讨AI投资趋势。',
    content_md: '## 引言\n\n本文将深入剖析趋势。\n\n## 一、趋势\n\n总的来说，意义深远。',
    seo_title: 'AI投资趋势',
    seo_description: 'AI投资趋势分析',
    seo_keywords: 'AI投资, 趋势',
  };
  const improvedDraft = {
    title: 'AI投资人不再抢大模型了',
    summary: '投资人开始转向能证明续费和毛利的AI应用公司。',
    content_md: '今年的钱变谨慎了。\n\n## 钱往哪里走\n\n一个客服 Agent 团队把单次会话成本从 0.18 元压到 0.07 元后，续费谈判才推进下去。',
    seo_title: 'AI投资人不再抢大模型了',
    seo_description: 'AI投资正在从基础模型转向有续费和毛利证明的应用公司。',
    seo_keywords: 'AI投资, 大模型, 应用公司',
  };

  const prepared = await prepareArticleForPublication(rawDraft, {
    articleTitle: rawDraft.title,
    humanizeArticleDraft: async (draft) => {
      called = true;
      assert.equal(draft.title, rawDraft.title);
      return {
        status: 'rewritten',
        attempts: 1,
        draft: improvedDraft,
        audit: {
          status: 'pass',
          humanScore: 86,
          issues: [],
          metrics: { aiPhraseCount: 0, factAnchorCount: 4 },
        },
      };
    },
  });

  assert.equal(called, true);
  assert.equal(prepared.article.title, improvedDraft.title);
  assert.equal(prepared.meta.style_score, 86);
  assert.equal(prepared.meta.style_status, 'rewritten');
  assert.equal(prepared.meta.style_rewrite_attempts, 1);
  assert.equal(prepared.meta.style_issues, '[]');
});

test('rewrite prompt forbids invented facts when humanizing prose', () => {
  const messages = buildRewriteMessages(
    {
      title: 'AI投资趋势深度解析',
      summary: '本文深入分析趋势。',
      content_md: '## 引言\n\n本文将分析AI投资趋势。',
    },
    {
      issues: [{ code: 'ai_phrase_density', label: 'AI套话多', detail: '命中模板词' }],
    },
    { articleTitle: 'AI投资趋势深度解析', searchResults: [] },
  );
  const text = messages.map((message) => message.content).join('\n');

  assert.match(text, /禁止新增原文或素材里没有的数字/);
  assert.match(text, /没有来源就不要写具体百分比/);
  assert.match(text, /不要为了显得具体而编造/);
});
