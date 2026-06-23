# 🤖 AI 智能网站 - 完全由 AI 驱动的自动运营网站系统

一个**零人工干预**的 AI 驱动网站系统。只需配置 AI 提供商信息，网站即可自主运营：自动规划栏目、联网搜索最新资讯、撰写高质量文章、优化 SEO、分析流量数据、持续自我改进。

## ✨ 核心特性

### 🧠 多 Agent 协同系统（11 个角色）
| 角色 | 职责 |
|---|---|
| 🏢 站长 | 统筹全局，启动冷启动 |
| 🧠 规划师 | 分析热点，规划栏目和内容计划 |
| 📡 新闻采集 | 从 RSS 源获取最新资讯 |
| ✍️ 写手 | 基于最新资讯撰写文章 |
| 🔍 审核 | 审查文章质量后发布 |
| ✏️ 编辑 | 润色和优化现有文章 |
| 📊 SEO 专家 | 深度 SEO 审计，指导维护策略 |
| 👤 测评员 | 站在用户角度审查体验，分派改进建议 |
| 📈 分析师 | 分析流量数据，发现趋势 |
| 💎 润色师 | AI 润色文章 |
| 🔧 技术员 | 维护模板和系统 |

### 🔄 自主运行闭环
```
📡 采集资讯 → 🧠 规划内容 → ✍️ 撰写文章 → 🔍 审核发布 → 📊 SEO优化 → 📈 数据分析 → 🧠 调整策略 → ...
```

### 📡 联网搜索获取实时信息
- 36氪（中文科技资讯）
- Hacker News（国际技术社区）
- TechCrunch（科技新闻）
- The Verge（科技媒体）

### 🔐 后台管理
- 登录密码保护
- 多 AI 提供商（负载均衡 + 故障转移）
- 文章/栏目 CRUD 管理
- AI 润色功能
- Agent 详细日志
- 定时任务管理

---

## 🚀 一键部署（Docker）

### 前置要求
- 一台 Linux 服务器（已安装 Docker + Docker Compose）
- 域名已解析到服务器 IP
- GitHub 账号（用于拉取镜像）

### 方式一：一键脚本部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/laolaoshiren/ai-website.git
cd ai-website

# 2. 一条命令部署（替换 tx 为你的服务器 SSH 别名）
GITHUB_TOKEN=ghp_你的token ./deploy.sh tx
```

脚本自动完成：推送代码 → GitHub Actions 构建镜像 → 上传配置到服务器 → 配置 Caddy 反向代理 → 启动容器 → 健康检查

### 方式二：手动 Docker 部署

```bash
# 1. 在服务器上创建目录
ssh your-server "mkdir -p /opt/ai-website/data /opt/ai-website/logs"

# 2. 创建 .env 配置文件
cat > .env << 'EOF'
AI_API_KEY=你的AI密钥
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_NAME=DeepSeek
SITE_URL=https://your-domain.com
SITE_TITLE=AI 纪元
SITE_DESCRIPTION=追踪人工智能最新进展，深度解读前沿技术
EOF

# 3. 上传配置
scp .env docker-compose.yml your-server:/opt/ai-website/

# 4. 启动
ssh your-server "cd /opt/ai-website && docker compose pull && docker compose up -d"
```

### 方式三：本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

### 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_API_KEY` | AI API 密钥（必填） | — |
| `AI_BASE_URL` | AI API 地址 | `https://api.openai.com/v1` |
| `AI_MODEL` | 模型名称 | `gpt-4o` |
| `AI_NAME` | 提供商名称 | `AI Provider` |
| `SITE_URL` | 网站 URL | `http://localhost:3000` |
| `SITE_TITLE` | 网站标题 | `AI 智能网站` |
| `SITE_DESCRIPTION` | 网站描述 | `由 AI 全自动维护的高质量内容网站` |

> 💡 环境变量仅在首次启动时生效，后续可通过管理后台修改。

### 首次使用

1. 访问 `https://your-domain.com/admin` 登录管理后台（默认密码: `admin`）
2. 访问 `/admin/providers` 确认 AI 提供商已配置
3. 点击「冷启动」开始自动生成内容
4. AI 系统将自动运行：采集 → 规划 → 写作 → 发布 → 优化

---

## 📁 项目结构

```
├── server.js              # 服务入口
├── config.js              # 配置管理
├── Dockerfile             # Docker 构建文件
├── docker-compose.yml     # Docker Compose 部署
├── deploy.sh              # 一键部署脚本
├── ai/                    # AI Agent 系统
│   ├── client.js          # 多提供商负载均衡客户端
│   ├── planner.js         # 规划 Agent
│   ├── writer.js          # 写作 Agent（集成联网搜索）
│   ├── search.js          # RSS 联网搜索模块
│   ├── seo-expert.js      # SEO 专家 Agent
│   ├── user-tester.js     # 用户体验测评 Agent
│   ├── analyzer.js        # 数据分析 Agent
│   ├── seo-agent.js       # SEO 技术 Agent
│   ├── template-editor.js # 模板编辑 Agent
│   └── prompts.js         # 所有 Agent 提示词
├── scheduler/             # 定时任务调度器
├── db/                    # 数据库（纯 JSON 文件）
├── routes/                # 路由（前台 + 后台 + API）
├── views/                 # EJS 模板
└── public/                # 静态资源（CSS/JS）
```

## 🔧 支持的 AI 提供商

所有兼容 OpenAI API 格式的提供商：
- **DeepSeek** - https://api.deepseek.com/v1
- **通义千问** - https://dashscope.aliyuncs.com/compatible-mode/v1
- **Moonshot** - https://api.moonshot.cn/v1
- **OpenRouter (Claude)** - https://openrouter.ai/api/v1
- **OpenAI** - https://api.openai.com/v1

## ⏰ 默认调度计划

| 任务 | 频率 | 说明 |
|---|---|---|
| 📡 资讯采集 | 每天 7:00 | 从 RSS 源获取最新资讯 |
| 🧠 结构规划 | 每月1/15日 | 规划栏目和内容计划 |
| ✍️ 内容生成 | 每天 7:30/13:00/19:00 | 基于最新资讯撰写文章 |
| 🔍 SEO 更新 | 每周日 | 更新 sitemap 和 SEO 文件 |
| 📊 SEO 审计 | 每周一 | 深度 SEO 评估 |
| 📈 数据分析 | 每天 22:30 | 分析流量和优化策略 |
| 👤 用户测评 | 每周三 | 从用户角度审查体验 |

## 🐳 Docker 镜像

Docker 镜像通过 GitHub Actions 自动构建，推送到 GitHub Container Registry：

```bash
# 拉取最新镜像
docker pull ghcr.io/laolaoshiren/ai-website:latest

# 查看构建状态
# https://github.com/laolaoshiren/ai-website/actions
```

## 📄 License

MIT
