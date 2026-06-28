const DEFAULT_FRONTEND_THEME = 'builtin-default';

const FRONTEND_THEMES = [
  {
    id: DEFAULT_FRONTEND_THEME,
    name: '默认模板',
    description: '当前线上使用的内置模板，稳定、兼容全部现有页面。',
    badge: '默认',
  },
  {
    id: 'aurora-press',
    name: 'Aurora Press',
    description: '全新高级资讯模板，采用杂志化排版、深浅对比和现代响应式布局。',
    badge: '新模板',
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

function getFrontendThemeView(themeOrId, pageName) {
  const themeId = typeof themeOrId === 'object' ? themeOrId.id : themeOrId;
  const resolved = resolveFrontendTheme(themeId);
  if (resolved.id === DEFAULT_FRONTEND_THEME) return `pages/${pageName}`;
  return `themes/${resolved.id}/${pageName}`;
}

function renderFrontendPage(res, pageName, data = {}) {
  const { getConfig } = require('../config');
  const theme = resolveFrontendTheme(getConfig().frontend_theme);
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
  isValidFrontendTheme,
  getFrontendThemeView,
  renderFrontendPage,
};

