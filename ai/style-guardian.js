/**
 * Detects common Chinese AI-writing tells before an article is published.
 *
 * The rules are intentionally deterministic and inspectable: they catch the
 * repeated shells we see in generated articles, then an LLM can rewrite with
 * the concrete findings as guidance.
 */

const FORMULAIC_TITLE_TERMS = [
  '深度解析',
  '深度剖析',
  '全景图',
  '复盘',
  '指南',
  '挑战与机遇',
  '重构挑战',
  '趋势解析',
  '关键技术栈',
  '落地实践',
];

const AI_PHRASE_TERMS = [
  '本文',
  '本篇文章',
  '深入探讨',
  '深度剖析',
  '深度解析',
  '系统性',
  '范式',
  '生态',
  '赋能',
  '重构',
  '核心',
  '关键',
  '趋势',
  '挑战',
  '机遇',
  '价值',
  '可衡量',
  '意义深远',
  '总的来说',
  '值得注意的是',
  '不难看出',
  '由此可见',
  '真正决定',
  '本质上',
  '底层逻辑',
];

const SUMMARY_OPENERS = [
  '本文',
  '本篇文章',
  '文章',
  '本文基于',
  '本文深入',
  '本文将',
  '随着',
  '近年来',
  '在当今',
];

const HEADING_SHELL = /^(?:引言|导语|结语|总结|展望|[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十]+[章节]|[0-9]+(?:\.[0-9]+)?\s*)/;
const FACT_ANCHOR = /(?:\d+(?:\.\d+)?%?|\d{4}年|\d+月|[A-Za-z][A-Za-z0-9+#.-]{2,}|据.{1,12}(?:报道|数据|报告)|根据.{1,18}(?:数据|报告|披露)|https?:\/\/)/g;
const MIN_BODY_LENGTH = 800;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function plainText(markdown = '') {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>#|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(markdown = '') {
  const matches = String(markdown).match(/^#{2,3}\s+(.+)$/gm) || [];
  return matches.map((line) => line.replace(/^#{2,3}\s+/, '').trim()).filter(Boolean);
}

function countTerms(text, terms) {
  const source = String(text || '');
  let count = 0;
  for (const term of terms) {
    let index = source.indexOf(term);
    while (index >= 0) {
      count += 1;
      index = source.indexOf(term, index + term.length);
    }
  }
  return count;
}

function addIssue(issues, code, label, severity, detail) {
  issues.push({ code, label, severity, detail });
}

function auditArticleStyle(draft, options = {}) {
  const minHumanScore = options.minHumanScore ?? 72;
  const title = String(draft?.title || '').trim();
  const summary = String(draft?.summary || '').trim();
  const content = String(draft?.content_md || draft?.content || '').trim();
  const body = plainText(content);
  const fullText = [title, summary, body].filter(Boolean).join('\n');
  const headings = extractHeadings(content);
  const issues = [];

  if (!body) {
    addIssue(
      issues,
      'empty_body',
      '正文为空',
      5,
      '文章没有可阅读正文，不能发布到前台、RSS 或 sitemap。'
    );
  } else if (body.length < MIN_BODY_LENGTH) {
    addIssue(
      issues,
      'thin_body',
      '正文信息量不足',
      3,
      `正文只有 ${body.length} 字，低于 ${MIN_BODY_LENGTH} 字的发布门槛。`
    );
  }

  const titleTermCount = countTerms(title, FORMULAIC_TITLE_TERMS);
  if (title.length > 34 || titleTermCount >= 2 || /20\d{2}年.+[：:]/.test(title)) {
    addIssue(
      issues,
      'formulaic_title',
      '标题像选题库或研报标题',
      3,
      '标题过长，或包含“深度解析/复盘/指南/挑战”等模板词。'
    );
  }

  const summaryOpener = SUMMARY_OPENERS.find((term) => summary.startsWith(term) || summary.includes(`${term}将`));
  if (summaryOpener || /本文.{0,16}(?:深度|深入|基于|复盘|解析|探讨)/.test(summary)) {
    addIssue(
      issues,
      'summary_ai_opener',
      '摘要使用 AI 式开场',
      3,
      '摘要从“本文/本篇文章/随着/近年来”起笔，容易像机器在介绍文章。'
    );
  }

  if (headings.length >= 3) {
    const rigidHeadings = headings.filter((heading) => HEADING_SHELL.test(heading));
    if (rigidHeadings.length / headings.length >= 0.55) {
      addIssue(
        issues,
        'rigid_heading_structure',
        '小标题结构过于工整',
        3,
        '大量标题使用“引言/一、二、三、结语”或编号结构，像模板化报告。'
      );
    }
  }

  const aiPhraseCount = countTerms(fullText, AI_PHRASE_TERMS);
  if (aiPhraseCount >= 6) {
    addIssue(
      issues,
      'ai_phrase_density',
      'AI 常见抽象词密度过高',
      3,
      `命中 ${aiPhraseCount} 个“本文/深入/趋势/生态/挑战/机遇”等高风险词。`
    );
  } else if (aiPhraseCount >= 3) {
    addIssue(
      issues,
      'ai_phrase_density',
      'AI 常见抽象词偏多',
      2,
      `命中 ${aiPhraseCount} 个高风险抽象词，建议减少套话。`
    );
  }

  const factAnchors = Array.from(new Set(fullText.match(FACT_ANCHOR) || []));
  if (body.length > 160 && factAnchors.length < 3) {
    addIssue(
      issues,
      'weak_fact_anchors',
      '缺少事实锚点',
      3,
      '正文有观点和判断，但缺少数字、产品名、来源、时间点或具体场景。'
    );
  }

  if (/(?:总的来说|综上所述|展望未来|意义深远|新的发展阶段|未来图景)/.test(body)) {
    addIssue(
      issues,
      'template_ending',
      '结尾有模板化收束',
      2,
      '结尾像通用总结或乐观展望，建议落到具体判断。'
    );
  }

  if (/(?:不是|并非|不在于|不只是|不仅是).{0,32}(?:而是|更是|而在于)|与其说.{0,32}不如说/.test(fullText)) {
    addIssue(
      issues,
      'binary_contrast_shell',
      '二分对照句式',
      1,
      '“不是 A，而是 B”可以保留，但连续出现会明显像 AI。'
    );
  }

  const paragraphLengths = String(content)
    .split(/\n{2,}/)
    .map((paragraph) => plainText(paragraph).length)
    .filter((length) => length >= 35);
  if (paragraphLengths.length >= 5) {
    const average = paragraphLengths.reduce((sum, length) => sum + length, 0) / paragraphLengths.length;
    const nearAverage = paragraphLengths.filter((length) => Math.abs(length - average) < average * 0.28).length;
    if (nearAverage / paragraphLengths.length >= 0.75) {
      addIssue(
        issues,
        'uniform_paragraph_rhythm',
        '段落节奏过于均匀',
        2,
        '多数段落长度接近，读起来像模型按同一节拍展开。'
      );
    }
  }

  const riskScore = issues.reduce((sum, issue) => sum + issue.severity, 0);
  const humanScore = clamp(100 - riskScore * 7, 0, 100);
  const status = humanScore >= minHumanScore && !issues.some((issue) => issue.severity >= 3) ? 'pass' : 'review';

  return {
    status,
    humanScore,
    riskScore,
    issues,
    metrics: {
      titleLength: title.length,
      headingCount: headings.length,
      aiPhraseCount,
      factAnchorCount: factAnchors.length,
      bodyLength: body.length,
    },
  };
}

module.exports = {
  auditArticleStyle,
};
