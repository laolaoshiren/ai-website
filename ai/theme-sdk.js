const path = require('path');

const REQUIRED_TEMPLATES = ['home', 'article', 'category', 'archive', 'search', '404'];
const REQUIRED_PARTIALS = ['header', 'footer', 'article-card', 'pagination'];
const REQUIRED_ASSETS = ['assets/theme.css'];
const ALLOWED_SITE_TYPES = ['news', 'blog', 'cms', 'magazine', 'knowledge_base'];

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isSafeThemeRelativePath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || normalized.includes('\0')) return false;
  if (path.isAbsolute(normalized)) return false;
  if (normalized.split('/').some(part => part === '..')) return false;
  return /^(templates|partials|assets)\//.test(normalized) || normalized === 'theme.json';
}

function assertThemePathSafe(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`unsafe theme path: ${targetPath}`);
  }
  return resolved;
}

function requiredTemplateFiles() {
  return REQUIRED_TEMPLATES.map(name => `templates/${name}.ejs`);
}

function requiredPartialFiles() {
  return REQUIRED_PARTIALS.map(name => `partials/${name}.ejs`);
}

function validateThemePackage(pkg = {}) {
  const errors = [];
  const manifest = pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
  const files = pkg.files && typeof pkg.files === 'object' ? pkg.files : {};

  if (!manifest.name) errors.push('theme.json missing name');
  if (!manifest.version) errors.push('theme.json missing version');
  if (!manifest.site_type) errors.push('theme.json missing site_type');
  if (manifest.site_type && !ALLOWED_SITE_TYPES.includes(manifest.site_type)) {
    errors.push(`unsupported site_type: ${manifest.site_type}`);
  }

  for (const template of REQUIRED_TEMPLATES) {
    if (!Array.isArray(manifest.templates) || !manifest.templates.includes(template)) {
      errors.push(`theme.json missing template: ${template}`);
    }
  }
  for (const partial of REQUIRED_PARTIALS) {
    if (!Array.isArray(manifest.partials) || !manifest.partials.includes(partial)) {
      errors.push(`theme.json missing partial: ${partial}`);
    }
  }
  for (const asset of REQUIRED_ASSETS) {
    if (!Array.isArray(manifest.assets) || !manifest.assets.includes(asset)) {
      errors.push(`theme.json missing asset: ${asset}`);
    }
  }

  for (const requiredFile of [...requiredTemplateFiles(), ...requiredPartialFiles(), ...REQUIRED_ASSETS]) {
    if (!Object.prototype.hasOwnProperty.call(files, requiredFile)) {
      errors.push(`missing required file: ${requiredFile}`);
    }
  }

  for (const filePath of Object.keys(files)) {
    if (!isSafeThemeRelativePath(filePath)) errors.push(`unsafe path: ${filePath}`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_TEMPLATES,
  REQUIRED_PARTIALS,
  REQUIRED_ASSETS,
  ALLOWED_SITE_TYPES,
  normalizePath,
  isSafeThemeRelativePath,
  assertThemePathSafe,
  requiredTemplateFiles,
  requiredPartialFiles,
  validateThemePackage,
};
