# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI 智能网站 (AI Smart Website) v2.0 — 一个完全由 AI 驱动的自主网站系统，通过 11 个 AI Agent 协同工作实现零人工干预的内容生成、SEO 优化和流量分析。中文内容为主，面向中文用户。

## Commands

```bash
npm start          # 启动生产服务器 (node server.js)
npm run dev        # 开发模式，文件变更自动重启 (node --watch server.js)
```

- 首次启动后访问 `http://localhost:3000/admin/setup` 设置管理员密码
- 默认端口 3000，被占用时自动递增
- **无测试套件、无 linter 配置**

## Architecture

### Tech Stack
- **Runtime:** Node.js ≥ 18, Express 4.x, EJS 模板引擎
- **Database:** 自定义 JSON 文件数据库 (`data/db.json`)，内存中操作，定时持久化
- **AI:** OpenAI 兼容 API，支持多提供商负载均衡（DeepSeek、Qwen、Moonshot、OpenRouter、OpenAI 等）
- **Content:** Markdown (marked) → DOMPurify + jsdom 净化 → HTML

### Request Flow
```
server.js (入口)
  ├── /admin/*  → routes/admin.js   (管理后台，含 setup 流程)
  ├── /api/*    → routes/api.js     (JSON API)
  └── /*        → routes/public.js  (首页、分类页、文章页、sitemap、RSS)
```

模板渲染：`views/layouts/` (布局) → `views/pages/` (页面) → `views/partials/` (组件)；管理后台模板在 `views/admin/`。

### Multi-Agent System (`ai/` directory)

11 个专业化 Agent 组成闭环：

| Agent | 文件 | 职责 |
|-------|------|------|
| Site Manager | `scheduler/index.js` | 总协调、冷启动 |
| Planner | `ai/planner.js` | 内容策略规划 |
| News Collector | `ai/search.js` | RSS 新闻聚合 (36Kr, HackerNews, TechCrunch, TheVerge) |
| Writer | `ai/writer.js` | 文章生成（含联网搜索） |
| Reviewer | (内置于 scheduler) | 质量审核与发布 |
| Editor | (内置于 scheduler) | 内容润色 |
| SEO Expert | `ai/seo-expert.js` | 深度 SEO 审计 |
| User Tester | `ai/user-tester.js` | 用户体验评估 |
| Analyzer | `ai/analyzer.js` | 流量数据分析 |
| SEO Agent | `ai/seo-agent.js` | 技术 SEO 维护 |
| Technician | `ai/template-editor.js` | 模板维护 |

**自治循环：** 新闻采集 → 内容规划 → 文章写作 → 审核发布 → SEO 优化 → 数据分析 → 策略调整 → 重复

### Key Modules

- **`ai/client.js`** — 多提供商 AI 客户端，round-robin 负载均衡，自动故障转移，使用量追踪
- **`ai/tools.js`** — Agent 工具系统（网页搜索、网页抓取），类似 MCP 协议
- **`ai/prompts.js`** — 所有 Agent 的 prompt 模板集中管理
- **`config.js`** — 配置管理，带 5 秒 TTL 缓存，从数据库读取设置
- **`db/database.js`** — JSON 文件数据库实现（CRUD 操作）
- **`db/bootstrap.js`** — 系统初始化、数据迁移、默认密码设置
- **`db/seed-content.js`** — 初始内容种子数据
- **`scheduler/index.js`** — 基于 node-cron 的 9 个定时任务调度器

### Data Model

所有数据存储在 `data/db.json` 中：
- **articles** — 文章（title, content, slug, category_id, status, views 等）
- **categories** — 分类
- **settings** — 站点配置（key-value）
- **ai_providers** — AI 提供商配置（多个，支持启用/禁用）
- **admin** — 管理员账户（SHA-256 密码哈希）
- **analytics** — 访问统计（页面浏览量、停留时间、滚动深度）

### Authentication

Cookie-based session，密码使用 SHA-256 哈希。管理后台所有路由通过 `routes/admin.js` 中间件校验。

## Environment Variables

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 3000 |
| `AI_API_KEY` | AI API 密钥 | — |
| `AI_BASE_URL` | AI API 地址 | — |
| `AI_MODEL` | AI 模型名称 | — |
| `AI_NAME` | AI 提供商名称 | — |

> 注意：环境变量仅用于初始引导，后续配置通过管理后台存储在数据库中。

## SEO 自动化

系统自动生成：`/sitemap.xml`、`/rss.xml`、`/robots.txt`，文章页自动生成 JSON-LD 结构化数据和 Open Graph 标签。

## Concurrency Notes

- `config.js` 使用内存缓存（5 秒 TTL），修改数据库后需调用 `refreshConfig()`
- `database.js` 是单进程 JSON 文件数据库，无并发写入保护
- 定时任务在 AI 循环启用时自动启动 (`ai_loop_enabled === '1'`)
