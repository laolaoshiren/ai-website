const db = require('../db/database');
const { getConfig, refreshConfig } = require('../config');
const { getPublishedPages, getCategories } = require('../db/database');
const { generateThemePackage } = require('./theme-agent');
const {
  REVIEW_PASS_SCORE,
  saveGeneratedTheme,
  reviewTheme,
} = require('./theme-engine');

function retryInstruction(baseInstruction, report = {}, attempt = 1) {
  const issues = Array.isArray(report.issues) && report.issues.length
    ? report.issues.map(issue => `- ${issue}`).join('\n')
    : '- failed review without detailed issue list';
  return `${baseInstruction || ''}

Previous theme attempt failed review (attempt ${attempt}). Reviewer issues:
${issues}

You must rewrite from a blank Theme SDK package, not patch the failed layout.
Hard rules for the next attempt:
- Do not use a top horizontal category nav.
- Do not use dark neon tech portal styling.
- Do not use auto-fit/auto-fill article card grids.
- Do not use ranking/sidebar rails as the main homepage structure.
- Use a clearly different layout family such as cover/table-of-contents, paper index, document workspace, timeline without cards, atlas/index, or long-form editorial sheet.
- Mobile navigation must be compact: drawer, wrapped chips, horizontal scroll tags, or another stable mobile pattern.
- If any reviewer issue mentions "builtin-like layout fingerprint", the next theme must change the entire information architecture.`;
}

async function generateAndReviewTheme(options = {}) {
  const config = getConfig();
  const siteType = options.site_type || config.site_type || 'cms';
  const site = {
    title: config.site_title || '',
    description: config.site_description || '',
    theme: config.site_theme || '',
    direction: config.site_direction || '',
    site_type: siteType,
  };
  const articles = getPublishedPages(12);
  const categories = getCategories();
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let instruction = options.instruction || '';
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    db.logAgent('technician', 'AI theme generation', 'running', `Generating ${siteType} frontend theme (${attempt}/${maxAttempts})`);
    const pkg = await generateThemePackage({
      site,
      articles,
      categories,
      instruction,
      callAIForJSON: options.callAIForJSON,
    });
    const saved = saveGeneratedTheme(pkg, options.themeEngineOptions || {});
    const report = await reviewTheme(saved.id, { ...(options.themeEngineOptions || {}), enforceDifferentiation: true });
    const status = report.pass ? 'preview' : 'failed';

    db.addAIThemeRecord({
      theme_id: saved.id,
      name: saved.manifest.name,
      site_type: siteType,
      status,
      score: report.score,
      locked: false,
      design_note: saved.manifest.design_note || pkg.design_note || '',
      instruction,
      review_report: report,
      ai_meta: pkg.ai || null,
      preview_url: `/?preview_theme=${encodeURIComponent(saved.id)}`,
    });

    db.logAgent(
      'technician',
      'AI theme review',
      report.pass ? 'success' : 'failed',
      `${saved.id} score ${report.score}/100 (${attempt}/${maxAttempts})`,
      pkg.ai || null,
    );

    lastResult = { themeId: saved.id, package: pkg, saved, report, status, attempt, attempts: maxAttempts };
    if (report.pass) return lastResult;
    instruction = retryInstruction(options.instruction || '', report, attempt);
  }

  return lastResult;
}

function publishReviewedTheme(themeId, reportOverride = null) {
  const theme = db.getAIThemeByThemeId(themeId);
  if (!theme) throw new Error('AI theme not found');
  const report = reportOverride || theme.review_report || {};
  const score = Number(report.score ?? theme.score ?? 0);
  if (score < REVIEW_PASS_SCORE || report.pass === false) {
    throw new Error(`AI theme score ${score} is below publish threshold ${REVIEW_PASS_SCORE}`);
  }
  const published = db.publishAITheme(themeId, { score, review_report: report });
  refreshConfig();
  db.logAgent('technician', 'AI theme publish', 'success', `${themeId} published and locked`);
  return published;
}

async function ensurePublishedTheme(options = {}) {
  const config = getConfig();
  if (config.ai_theme_enabled !== '1') return { skipped: true, reason: 'disabled' };
  if (config.theme_mode === 'ai_active' && config.active_theme_id && config.ai_theme_locked === '1') {
    return { skipped: true, reason: 'locked', themeId: config.active_theme_id };
  }
  const result = await generateAndReviewTheme(options);
  if (result.report.pass) {
    publishReviewedTheme(result.themeId, result.report);
    return { ...result, published: true };
  }
  return { ...result, published: false };
}

module.exports = {
  generateAndReviewTheme,
  publishReviewedTheme,
  ensurePublishedTheme,
  retryInstruction,
};
