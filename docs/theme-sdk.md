# AI Theme SDK

AI 主题引擎的核心原则：LLM Agent 只生成隔离主题包，不直接修改系统文件、后台页面、数据库结构或内置模板。系统会优先使用已发布且锁定的 AI 主题；任何渲染失败都会自动回退内置主题。

## Package Location

每个主题必须写入独立目录：

```text
data/generated-themes/<themeId>/
```

主题包内只允许以下目录和文件：

```text
theme.json
templates/home.ejs
templates/article.ejs
templates/category.ejs
templates/archive.ejs
templates/search.ejs
templates/404.ejs
partials/header.ejs
partials/footer.ejs
partials/article-card.ejs
partials/pagination.ejs
assets/theme.css
```

## theme.json

`theme.json` 必须包含：

```json
{
  "name": "Theme name",
  "version": "1.0.0",
  "site_type": "blog",
  "templates": ["home", "article", "category", "archive", "search", "404"],
  "partials": ["header", "footer", "article-card", "pagination"],
  "assets": ["assets/theme.css"],
  "design_note": "Short design rationale"
}
```

允许的网站类型：

```text
news, blog, cms, magazine, knowledge_base
```

## Runtime Variables

模板可以读取这些变量：

```text
siteTitle, siteDescription, siteLanguage, siteUrl, currentPath
categories, featured, latest, articles, article, category
pagination, q, total, months, allArticles
metaDescription, metaKeywords
prevArticle, nextArticle, relatedArticles, topicPath, wordCount, readTime
themeId, themeAssetUrl, pageName
```

## Forbidden Behavior

禁止 AI 主题做以下事情：

- 禁止写入 `views/`、`routes/`、`public/css/style.css`、`public/js/`、`db/`、`scheduler/` 等系统目录。
- 禁止引用 `../`、绝对路径、空字节路径或 `templates/` 以外的模板越权路径。
- 禁止生成后台管理页面主题。
- 禁止删除或覆盖内置主题。
- 禁止依赖外部脚本完成核心渲染。
- 禁止在 CSS 中制造明显移动端横向溢出。

## Review And Publish

AI 主题生成后必须先进入 `preview` 状态。Theme Reviewer Agent 会渲染 `home`、`article`、`category`、`archive`、`search`、`404`，检查 EJS 编译、SEO 结构、CSS 加载、链接和移动端溢出风险。默认评分阈值是 `85/100`。

只有评分达到阈值的主题才能发布。发布后主题会设置 `locked=true`，定时任务不会自动重写。管理员手动重写或输入修改要求时，系统创建新版本，不删除历史版本。
