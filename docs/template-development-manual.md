# 前台模板开发操作手册

本文档用于指导真人开发者或 AI Agent 在不了解源码细节的情况下，为本站开发新的前台模板。模板只负责前台展示，不允许改动后台、数据库、Agent、文章生成、栏目生成、AI 提供商等核心逻辑。

## 1. 模板目标

- 每套模板必须是独立前台视觉方案。
- 现有默认模板永远保留，作为稳定兜底。
- 新模板通过后台“模板设置”切换启用。
- 模板失败时，系统会回退默认模板。
- 模板不能直接修改文章数据、栏目数据或系统设置。

## 2. 目录结构

新增模板时使用以下目录：

```text
views/themes/<template-id>/
  home.ejs
  article.ejs
  category.ejs
  archive.ejs
  search.ejs
  404.ejs
  partials/
    head.ejs
    header.ejs
    footer.ejs
    article-card.ejs
    pagination.ejs

public/css/themes/<template-id>.css
```

`<template-id>` 必须只使用小写字母、数字和短横线，例如：

```text
aurora-press
modern-cms
food-journal
```

## 3. 必需页面

每套模板必须提供以下页面，缺一不可：

- `home`：首页。
- `article`：文章详情页。
- `category`：栏目页。
- `archive`：归档页。
- `search`：搜索页。
- `404`：错误页。

每个页面都应该是完整 HTML 文档，至少包含：

```ejs
<!DOCTYPE html>
<html lang="<%= siteLanguage %>">
<head>
  <%- include('partials/head') %>
</head>
<body>
  <%- include('partials/header') %>
  <main>
    <!-- 页面主体 -->
  </main>
  <%- include('partials/footer') %>
  <script src="/js/analytics.js"></script>
</body>
</html>
```

## 4. 必需 partial

- `head.ejs`：SEO meta、标题、CSS 引入。
- `header.ejs`：站点顶部导航。
- `footer.ejs`：页脚。
- `article-card.ejs`：文章列表卡片。
- `pagination.ejs`：分页组件。

CSS 必须使用独立文件：

```html
<link rel="stylesheet" href="/css/themes/<template-id>.css?v=1">
```

不要引用 `/css/style.css`，那是默认模板的样式。

## 5. 可用全局变量

所有前台页面默认可用：

- `siteTitle`：网站标题。
- `siteDescription`：网站描述。
- `siteLanguage`：语言，例如 `zh-CN`。
- `siteUrl`：网站地址。
- `currentPath`：当前路径。
- `categories`：栏目列表。
- `friendLinks`：友情链接列表。
- `title`：当前页面标题。
- `metaDescription`：当前页面 SEO 描述。
- `metaKeywords`：当前页面 SEO 关键词。

## 6. 页面数据说明

### home

可用变量：

- `featured`：精选文章数组。
- `latest`：最新文章数组。
- `categories`：栏目数组。

### article

可用变量：

- `article`：当前文章。
- `prevArticle`：上一篇，可能为空。
- `nextArticle`：下一篇，可能为空。
- `relatedArticles`：相关文章数组。
- `topicPath`：同主题阅读路径数组。
- `wordCount`：字数。
- `readTime`：阅读时间。

### category

可用变量：

- `category`：当前栏目。
- `articles`：当前页文章数组。
- `pagination`：分页对象。

### archive

可用变量：

- `archive`：按月份分组后的文章。
- `totalArticles`：文章总数。
- `totalMonths`：月份总数。
- `startArticle`：当前页起始文章序号。
- `endArticle`：当前页结束文章序号。
- `pagination`：分页对象。

### search

可用变量：

- `q`：搜索关键词。
- `articles`：搜索结果文章数组。
- `total`：搜索结果总数。
- `pagination`：分页对象。

### 404

可用变量：

- `latest`：推荐阅读文章数组，可能为空。

## 7. 文章对象字段

文章列表和详情常用字段：

```text
article.title
article.slug
article.summary
article.content_html
article.category_name
article.category_slug
article.published_at
article.view_count
article.seo_keywords
article.cover_image
article.cover_thumbnail
article.card_image
article.image_alt
article.image_review_status
```

图片使用规则：

```ejs
<%
  var cardImage = article.image_review_status === 'pass'
    ? (article.card_image || article.cover_thumbnail || article.cover_image)
    : '';
%>
```

列表页优先使用 `card_image` 或 `cover_thumbnail`，不要直接在卡片里加载大图。文章详情页可以使用 `cover_image`。

## 8. 分页对象字段

`pagination` 常用字段：

```text
pagination.totalPages
pagination.currentPage
pagination.totalItems
pagination.startItem
pagination.endItem
pagination.prevHref
pagination.nextHref
pagination.items
```

`pagination.items` 中的元素可能是页码，也可能是省略号：

```ejs
<% pagination.items.forEach(function(item) { %>
  <% if (item.type === 'ellipsis') { %>
    <span>...</span>
  <% } else if (item.isCurrent) { %>
    <span aria-current="page"><%= item.page %></span>
  <% } else { %>
    <a href="<%= item.href %>"><%= item.page %></a>
  <% } %>
<% }); %>
```

## 9. 注册模板

新增模板后，在 `routes/frontend-theme.js` 的 `FRONTEND_THEMES` 中注册：

```js
{
  id: 'your-template-id',
  name: '模板名称',
  description: '模板说明',
  badge: '新模板',
}
```

注册后，后台“模板设置”会自动显示该模板。

## 10. 后台切换

后台路径：

```text
/admin/templates
```

管理员选择模板并保存后，系统写入设置项：

```text
frontend_theme=<template-id>
```

如果模板 ID 不存在，系统拒绝保存。如果模板渲染失败，前台自动回退默认模板。

## 11. CSS 规范

- 每套模板必须使用自己的 CSS 文件。
- 推荐所有类名前缀统一，例如 `ap-`、`cms-`、`food-`。
- 不要修改 `/public/css/style.css` 来实现新模板。
- 不要依赖默认模板的 class。
- 避免文字溢出、图片撑破容器、移动端横向滚动。
- 列表页图片必须使用缩略图。
- 卡片圆角建议不超过 `8px`。
- 字体大小不要使用 `vw` 随视口缩放。
- 移动端必须单列或清晰折叠。

## 12. 开发检查清单

开发完成后至少检查：

- 首页可以渲染。
- 文章详情页可以渲染。
- 栏目页可以渲染。
- 归档页可以渲染并分页。
- 搜索页可以渲染并分页。
- 404 页可以渲染。
- 有图文章显示图片。
- 无图文章显示稳定占位，不出现破图。
- 移动端没有文字重叠。
- 页面没有引用 `/css/style.css`。
- 页面包含 `/js/analytics.js`。
- 后台模板设置页能看到新模板。
- 切换新模板后，刷新前台生效。
- 切回默认模板后，前台恢复默认模板。

## 13. 测试清单

本地执行：

```bash
npm test
node --check routes/frontend-theme.js routes/public.js routes/admin.js server.js
```

如果只验证模板相关测试：

```bash
node --test tests/frontend-template-switch.test.js tests/admin-templates-view.test.js tests/aurora-press-theme.test.js
```

视觉验证建议访问：

```text
/
/archive
/search?q=AI
/category/<任意栏目slug>
/article/<任意文章slug>
/not-found-demo
/admin/templates
```

## 14. 禁止事项

- 不要删除默认模板。
- 不要让模板写入数据库。
- 不要在模板里调用 AI。
- 不要把密钥、后台密码、API Key 写进模板。
- 不要让模板依赖外部不可控脚本。
- 不要修改文章生成、栏目生成、AI Provider、Agent 调度逻辑。
- 不要在列表页加载原始大图。
- 不要为了模板效果改变文章字段结构。

