# 琢言 · 产品全过程地图（验机讲解用）

> 本文回答老师最可能问的一句话：**"这是不是一个完整的项目？你走完了哪些阶段？"**
> 用法：每讲一个阶段，就指到下面的"仓库证据"，打开对应文件/github.com 页面，**证据比口说有力**。

## 1. 一句话定位

琢言是一个**本地化部署的学术写作智能助手**：Express 分层后端 + better-sqlite3 本地库 + 无框架原生 JS 单页前端，内置多供应商 AI 网关（千问/DeepSeek/OpenAI 统一 OpenAI 兼容协议），提供润色、逻辑分析、AIGC 检测、全文智能 Agent 四大能力，配 JWT 认证、按 token 配额计费、日志审计、Docker 镜像与 GitHub Actions CI。

## 2. 六阶段全过程地图

| 阶段 | 做了什么 | 仓库证据（可现场打开） | 怎么讲（一句话口径） |
|---|---|---|---|
| ① 需求分析 | 定位"本地化学术写作助手"，明确四大功能与免费配额、多模型接入、数据不出内网 | `README.md`（功能特点/定位）、`docs/PROJECT-STRUCTURE.md` 第 1 节 | "先想清楚解决什么痛点、给谁用、边界在哪" |
| ② 架构设计 | 前后端/数据三段分离；后端分层（配置→装配→中间件→路由→编排→数据）；SSE 流式 + 可取消 + 按 token 计费 | `docs/PROJECT-STRUCTURE.md`（目录树 + 分层图 + JS↔Java 对照表） | "目录即架构，每个文件职责单一" |
| ③ 编码实现 | 后端 6 组路由 + AI 网关 + 全文 Agent；前端 12 个 ES 模块；better-sqlite3 WAL 库 | `server/`（路由/中间件/agents/utils）、`public/js/`、`server/db.js` | "分层 + 网关 + 编排，代码可逐文件讲解" |
| ④ 测试保障 | 30 条 Jest 单测（核心逻辑 + Chain 流水线 6 条新增）+ ESLint 0 error | `tests/`、`eslint.config.js` | "CI 门禁：lint + 测试 + 覆盖率阈值" |
| ⑤ CI/CD | GitHub Actions 每次 push 自动跑质量门禁；Docker 多阶段镜像暴露 3003 | `.github/workflows/ci.yml`、`Dockerfile`、仓库 Actions 页面徽章 | "提交即验证，main 永远是绿的" |
| ⑥ 文档与演示 | 结构详解 / 演示口述稿 / 产品过程地图 / **实现说明报告（核心代码+流程图+伪代码）** + README 完整目录树 + 历史 commit | `docs/*.md`（含 `IMPLEMENTATION-REPORT.md`）、GitHub commit 历史 | "从 README 到代码到演示，一条线讲通" |

## 3. 质量证据（被问"凭什么说它工程化"）

| 证据 | 位置 | 说明 |
|---|---|---|
| CI 徽章常绿 | `README.md` 顶部 | GitHub Actions 自动生成 |
| 36/36 测试通过 | `npm test` 现场跑 | 覆盖 db/加密/chunking/供应商/Chain/LangChain 通道等纯逻辑，不依赖真模型 |
| ESLint 0 error | `npm run lint` | 扁平配置 `eslint.config.js` |
| 生产冒烟 | 本地 `NODE_ENV=production` 启动 | `/health`、首页、写库、日志均验证过 |
| 数据安全 | `data/`（gitignore + dockerignore） | SQLite、JWT Secret、API Key 密钥、日志与源码物理隔离 |
| 提交规范 | GitHub commit 历史 | Conventional Commits 中文描述，commit 可回溯 |

## 4. 六个"AI 课程验收维度"对照与讲解口径

> 若课程大纲/评分维度包含以下条目，按本表组织语言（P0+P1 轻量补强落地后，六项全部可对答）。

| # | 验收维度 | 落地位置 | 讲解口径 |
|---|---|---|---|
| 1 | 提示词模板使用 | `server/prompts.js` | "全部 system 提示词集中成模板库，函数式变量注入；路由/Agent 只引用不内嵌——等价 LangChain PromptTemplate 的模板与渲染分离" |
| 2 | LangChain / Chain | `server/utils/langchainClient.js` + `server/agents/chain.js` + `fullPaperAgent.js` | **双档 Chain**：①单步链——`@langchain/openai` 已接入（依赖清单可见），`ChatPromptTemplate.pipe(ChatOpenAI)` 组成 RunnableSequence，真实驱动 `/api/aigc/rewrite` 降 AI 改写；②多步编排——全文 Agent 的 结构→诊断→报告 三步走自研 Pipeline（声明式步骤 + 失败中止/降级 + 进度回调）。答口径："官方 LangChain 管单步标准链，自研 Pipeline 管多步复杂编排，各有测试守护" |
| 3 | 向量数据库 | （未内置，见下文扩展方向） | "当前无检索需求故未引入；架构上预留了切块(chunking)+DB 抽象，若做知识库可平滑接入 sqlite-vec/Chroma" |
| 4 | RAG / Agent 开发 | `fullPaperAgent.js`（六步任务分解→执行→反思→汇总）、`routes/agent.js`（SSE 进度） | "Agent：任务规划→分步执行→审稿人反思→综合打分，长文走分块 Map-Reduce；RAG 为扩展方向" |
| 5 | 前后端框架与部署 | 后端 Express + 前端原生 ESM MVC + Docker + CI | "后端框架达标；前端无框架但按 MVC 分层（state=Model/DOM=View/页签 JS=Controller），零构建选型；部署见 Dockerfile + Actions" |
| 6 | 典型产品全过程 | 本文档 第 2 节六阶段 + GitHub 历史 | "从需求→架构→编码→测试→CI→部署→文档全走完，证据链完整" |

**扩展方向（若老师追问"为什么没有做 X"）**：
- 向量库/RAG：做一个"参考资料知识库"即可一次点亮两项——上传 docx/txt → 复用现有切块 → 通义 embedding → SQLite 存向量 → 润色时 top-k 检索注入。规模小无需独立向量库服务，答辩说明"可平滑迁移 Chroma/sqlite-vec"。
- 前端框架：验机前不建议重写；演进路线是 Vue/React 替换 Controller 层、Model/Service 复用。

## 5. 推荐答辩路线（10 分钟版）

1. **README** 30 秒：一句话定位 + 目录树三段分离（前端/后端/数据）。
2. **功能演示** 3 分钟：按 `docs/DEMO-SPEECH.md` 走润色→逻辑→AIGC→全文 Agent（重点指 Agent 页面步骤进度条，"不是一次问答，是 Chain 流水线"）。
3. **讲一条请求链路** 2 分钟：浏览器 → `/api/polish` → 中间件(认证/配额/限流) → `prompts.js` 取模板 → `llm.js` 网关 → 大模型 → SSE 流式逐字回传。
4. **亮工程证据** 2 分钟：现场 `npm test`（30/30）+ 打开 GitHub Actions 徽章 + `docs/PROJECT-STRUCTURE.md` 的 JS↔Java 对照。
5. **接招追问** 2 分钟：AI Key 加密（`utils/crypto.js`）、多模型（`providers.js`+`llm.js`）、防超卖（quota + llm_calls 审计）、提示词/Chain 组织（`prompts.js`+`chain.js`）。
