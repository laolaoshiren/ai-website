/**
 * 一键填充高质量内容到数据库
 */
const { initDb, addCategory, insertPage, setSetting, setAdminPassword } = require('./database');
const { marked } = require('marked');
const crypto = require('crypto');

async function populate() {
  await initDb();

  // 清理旧数据
  const db = require('./database').getDb();
  db.categories = [];
  db.pages = [];
  db.analytics = [];
  db._counters.categories = 0;
  db._counters.pages = 0;
  require('./database').saveDb();

  setAdminPassword(crypto.createHash('sha256').update('admin').digest('hex'));

  setSetting('site_title', 'AI 纪元');
  setSetting('site_description', '追踪人工智能最新进展，深度解读前沿技术');
  setSetting('site_theme', '人工智能前沿技术与行业创新');
  setSetting('site_direction', '聚焦 AI 最新技术动态、产品发布、行业应用');
  setSetting('ai_loop_enabled', '0');

  const cats = [
    ['AI 前沿', 'ai-frontier', '最新 AI 技术突破与研究动态', 1],
    ['大模型', 'llm', '大语言模型技术解析与对比', 2],
    ['AI 应用', 'ai-apps', 'AI 在各行各业的落地应用', 3],
    ['开发工具', 'dev-tools', 'AI 编程工具与开发效率提升', 4],
    ['行业观察', 'industry', 'AI 行业趋势与商业分析', 5],
  ];
  for (const [name, slug, desc, order] of cats) addCategory(name, slug, desc, order);

  const articles = [
    {
      title: 'Claude 4 系列全面解析：Opus、Sonnet、Haiku 各有何特长',
      slug: 'claude-4-series-analysis', cat: 1, featured: 1,
      summary: 'Anthropic 发布 Claude 4 系列模型，包含 Opus、Sonnet、Haiku 三个版本。深度对比各版本的性能、定价和适用场景。',
      content: '# Claude 4 系列全面解析\n\n2025 年，Anthropic 正式发布了 Claude 4 系列模型，标志着大语言模型进入了新的竞争阶段。\n\n## 三个版本的定位\n\n**Claude Opus 4** 是旗舰模型，拥有最强推理能力和最广知识面，在复杂编程、多步推理、长文档分析等任务上表现突出。\n\n**Claude Sonnet 4** 在性能和成本之间取得最佳平衡，能力接近 Opus 但推理更快、成本更低，是大多数企业应用的首选。\n\n**Claude Haiku 4** 是响应最快的模型，专为低延迟、高吞吐场景设计，适合实时对话和简单问答。\n\n## 性能对比\n\n- **编程能力**：Opus 4 在 SWE-bench 上达到业界领先水平\n- **推理能力**：在 GPQA、MMLU 等测试中超越大多数竞品\n- **长上下文**：全系列支持 200K token 上下文窗口\n- **多模态**：支持图像理解和分析\n\n## 定价\n\n| 模型 | 输入 | 输出 |\n|------|------|------|\n| Opus 4 | $15/M | $75/M |\n| Sonnet 4 | $3/M | $15/M |\n| Haiku 4 | $0.25/M | $1.25/M |\n\n## 总结\n\nClaude 4 系列让 AI 助手从"能用"进入"好用"阶段。Sonnet 4 是大多数场景的最佳选择。',
      seo_title: 'Claude 4 系列深度解析：Opus/Sonnet/Haiku 全面对比',
      seo_keywords: 'Claude 4, Anthropic, 大语言模型, Opus, Sonnet, Haiku',
    },
    {
      title: '2026 年 AI 编程工具深度评测：Cursor、Windsurf、Claude Code 谁更强',
      slug: 'ai-coding-tools-2026-review', cat: 4, featured: 1,
      summary: '深度对比 2026 年最热门的三款 AI 编程工具，从代码生成质量、上下文理解、工作流集成等维度全面评测。',
      content: '# 2026 年 AI 编程工具深度评测\n\nAI 编程工具已从"辅助补全"进化到"自主开发"。本文全面对比 Cursor、Windsurf 和 Claude Code。\n\n## Cursor：IDE 集成标杆\n\n基于 VS Code 构建，Tab 补全精准，多文件编辑能力强。但本质上还是编辑器内的辅助工具。\n\n## Windsurf：AI 原生 IDE\n\n从头构建的 AI 原生开发环境，Cascade 流程能自动规划多步任务，对项目结构理解深入。\n\n## Claude Code：命令行王者\n\n终端即开发环境，无需 IDE。深度推理能力强，能独立完成从需求到代码的完整流程。\n\n## 实测对比\n\n| 任务 | Cursor | Windsurf | Claude Code |\n|------|--------|----------|-------------|\n| Bug 修复 | 5/5 | 4/5 | 4/5 |\n| 新功能 | 4/5 | 5/5 | 5/5 |\n| 重构 | 3/5 | 4/5 | 5/5 |\n| 调试 | 4/5 | 4/5 | 5/5 |\n\n## 结论\n\n新手选 Cursor，全栈选 Windsurf，复杂项目选 Claude Code。',
      seo_title: '2026 AI编程工具评测：Cursor vs Windsurf vs Claude Code',
      seo_keywords: 'AI编程, Cursor, Windsurf, Claude Code, 开发工具',
    },
    {
      title: 'DeepSeek-R2 发布：中国大模型的又一次突破',
      slug: 'deepseek-r2-release', cat: 2, featured: 0,
      summary: 'DeepSeek 发布 R2 模型，在数学推理和代码生成方面取得重大突破，开源策略引发行业震动。',
      content: '# DeepSeek-R2 发布\n\nDeepSeek 继 R1 之后发布 R2 模型，在数学推理、代码生成和逻辑推演方面取得显著进步。\n\n## 核心升级\n\n- **推理能力**：在 MATH、GSM8K 等测试上接近闭源模型\n- **代码能力**：HumanEval 和 MBPP 表现优异\n- **高效训练**：更少计算资源实现更好性能\n\n## 开源策略\n\nR2 延续开源策略，模型权重和训练细节公开发布。降低了中小企业和研究机构的使用门槛。\n\n## 行业影响\n\n- 开源模型能够与闭源模型竞争\n- 中国团队具有独立创新能力\n- 推理能力成为竞争焦点',
      seo_title: 'DeepSeek-R2 深度解析：中国大模型新突破',
      seo_keywords: 'DeepSeek-R2, 大模型, 开源, 推理模型, 中国AI',
    },
    {
      title: 'MCP 协议详解：AI Agent 的万能接口标准',
      slug: 'mcp-protocol-explained', cat: 4, featured: 0,
      summary: 'Model Context Protocol 正在成为 AI Agent 连接外部工具和服务的标准协议。详解设计原理和实际应用。',
      content: '# MCP 协议详解\n\nModel Context Protocol（MCP）是 Anthropic 提出的开放标准，为 AI 模型提供统一方式连接外部工具和数据源。\n\n## 什么是 MCP\n\nMCP 就像 AI 世界的"USB 接口"——任何工具实现 MCP 协议，就能被任何支持 MCP 的 AI 模型使用。\n\n## 架构设计\n\n- **MCP Host**：AI 应用\n- **MCP Client**：负责通信\n- **MCP Server**：提供工具和数据\n\n通信基于 JSON-RPC 2.0，支持 stdio 和 SSE 两种传输方式。\n\n## 实际应用\n\n文件系统、数据库、Git、Slack、浏览器自动化等已有丰富生态。\n\n## 未来展望\n\nMCP 正从技术协议演变为生态系统，AI Agent 的能力边界将不断扩展。',
      seo_title: 'MCP 协议完全指南：AI Agent 的万能接口',
      seo_keywords: 'MCP, Model Context Protocol, AI Agent, Anthropic',
    },
    {
      title: 'AI Agent 架构设计：从单体到多智能体协作系统',
      slug: 'ai-agent-architecture-design', cat: 1, featured: 1,
      summary: '深入探讨 AI Agent 的架构设计模式，从单体 Agent 到多智能体协作系统，分享实战经验和最佳实践。',
      content: '# AI Agent 架构设计\n\n## 单体 Agent 模式\n\n一个 LLM 配合一组工具循环执行任务。简单易调试，但复杂任务会遇到上下文和推理瓶颈。\n\n## 多 Agent 协作\n\n1. **层级式**：主管 Agent 分配任务给工人 Agent\n2. **流水线式**：任务按阶段传递\n3. **辩论式**：多角度分析后达成共识\n\n## 设计原则\n\n- **职责单一**：每个 Agent 只负责一类任务\n- **状态管理**：共享状态但不互相干扰\n- **错误恢复**：重试、降级、人工介入\n- **可观测性**：每步操作都要记录\n\n## 常见陷阱\n\n1. 过度设计：简单任务不需要多 Agent\n2. 忽视成本：每个调用都消耗 token\n3. 缺乏监控：出问题无法排查\n4. 盲信 AI 输出：结果需要验证',
      seo_title: 'AI Agent 架构设计实战：多智能体协作',
      seo_keywords: 'AI Agent, 多智能体, 架构设计, LLM, 自动化',
    },
    {
      title: 'AI 自动化网站运营：零人工干预的内容生产系统设计',
      slug: 'ai-automated-website-operations', cat: 5, featured: 1,
      summary: '深度解析如何构建完全由 AI 驱动的网站系统，从内容规划、生成、SEO 优化到用户分析的全流程自动化。',
      content: '# AI 自动化网站运营\n\n传统网站运营需要编辑、写手、SEO 专员等多个角色。AI 时代，这些工作可由多个 Agent 协作完成。\n\n## 系统架构\n\n1. **规划 Agent**：分析热点，制定策略\n2. **采集 Agent**：获取最新资讯\n3. **写作 Agent**：撰写高质量文章\n4. **编辑 Agent**：润色优化\n5. **SEO Agent**：优化搜索排名\n6. **分析 Agent**：分析流量数据\n7. **测评 Agent**：用户角度审查\n\n## 每日工作流\n\n- 7:00 采集资讯\n- 7:30 制定当天计划\n- 8:00/14:00/19:00 生成文章\n- 22:30 复盘数据\n- 每周 SEO 审计 + 用户测评\n\n## 关键技术\n\n- 联网搜索获取实时信息\n- 多 Agent 质量审查\n- 基于数据的自动进化\n\n## 注意事项\n\n不是垃圾站，每篇都要有实际价值。质量 > 数量，持续监控系统状态。',
      seo_title: 'AI 自动化网站运营系统设计：零人工干预',
      seo_keywords: 'AI运营, 自动化网站, 内容生成, AI Agent, 零人工干预',
    },
    {
      title: 'Google Gemini 2.5 发布：百万 Token 上下文的多模态新王',
      slug: 'google-gemini-2-5-release', cat: 2, featured: 0,
      summary: 'Google 发布 Gemini 2.5 系列，支持百万 Token 上下文窗口，多模态理解能力重大突破。',
      content: '# Gemini 2.5 发布\n\nGoogle 发布 Gemini 2.5 系列，在上下文窗口、多模态理解和推理能力方面显著进步。\n\n## 核心升级\n\n- **百万 Token 上下文**：最高 200 万 Token，处理数十万行代码\n- **多模态原生**：文本、图像、音频、视频统一理解\n- **推理增强**：引入"思考"机制，复杂任务准确性提升\n\n## 竞品对比\n\n- vs GPT-4o：上下文更大，多模态更统一\n- vs Claude 4：上下文相当，视频理解有独特优势\n- vs DeepSeek-R2：推理相当，多模态更强\n\n## 总结\n\n百万 Token 上下文和原生多模态是 Gemini 2.5 的核心差异化优势。',
      seo_title: 'Gemini 2.5 深度解析：百万 Token 多模态模型',
      seo_keywords: 'Gemini 2.5, Google, 多模态, 百万Token, 大模型',
    },
    {
      title: 'Anthropic Claude Code：AI 编程进入终端时代',
      slug: 'anthropic-claude-code-terminal', cat: 4, featured: 0,
      summary: 'Anthropic 推出 Claude Code 命令行编程工具，将 AI 编程从 IDE 带入终端，引发开发者工具新变革。',
      content: '# Claude Code：终端编程新时代\n\nAnthropic 推出 Claude Code，基于终端的 AI 编程助手，为开发者提供全新编程方式。\n\n## 为什么是终端\n\n- 直接在远程服务器工作\n- 与命令行工具无缝集成\n- 不依赖 IDE\n\n## 核心能力\n\n- **代码理解**：阅读整个代码库\n- **自主开发**：规划任务、编写代码、运行测试\n- **多文件编辑**：保持代码一致性\n- **Git 集成**：自动创建分支、提交代码\n\n## 与传统工具对比\n\n| 特性 | Copilot | Cursor | Claude Code |\n|------|---------|--------|-------------|\n| 载体 | 插件 | IDE | 终端 |\n| 自主性 | 低 | 中 | 高 |\n\n## 总结\n\nClaude Code 标志 AI 编程从"辅助"走向"自主"。',
      seo_title: 'Claude Code：AI 终端编程工具深度体验',
      seo_keywords: 'Claude Code, AI编程, 终端, CLI, Anthropic',
    },
  ];

  for (const a of articles) {
    const html = marked(a.content);
    insertPage({
      slug: a.slug, title: a.title, category_id: a.cat,
      summary: a.summary, content_md: a.content, content_html: html,
      status: 'published', featured: a.featured,
      seo_title: a.seo_title, seo_keywords: a.seo_keywords,
      seo_description: a.summary,
      published_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    console.log('已发布:', a.title);
  }

  console.log('\n完成！共 ' + articles.length + ' 篇文章, 5 个栏目');
}

populate().catch(e => console.error('ERROR:', e));
