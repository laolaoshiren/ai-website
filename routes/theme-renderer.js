const { getConfig } = require('../config');
const db = require('../db/database');
const {
  renderThemeTemplate,
  themeAssetUrl,
  DEFAULT_THEME_ROOT,
} = require('../ai/theme-engine');

function canPreviewTheme(req) {
  return !!(req && req.session && req.session.admin);
}

function activeThemeForRequest(req) {
  const previewId = req?.query?.preview_theme ? String(req.query.preview_theme) : '';
  if (previewId) {
    if (!canPreviewTheme(req)) return null;
    const preview = db.getAIThemeByThemeId(previewId);
    return preview ? preview.theme_id : null;
  }

  const config = getConfig();
  if (config.ai_theme_enabled !== '1') return null;
  if (config.theme_mode !== 'ai_active') return null;
  if (!config.active_theme_id) return null;
  const theme = db.getAIThemeByThemeId(config.active_theme_id);
  if (!theme || theme.status !== 'published') return null;
  return theme.theme_id;
}

function renderThemePage(req, res, pageName, data = {}, options = {}) {
  const themeId = activeThemeForRequest(req);
  const statusCode = options.statusCode || data.statusCode || 200;
  if (themeId) {
    try {
      const html = renderThemeTemplate(themeId, pageName, {
        ...res.locals,
        ...data,
        themeId,
        themeAssetUrl: themeAssetUrl(themeId),
      }, { rootDir: options.rootDir || DEFAULT_THEME_ROOT });
      return res.status(statusCode).send(html);
    } catch (err) {
      try {
        db.logAgent('technician', 'AI theme render fallback', 'failed', `${themeId}/${pageName}: ${err.message}`);
      } catch {}
    }
  }

  return res.status(statusCode).render(`pages/${pageName}`, data);
}

module.exports = {
  activeThemeForRequest,
  canPreviewTheme,
  renderThemePage,
};
