# 🤖 AI 智能网站 - 完全由 AI 驱动的自动运营网站系统

一个**零人工干预**的 AI 驱动网站系统。通过 11 个 AI Agent 协同工作，自动规划栏目、联网搜索最新资讯、撰写高质量文章、优化 SEO、分析流量数据、持续自我改进。

**🌐 在线演示：** https://aiweb.bt199.com

## ✨ 核心特性

### 🧠 多 Agent 协同系统（11 个角色）

| 角色 | 职责 |
|---|---|
| 🏢 站长 | 统筹全局，启动冷启动，故障恢复协调 |
| 🧠 规划师 | 分析热点，规划栏目和内容计划 |
| 📡 新闻采集 | 多引擎搜索获取最新资讯 |
| ✍️ 写手 | 基于最新资讯撰写文章 |
| 🔍 审核 | 审查文章质量后发布 |
| ✏️ 编辑 | 润色和优化现有文章 |
| 📊 SEO 专家 | 深度 SEO 审计，指导维护策略 |
| 👤 测评员 | 站在用户角度审查体验，分派改进建议 |
| 📈 分析师 | 分析流量数据，发现趋势 |
| 🔧 技术员 | 维护模板和系统 |
| 🖼️ 站标生成 | AI 自动生成与网站主题相关的 SVG 站标 |

### ⚡ 两种工作模式

| 模式 | 说明 |
|------|------|
| 🧠 **智能模式** | 按定时任务调度，每天固定时间工作，省资源 |
| 🔥 **狂暴模式** | AI 无休止持续工作，1-10 档并发控制，档位越高产出越大 |

### 🔍 多引擎智能搜索

- **搜索引擎为主**：DuckDuckGo + Bing 并发搜索，零配置，支持任意主题
- **Tavily 为加强**：有 API Key 就用，搜索更精准（可选）
- **AI 管理的 RSS**：AI 自动发现并保存与网站主题相关的 RSS 源
- 搜索词自动带上网站主题上下文，换个美食网站也能正常工作

### 🛡️ 故障自动恢复

- AI 提供商故障时自动启动后台轮询（每 3 分钟检测）
- 恢复后自动触发补偿任务，补上错过的文章
- 管理后台实时显示故障状态和持续时间
- 容器重启后自动恢复上次的工作模式

### 🎨 前端 v3 — 现代化设计

- **暗色/亮色主题**：一键切换，localStorage 持久化，零闪烁
- **60+ CSS 变量设计系统**：色彩、阴影、圆角、间距、排版、动画全部系统化
- **文章页增强**：阅读进度条、自动目录 TOC、代码块复制、字数统计、上下篇导航、相关推荐、社交分享
- **站内搜索**：header 搜索框，全文搜索标题/摘要/关键词
- **文章归档**：按月份分组的时间线布局
- **滚动动画**：IntersectionObserver 驱动的入场动画
- **移动端**：侧滑抽屉导航 + 遮罩层
- **404 增强**：推荐最新文章，减少用户流失

### 🔐 安全加固

- bcrypt 密码哈希（自动兼容升级旧 SHA-256）
- 随机 Session ID + CSRF token（全部 24 个管理表单）
- 登录限流（5 次失败锁定 15 分钟）
- Helmet 安全头 + API 速率限制
- SSRF 防护（禁止访问内网地址）
- 安全 Cookie（HttpOnly + SameSite + Secure）

### 📊 后台管理

- 暗色主题管理面板
- 多 AI 提供商（负载均衡 + 故障转移 + 自动重试）
- 文章/栏目 CRUD + 分页
- Agent 日志 + 分页
- 工作模式切换（智能/狂暴）
- Tavily 搜索引擎配置
- 定时任务管理

---

## 🚀 一键部署（Docker）

### 前置要求

- 一台 Linux 服务器（已安装 Docker + Docker Compose）
- 域名已解析到服务器 IP
- Caddy 或 Nginx 做反向代理（可选，脚本自动配置 Caddy）

### 方式一：一键脚本部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/laolaoshiren/ai-website.git
cd ai-website

# 2. 一条命令部署
GITHUB_TOKEN=ghp_你的token ./deploy.sh 服务器SSH别名 你的域名
```

脚本自动完成：推送代码 → GitHub Actions 构建镜像 → 读取本地 AI 配置 → 上传到服务器 → 配置 Caddy 反向代理 → 启动容器 → 健康检查

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
│   ├── planner.js         # 规划 Agent
│   ├── writer.js          # 写作 Agent（联网搜索）
│   ├── search.js          # 多引擎搜索（DuckDuckGo + Bing + Tavily + RSS）
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
│   └── api.js             # API 路由（分析数据 + 健康检查）
├── views/                 # EJS 模板
│   ├── pages/             # 页面模板（home/article/category/search/archive/404）
│   ├── partials/          # 组件（header/footer/article-card/seo-head）
│   └── admin/             # 后台模板
└── public/
    ├── css/               # 样式（style.css 设计系统 + admin.css 暗色后台）
    └── js/                # JS（theme.js 主题切换 + analytics.js 分析）
```

## 🔧 支持的 AI 提供商

所有兼容 OpenAI API 格式的提供商：

- **DeepSeek** - https://api.deepseek.com/v1
- **通义千问** - https://dashscope.aliyuncs.com/compatible-mode/v1
- **Moonshot** - https://api.moonshot.cn/v1
- **OpenRouter** - https://openrouter.ai/api/v1
- **OpenAI** - https://api.openai.com/v1
- 任何 OpenAI 兼容的 API

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

## 🐳 Docker 镜像

Docker 镜像通过 GitHub Actions 自动构建，推送到 GitHub Container Registry：

```bash
docker pull ghcr.io/laolaoshiren/ai-website:latest
```

构建状态：https://github.com/laolaoshiren/ai-website/actions

## 📄 License

MIT
