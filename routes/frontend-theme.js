const DEFAULT_FRONTEND_THEME = 'builtin-default';

const FRONTEND_THEMES = [
  {
    id: DEFAULT_FRONTEND_THEME,
    name: '默认模板',
    description: '当前线上使用的内置模板，稳定兼容全部现有页面。',
    badge: '默认',
  },
  {
    id: 'aurora-press',
    name: '极光刊物',
    description: '高级资讯模板，采用杂志化排版、清晰层级和现代响应式布局。',
    badge: '杂志',
  },
  {
    id: 'ink-scroll',
    name: '墨韵长卷',
    description: '适合深度阅读和知识沉淀的长卷式模板，强调留白、节奏和文字质感。',
    badge: '阅读',
  },
  {
    id: 'star-harbor',
    name: '星港简报',
    description: '面向资讯站和快讯站的现代简报模板，突出信息密度、扫描效率和醒目导读。',
    badge: '简报',
  },
];

const THEME_IDS = new Set(FRONTEND_THEMES.map(theme => theme.id));

function listFrontendThemes() {
  return FRONTEND_THEMES.map(theme => ({ ...theme }));
}

function resolveFrontendTheme(themeId) {
  const id = String(themeId || '').trim();
  return FRONTEND_THEMES.find(theme => theme.id === id) || FRONTEND_THEMES[0];
}

function isValidFrontendTheme(themeId) {
  return THEME_IDS.has(String(themeId || '').trim());
}

function resolveFrontendThemeForRequest(req, config) {
  const previewThemeId = String(req?.query?.preview_theme || '').trim();
  if (previewThemeId && isValidFrontendTheme(previewThemeId)) {
    return resolveFrontendTheme(previewThemeId);
  }
  return resolveFrontendTheme(config?.frontend_theme);
}

function attachFrontendThemePreview(req, res, next) {
  const { getConfig } = require('../config');
  res.locals.previewFrontendTheme = resolveFrontendThemeForRequest(req, getConfig());
  next();
}

function getFrontendThemeView(themeOrId, pageName) {
  const themeId = typeof themeOrId === 'object' ? themeOrId.id : themeOrId;
  const resolved = resolveFrontendTheme(themeId);
  if (resolved.id === DEFAULT_FRONTEND_THEME) return `pages/${pageName}`;
  return `themes/${resolved.id}/${pageName}`;
}

function renderFrontendPage(res, pageName, data = {}) {
  const { getConfig } = require('../config');
  const theme = resolveFrontendTheme(
    data.previewFrontendThemeId ||
    data.frontendThemeId ||
    res.locals?.previewFrontendTheme?.id ||
    getConfig().frontend_theme
  );
  const view = getFrontendThemeView(theme, pageName);
  const fallbackView = getFrontendThemeView(DEFAULT_FRONTEND_THEME, pageName);
  const payload = {
    ...data,
    activeFrontendTheme: theme,
  };

  if (view === fallbackView) return res.render(fallbackView, payload);

  return res.render(view, payload, (err, html) => {
    if (!err) return res.send(html);
    console.error(`Frontend theme "${theme.id}" failed on page "${pageName}":`, err.message);
    return res.render(fallbackView, { ...payload, activeFrontendTheme: resolveFrontendTheme(DEFAULT_FRONTEND_THEME) });
  });
}

module.exports = {
  DEFAULT_FRONTEND_THEME,
  listFrontendThemes,
  resolveFrontendTheme,
  resolveFrontendThemeForRequest,
  isValidFrontendTheme,
  attachFrontendThemePreview,
  getFrontendThemeView,
  renderFrontendPage,
};
