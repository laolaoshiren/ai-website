const fs = require('fs');
const path = require('path');
const {
  DEFAULT_THEME_ROOT,
  themeDir,
} = require('../ai/theme-engine');
const { normalizePath, assertThemePathSafe } = require('../ai/theme-sdk');

function isSafeThemeId(themeId) {
  return /^[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*$/.test(String(themeId || ''));
}

function resolveThemeAssetPath(themeId, assetPath, options = {}) {
  if (!isSafeThemeId(themeId)) return null;
  const normalizedAsset = normalizePath(assetPath);
  if (!normalizedAsset || normalizedAsset.split('/').some(part => part === '..')) return null;
  const dir = themeDir(themeId, { rootDir: options.rootDir || DEFAULT_THEME_ROOT });
  const assetRoot = path.join(dir, 'assets');
  const fullPath = assertThemePathSafe(assetRoot, path.join(assetRoot, normalizedAsset));
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function serveThemeAsset(req, res) {
  try {
    const filePath = resolveThemeAssetPath(req.params.themeId, req.params[0] || '');
    if (!filePath) return res.status(404).send('Not found');
    res.sendFile(filePath);
  } catch {
    res.status(404).send('Not found');
  }
}

module.exports = {
  resolveThemeAssetPath,
  serveThemeAsset,
};
