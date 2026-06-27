const db = require('../db/database');
const { getConfig, refreshConfig } = require('../config');
const { getPublishedPages, getCategories } = require('../db/database');
const { generateThemePackage } = require('./theme-agent');
const {
  REVIEW_PASS_SCORE,
  saveGeneratedTheme,
  reviewTheme,
} = require('./theme-engine');

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

  db.logAgent('technician', 'AI theme generation', 'running', `Generating ${siteType} frontend theme`);
  const pkg = await generateThemePackage({
    site,
    articles,
    categories,
    instruction: options.instruction || '',
    callAIForJSON: options.callAIForJSON,
  });
  const saved = saveGeneratedTheme(pkg, options.themeEngineOptions || {});
  const report = await reviewTheme(saved.id, options.themeEngineOptions || {});
  const status = report.pass ? 'preview' : 'failed';

  db.addAIThemeRecord({
    theme_id: saved.id,
    name: saved.manifest.name,
    site_type: siteType,
    status,
    score: report.score,
    locked: false,
    design_note: saved.manifest.design_note || pkg.design_note || '',
    instruction: options.instruction || '',
    review_report: report,
    ai_meta: pkg.ai || null,
    preview_url: `/?preview_theme=${encodeURIComponent(saved.id)}`,
  });

  db.logAgent(
    'technician',
    'AI theme review',
    report.pass ? 'success' : 'failed',
    `${saved.id} score ${report.score}/100`,
    pkg.ai || null,
  );

  return { themeId: saved.id, package: pkg, saved, report };
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
};
