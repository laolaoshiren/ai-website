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

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动（端口冲突会自动切换）
npm start

# 3. 首次使用
# 访问 http://localhost:3000/admin/setup 设置密码
# 访问 http://localhost:3000/admin/providers 添加 AI 提供商
# 点击"冷启动"开始自动生成内容
```

### 环境变量方式配置（可选）
```bash
AI_API_KEY=your-key AI_BASE_URL=https://api.deepseek.com/v1 AI_MODEL=deepseek-chat npm start
```

## 📁 项目结构

```
├── server.js              # 服务入口
├── config.js              # 配置管理
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

## 📄 License

MIT
