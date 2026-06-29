# 🤖 AI 智能网站 - 完全由 AI 驱动的自动运营网站系统

一个**零人工干预**的 AI 驱动网站系统。通过多 Agent 协同工作，自动规划栏目、联网搜索最新资讯、撰写和润色文章、生成文章配图、优化 SEO、分析流量数据、持续自我改进。

**🌐 在线演示：** https://aiweb.bt199.com

## 🚀 一键安装

在一台新 Linux 服务器上执行下面一条命令，即可用 Docker 自动部署项目：

```bash
curl -fsSL https://raw.githubusercontent.com/laolaoshiren/ai-website/master/install.sh | sudo bash
```

运行后只会询问是否需要自动设置反代域名。输入域名会自动启用 Caddy HTTPS 反向代理；直接回车则跳过反代，只通过服务器 `3001` 端口访问。安装脚本只负责把系统跑起来，其余网站设置、AI 提供商、Tavily、生图等配置都进入后台完成。

Docker 一键安装会同时安装“后台网页更新执行器”。之后进入后台 `系统更新`，即可检测当前服务器是否为 GitHub 最新版；发现新版本时可直接点击更新，无需再登录服务器执行命令。

## ✨ 核心特性

### 🧠 多 Agent 协同系统（13 个角色）

| 角色 | 职责 |
|---|---|
| 🏢 站长 | 统筹全局，启动冷启动，故障恢复协调 |
| 🧠 规划师 | 分析热点，规划栏目和内容计划 |
| 📡 新闻采集 | 多引擎搜索获取最新资讯 |
| ✍️ 写手 | 基于最新资讯撰写文章 |
| 🔍 审核 | 审查文章质量后发布 |
| ✏️ 编辑 | 润色和优化现有文章 |
| 🖼️ 配图设计师 | 根据文章内容设计配图提示词并调用生图模型 |
| 👁️ 配图审核员 | 审核图片可用性、相关性和基础质量 |
| 📊 SEO 专家 | 深度 SEO 审计，指导维护策略 |
| 👤 测评员 | 站在用户角度审查体验，分派改进建议 |
| 📈 分析师 | 分析流量数据，发现趋势 |
| 🔧 技术员 | 维护模板和系统 |
| ✨ 润色师 | 降低 AI 味、模板味和报告味，提升文章可读性 |

### ⚡ 两种工作模式

| 模式 | 说明 |
|------|------|
| 🧠 **智能模式** | 按定时任务调度，每天固定时间工作，省资源 |
| 🔥 **狂暴模式** | AI 无休止持续工作，1-10 档并发控制，档位越高产出越大 |

### 🔍 多引擎智能搜索

- **搜索引擎为主**：DuckDuckGo + Bing 并发搜索，零配置，支持任意主题
- **Tavily 为加强**：有 API Key 就用，支持多 Key 管理、验证和轮询使用
- **AI 管理的 RSS**：AI 自动发现并保存与网站主题相关的 RSS 源
- **兜底策略**：Tavily 不可用时，仍会继续使用免费搜索引擎和 RSS，不阻塞采集 Agent
- 搜索词自动带上网站主题上下文，换个美食网站也能正常工作

### 📝 文章质量与配图

- **文章质量闸门**：发布前检测空内容、短内容、报告味、模板味和明显 AI 套话
- **自动重写**：质量未达标的草稿不会发布，会带着失败原因进入重写流程
- **MoA 写作模式**：可选开启，多模型候选聚合；失败时自动回退单模型写作
- **站标生成**：AI 可自动生成与网站主题相关的 SVG 站标
- **独立生图提供商**：文字 AI 与生图 AI 分开配置，互不污染用量和故障统计
- **自动文章配图**：系统判断文章是否需要配图，生成后必须通过审核才写入文章
- **缩略图优先**：首页和列表页使用缩略图，文章页才使用原图，降低加载压力
- **图片容错**：图片缺失、审核失败、提供商异常时自动降级为无图文章，不产生 404 配图

### 🛡️ 故障自动恢复

- AI 提供商故障时自动启动后台轮询（每 3 分钟检测）
- 恢复后自动触发补偿任务，补上错过的文章
- 管理后台实时显示故障状态和持续时间
- 容器重启后自动恢复上次的工作模式

### 🎨 前台模板系统

- **内置模板库**：默认模板、极光刊物、墨韵长卷、星港简报、流光科技媒体 GLM5.2
- **后台切换**：管理员可在「模板设置」搜索、预览并切换前台模板
- **无损预览**：通过 `?preview_theme=<template-id>` 预览模板，不写入配置
- **失败兜底**：非默认模板渲染失败时，前台自动回退默认模板
- **明暗模式**：非默认模板必须支持亮色/暗色切换
- **模板开发手册**：见 `docs/template-development-manual.md`，新模板无需阅读全量源码即可开发

### 🔐 安全加固

- bcrypt 密码哈希（自动兼容升级旧 SHA-256）
- 随机 Session ID + CSRF token（覆盖后台管理表单）
- 登录限流（5 次失败锁定 15 分钟）
- Helmet 安全头 + API 速率限制
- SSRF 防护（禁止访问内网地址）
- 安全 Cookie（HttpOnly + SameSite + Secure）

### 📊 后台管理

- 暗色主题管理面板
- 文字 AI 提供商（多 provider + 多模型 + 负载均衡 + 故障转移 + 自动重试）
- 生图 AI 提供商（独立配置，多 Key，独立测试和故障统计）
- 文章/栏目 CRUD + 分页
- Agent 状态 + 日志 + 分页，并显示 AI 提供商和模型
- 工作模式切换（智能/狂暴）
- Tavily 搜索引擎多 Key 管理、保存、验证和轮询
- 前台模板设置、模板预览和模板切换
- 文章自动配图开关和图片清理参数
- 备份/还原（AI 提供商、广告、友情链接、Tavily KEY、网站设置）
- 系统更新：检测 GitHub 最新版，Docker 一键安装环境可从后台直接触发热更新
- 定时任务管理

### 💾 备份与还原

后台「备份还原」用于迁移或保存关键运营配置，当前支持：

| 选项 | 文件名 | 内容 |
|---|---|---|
| AI 提供商 | `ai-providers.json` | 文字 AI 提供商 + 生图 AI 提供商 |
| 广告 | `ads.json` | 后台广告配置 |
| 友情链接 | `friend-links.json` | 友情链接配置 |
| Tavily KEY | `tavily-keys.json` | Tavily 多 Key 配置 |
| 网站设置 | `site-settings.json` | 站点标题、描述、主题、模板、开关等设置 |

导出时可勾选需要的选项，系统会生成 ZIP 压缩包，每个选项是独立 JSON 文件。

导入时默认不显示任何还原项。管理员先选择 ZIP 或单个 JSON 文件，系统会自动识别文件中可还原的项目，再显示对应选项供勾选。还原只覆盖勾选项；网站设置备份不会包含后台会话和 Tavily KEY，Tavily KEY 单独备份。

---

## 🚀 一键部署（Docker）

### 前置要求

- 一台 Linux 服务器（已安装 Docker + Docker Compose）
- 域名已解析到服务器 IP
- Caddy 或 Nginx 做反向代理（可选，脚本自动配置 Caddy）

新服务器优先使用本文开头的 `install.sh` 一键安装命令；下面的 `deploy.sh` 更适合已经克隆本仓库、需要从本地推送并发布到指定 SSH 服务器的场景。

### 方式一：从本地仓库发布到服务器（deploy.sh）

```bash
# 1. 克隆仓库
git clone https://github.com/laolaoshiren/ai-website.git
cd ai-website

# 2. 一条命令部署
GITHUB_TOKEN=ghp_你的token ./deploy.sh 服务器SSH别名 你的域名
```

脚本自动完成：推送代码 → GitHub Actions 构建镜像 → 读取本地 AI 配置 → 上传到服务器 → 配置 Caddy 反向代理 → 启动容器 → 健康检查

### 线上更新

当前线上站点使用 `master` 分支构建 Docker 镜像，并通过 GHCR 镜像部署到服务器：

```bash
# 本地合并并推送 master 后，GitHub Actions 会构建 ghcr.io/laolaoshiren/ai-website:latest
git switch master
git pull origin master
git merge <feature-branch>
git push origin master

# 服务器更新
ssh tx "cd /opt/ai-website && docker compose pull && docker compose up -d --force-recreate"
```

生产访问地址：

- 前台：https://aiweb.bt199.com
- 后台：https://aiweb.bt199.com/admin
- 健康检查：https://aiweb.bt199.com/api/health

### 方式二：手动 Docker 部署

```bash
# 1. 创建目录
ssh your-server "mkdir -p /opt/ai-website/data /opt/ai-website/logs"

# 2. 创建 .env 文件
cat > .env << 'EOF'
AI_API_KEY=你的AI密钥
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_NAME=DeepSeek
SITE_URL=https://your-domain.com
SITE_TITLE=你的网站名
SITE_DESCRIPTION=你的网站描述
EOF

# 3. 上传并启动
scp .env docker-compose.yml your-server:/opt/ai-website/
ssh your-server "cd /opt/ai-website && docker compose pull && docker compose up -d"
```

### 方式三：本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_API_KEY` | AI API 密钥（必填） | — |
| `AI_BASE_URL` | AI API 地址 | `https://api.openai.com/v1` |
| `AI_MODEL` | 模型名称 | `gpt-4o` |
| `AI_NAME` | 提供商名称 | `AI Provider` |
| `SITE_URL` | 网站 URL | `http://localhost:3000` |
| `SITE_TITLE` | 网站标题 | `AI 智能网站` |
| `SITE_DESCRIPTION` | 网站描述 | `由 AI 全自动维护的高质量内容网站` |

> 💡 环境变量仅在首次启动时生效，后续通过管理后台修改。

### 首次使用

1. 访问 `https://your-domain.com/admin` 登录管理后台（默认密码: `admin`）
2. 访问 `/admin/providers` 确认 AI 提供商已配置
3. 点击「🚀 冷启动」开始自动生成内容
4. AI 系统将自动运行：采集 → 规划 → 写作 → 发布 → 优化

---

## 📁 项目结构

```
├── server.js              # 服务入口（含优雅关闭、favicon fallback）
├── config.js              # 配置管理（5秒 TTL 缓存）
├── Dockerfile             # 多阶段构建
├── docker-compose.yml     # 生产部署
├── docker-entrypoint.sh   # 容器启动脚本（自动配置 AI 提供商）
├── deploy.sh              # 一键部署脚本（参数化域名）
├── ai/                    # AI Agent 系统
│   ├── client.js          # 多提供商客户端（负载均衡 + 故障自动恢复）
│   ├── moa.js             # MoA 多候选聚合写作模式
│   ├── planner.js         # 规划 Agent
│   ├── writer.js          # 写作 Agent（联网搜索）
│   ├── search.js          # 多引擎搜索（DuckDuckGo + Bing + Tavily + RSS）
│   ├── article-image.js   # 文章配图生成、审核、缩略图和清理
│   ├── style-guardian.js  # 文章质量闸门，降低 AI 味和模板味
│   ├── humanized-writing.js # 文章人味化改写辅助
│   ├── autonomy-director.js # 自治质量闭环和后台简报
│   ├── category-policy.js # 栏目稳定策略，防止 AI 大改栏目
│   ├── favicon.js         # AI 站标生成器
│   ├── seo-expert.js      # SEO 专家 Agent
│   ├── user-tester.js     # 用户体验测评 Agent
│   ├── analyzer.js        # 数据分析 Agent
│   ├── seo-agent.js       # SEO 技术 Agent
│   ├── template-editor.js # 模板编辑 Agent
│   ├── tools.js           # Agent 工具系统（搜索、抓取、RSS 管理）
│   ├── prompts.js         # 所有 Agent 提示词
│   └── utils.js           # 工具函数（slugify、DOMPurify）
├── scheduler/
│   └── index.js           # 定时任务 + 狂暴模式 + 冷启动
├── db/
│   ├── database.js        # JSON 文件数据库（并发锁 + 异步写入 + 缓存）
│   └── bootstrap.js       # 初始化脚本
├── routes/
│   ├── admin.js           # 后台路由（认证 + CSRF + 限流）
│   ├── public.js          # 前台路由（首页/分类/文章/搜索/归档）
│   ├── frontend-theme.js  # 前台模板注册、预览、渲染和兜底
│   ├── pagination.js      # 前后台分页工具
│   ├── agent-status.js    # Agent 中文状态归一化
│   └── api.js             # API 路由（分析数据 + 健康检查）
├── utils/
│   ├── admin-backup.js    # 后台备份/还原逻辑
│   ├── multipart-form.js  # 后台导入文件解析
│   └── zip-store.js       # ZIP 生成与解析（无额外依赖）
├── views/                 # EJS 模板
│   ├── pages/             # 页面模板（home/article/category/search/archive/404）
│   ├── themes/            # 非默认前台模板
│   ├── partials/          # 组件（header/footer/article-card/seo-head）
│   └── admin/             # 后台模板
└── public/
    ├── favicon.svg        # 站点图标
    ├── css/               # 样式（默认模板、非默认模板、admin.css 暗色后台）
    ├── images/            # 文章配图和缩略图（生产环境持久化）
    └── js/                # JS（theme.js 主题切换 + analytics.js 分析）
```

## 🔧 支持的 AI 提供商

文字 AI 提供商支持所有兼容 OpenAI API 格式的服务，可配置多个 provider、多个模型，并按健康度自动选择：

- **DeepSeek** - https://api.deepseek.com/v1
- **通义千问** - https://dashscope.aliyuncs.com/compatible-mode/v1
- **Moonshot** - https://api.moonshot.cn/v1
- **OpenRouter** - https://openrouter.ai/api/v1
- **OpenAI** - https://api.openai.com/v1
- 任何 OpenAI 兼容的 API

生图 AI 提供商在后台单独配置，不与文字 AI 提供商共用。系统会在文章通过质量审核后判断是否需要配图，并调用可用生图 provider；生成图片还需要经过配图审核员审核，通过后才写入文章。

## ⏰ 默认调度计划（智能模式）

| 任务 | 频率 | 说明 |
|---|---|---|
| 📡 资讯采集 | 每天 7/12/18 点 | 多引擎搜索最新资讯 |
| 🧠 结构规划 | 每月 1/15 日 | 规划栏目和内容计划 |
| ✍️ 内容生成 | 每天 8/11/14/17/20/23 点 | 基于最新资讯撰写文章 |
| 💓 心跳检查 | 每 30 分钟 | 检查内容是否充足，不足自动规划+生成 |
| 🔍 SEO 更新 | 每天 2:00 | 更新 sitemap 和 SEO 文件 |
| 📊 SEO 审计 | 每周一 3:00 | 深度 SEO 评估 |
| 📈 数据分析 | 每天 22:30 | 分析流量和优化策略 |
| 👤 用户测评 | 每周三 4:00 | 从用户角度审查体验 |
| 🔧 模板审查 | 每周日 4:00 | 模板维护 |
| 👁️ 视觉模型扫描 | 每 6 小时 | 静默检测文字 AI 模型是否具备多模态识图能力 |

## 🐳 Docker 镜像

Docker 镜像通过 GitHub Actions 自动构建，推送到 GitHub Container Registry：

```bash
docker pull ghcr.io/laolaoshiren/ai-website:latest
```

构建状态：https://github.com/laolaoshiren/ai-website/actions

## 📄 License

MIT
