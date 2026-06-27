const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-theme-engine-'));
}

test('theme sdk validates required manifest files and rejects unsafe paths', () => {
  const {
    REQUIRED_TEMPLATES,
    REQUIRED_PARTIALS,
    validateThemePackage,
    assertThemePathSafe,
  } = require('../ai/theme-sdk');

  assert.deepEqual(REQUIRED_TEMPLATES, ['home', 'article', 'category', 'archive', 'search', '404']);
  assert.deepEqual(REQUIRED_PARTIALS, ['header', 'footer', 'article-card', 'pagination']);

  const valid = validateThemePackage({
    manifest: {
      name: 'AI Travel',
      version: '1.0.0',
      site_type: 'blog',
      templates: REQUIRED_TEMPLATES,
      partials: REQUIRED_PARTIALS,
      assets: ['assets/theme.css'],
    },
    files: {
      'templates/home.ejs': '<h1><%= siteTitle %></h1>',
      'templates/article.ejs': '<article><%= article.title %></article>',
      'templates/category.ejs': '<h1><%= category.name %></h1>',
      'templates/archive.ejs': '<h1>Archive</h1>',
      'templates/search.ejs': '<h1>Search</h1>',
      'templates/404.ejs': '<h1>Not found</h1>',
      'partials/header.ejs': '<header></header>',
      'partials/footer.ejs': '<footer></footer>',
      'partials/article-card.ejs': '<div></div>',
      'partials/pagination.ejs': '<nav></nav>',
      'assets/theme.css': 'body{color:#111}',
    },
  });
  assert.equal(valid.ok, true);

  const invalid = validateThemePackage({
    manifest: { name: 'Bad', version: '1.0.0', templates: ['home'], partials: [], assets: [] },
    files: { '../routes/admin.js': 'nope' },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /unsafe path/);
  assert.throws(() => assertThemePathSafe('/tmp/root', '/tmp/root/../admin.js'), /unsafe/i);
});

test('theme sdk documentation records the isolated package contract', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'theme-sdk.md'), 'utf8');

  assert.match(doc, /theme\.json/);
  assert.match(doc, /templates\/home\.ejs/);
  assert.match(doc, /partials\/pagination\.ejs/);
  assert.match(doc, /assets\/theme\.css/);
  assert.match(doc, /data\/generated-themes\/<themeId>/);
  assert.match(doc, /禁止/);
});

test('theme engine stores generated themes in an isolated data directory', () => {
  const root = makeTempRoot();
  const { saveGeneratedTheme, readThemeManifest } = require('../ai/theme-engine');
  const pkg = {
    manifest: {
      name: 'AI News',
      version: '1.0.0',
      site_type: 'news',
      templates: ['home', 'article', 'category', 'archive', 'search', '404'],
      partials: ['header', 'footer', 'article-card', 'pagination'],
      assets: ['assets/theme.css'],
    },
    files: {
      'templates/home.ejs': '<h1>news</h1>',
      'templates/article.ejs': '<h1><%= article.title %></h1>',
      'templates/category.ejs': '<h1><%= category.name %></h1>',
      'templates/archive.ejs': '<h1>archive</h1>',
      'templates/search.ejs': '<h1>search</h1>',
      'templates/404.ejs': '<h1>404</h1>',
      'partials/header.ejs': '<header></header>',
      'partials/footer.ejs': '<footer></footer>',
      'partials/article-card.ejs': '<div></div>',
      'partials/pagination.ejs': '<nav></nav>',
      'assets/theme.css': 'body{background:white}',
    },
  };

  const saved = saveGeneratedTheme(pkg, { rootDir: root, id: 'theme-test' });

  assert.equal(saved.id, 'theme-test');
  assert.equal(saved.status, 'preview');
  assert.equal(fs.existsSync(path.join(root, 'theme-test', 'theme.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'theme-test', 'templates', 'home.ejs')), true);
  assert.equal(readThemeManifest('theme-test', { rootDir: root }).name, 'AI News');
});

test('theme reviewer scores complete themes and rejects broken templates', async () => {
  const root = makeTempRoot();
  const { saveGeneratedTheme, reviewTheme } = require('../ai/theme-engine');
  const pkg = {
    manifest: {
      name: 'Complete',
      version: '1.0.0',
      site_type: 'cms',
      templates: ['home', 'article', 'category', 'archive', 'search', '404'],
      partials: ['header', 'footer', 'article-card', 'pagination'],
      assets: ['assets/theme.css'],
    },
    files: {
      'templates/home.ejs': '<html><head><title><%= siteTitle %></title><link rel="stylesheet" href="<%= themeAssetUrl %>"></head><body><a href="/archive">Archive</a></body></html>',
      'templates/article.ejs': '<html><head><meta name="description" content="<%= article.summary || metaDescription || siteDescription %>"></head><body><article><%= article.title %></article></body></html>',
      'templates/category.ejs': '<html><body><h1><%= category.name %></h1></body></html>',
      'templates/archive.ejs': '<html><body><h1>Archive</h1></body></html>',
      'templates/search.ejs': '<html><body><h1>Search</h1></body></html>',
      'templates/404.ejs': '<html><body><h1>404</h1></body></html>',
      'partials/header.ejs': '<header></header>',
      'partials/footer.ejs': '<footer></footer>',
      'partials/article-card.ejs': '<div></div>',
      'partials/pagination.ejs': '<nav></nav>',
      'assets/theme.css': ':root{--brand:#2563eb} body{font-family:sans-serif;color:#111;background:#fff}',
    },
  };
  saveGeneratedTheme(pkg, { rootDir: root, id: 'complete' });

  const report = await reviewTheme('complete', {
    rootDir: root,
    sampleData: {
      siteTitle: 'Travel Notes',
      siteDescription: 'A travel site',
      category: { name: 'Guides', slug: 'guides' },
      article: { title: 'A route', summary: 'route summary', content_html: '<p>body</p>' },
      articles: [],
      pagination: { totalPages: 1, currentPage: 1 },
    },
  });

  assert.equal(report.pass, true);
  assert.equal(report.score >= 85, true);

  const broken = structuredClone(pkg);
  broken.files['templates/home.ejs'] = '<html><body><%= missing.value %></body></html>';
  saveGeneratedTheme(broken, { rootDir: root, id: 'broken' });
  const brokenReport = await reviewTheme('broken', { rootDir: root, sampleData: report.sampleData });
  assert.equal(brokenReport.pass, false);
  assert.match(brokenReport.issues.join('\n'), /home/);
});

test('frontend agent can generate a complete theme package for an empty site', async () => {
  const { generateThemePackage } = require('../ai/theme-agent');
  const pkg = await generateThemePackage({
    site: {
      title: '山海漫游',
      description: '旅游攻略与路线灵感',
      theme: '旅游',
      direction: '路线、攻略、城市体验',
      site_type: 'blog',
    },
    articles: [],
    categories: [],
    callAIForJSON: async () => ({
      data: {
        manifest: {
          name: '山海漫游主题',
          version: '1.0.0',
          site_type: 'blog',
          templates: ['home', 'article', 'category', 'archive', 'search', '404'],
          partials: ['header', 'footer', 'article-card', 'pagination'],
          assets: ['assets/theme.css'],
        },
        files: {
          'templates/home.ejs': '<html><head><title><%= siteTitle %></title><link rel="stylesheet" href="<%= themeAssetUrl %>"></head><body><h1><%= siteTitle %></h1></body></html>',
          'templates/article.ejs': '<html><body><article><%= article.title %></article></body></html>',
          'templates/category.ejs': '<html><body><h1><%= category.name %></h1></body></html>',
          'templates/archive.ejs': '<html><body><h1>Archive</h1></body></html>',
          'templates/search.ejs': '<html><body><h1>Search</h1></body></html>',
          'templates/404.ejs': '<html><body><h1>404</h1></body></html>',
          'partials/header.ejs': '<header></header>',
          'partials/footer.ejs': '<footer></footer>',
          'partials/article-card.ejs': '<div></div>',
          'partials/pagination.ejs': '<nav></nav>',
          'assets/theme.css': 'body{background:#fff;color:#111}',
        },
        design_note: '旅游博客风格',
      },
    }),
  });

  assert.equal(pkg.manifest.site_type, 'blog');
  assert.equal(Object.keys(pkg.files).includes('templates/home.ejs'), true);
});

test('frontend agent fallback package renders all required templates', async () => {
  const root = makeTempRoot();
  const { generateThemePackage } = require('../ai/theme-agent');
  const { saveGeneratedTheme, reviewTheme } = require('../ai/theme-engine');
  const pkg = await generateThemePackage({
    site: { title: 'Fallback Site', site_type: 'cms' },
    articles: [],
    categories: [],
    callAIForJSON: async () => ({ data: {} }),
  });

  saveGeneratedTheme(pkg, { rootDir: root, id: 'fallback' });
  const report = await reviewTheme('fallback', { rootDir: root });

  assert.equal(report.pass, true);
  assert.deepEqual(report.issues, []);
});

test('theme engine tolerates common AI aliases and normalizes asset URLs', async () => {
  const root = makeTempRoot();
  const { generateThemePackage } = require('../ai/theme-agent');
  const { saveGeneratedTheme, reviewTheme, renderThemeTemplate } = require('../ai/theme-engine');
  const pkg = await generateThemePackage({
    site: { title: 'Alias Site', description: 'Readable AI site', site_type: 'blog' },
    callAIForJSON: async () => ({
      data: {
        manifest: {
          name: 'Alias Theme',
          version: '1.0.0',
          site_type: 'blog',
          templates: ['home', 'article', 'category', 'archive', 'search', '404'],
          partials: ['header', 'footer', 'article-card', 'pagination'],
          assets: ['assets/theme.css'],
        },
        files: {
          'templates/home.ejs': '<html><head><title><%= site.title %></title><link rel="stylesheet" href="/assets/theme.css"></head><body><main><h1><%= site.description %></h1></main></body></html>',
          'templates/article.ejs': '<html><head><meta name="description" content="<%= post.summary %>"><link rel="stylesheet" href="/assets/theme.css"></head><body><article><h1><%= post.title %></h1></article></body></html>',
          'templates/category.ejs': '<html><body><h1><%= category.name %></h1></body></html>',
          'templates/archive.ejs': '<html><body><h1>Archive</h1></body></html>',
          'templates/search.ejs': '<html><body><h1>Search</h1></body></html>',
          'templates/404.ejs': '<html><body><h1>404</h1></body></html>',
          'partials/header.ejs': '<header></header>',
          'partials/footer.ejs': '<footer></footer>',
          'partials/article-card.ejs': '<div></div>',
          'partials/pagination.ejs': '<nav></nav>',
          'assets/theme.css': 'body{background:#fff;color:#111;font-family:sans-serif}',
        },
      },
    }),
  });

  saveGeneratedTheme(pkg, { rootDir: root, id: 'alias-theme' });
  const report = await reviewTheme('alias-theme', { rootDir: root });
  const html = renderThemeTemplate('alias-theme', 'home', {}, { rootDir: root });

  assert.equal(report.pass, true);
  assert.match(html, /\/themes\/alias-theme\/assets\/theme\.css/);
});
