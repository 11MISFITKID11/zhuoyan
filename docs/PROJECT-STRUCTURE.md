# 琢言 · 项目结构详解（验机讲解版）

> 用途：配合老师逐层看目录、逐个文件提问时快速作答。
> 讲解主线：**一次 HTTP 请求从浏览器到数据库的完整链路** + **每个目录/文件在这一链路中的位置**。

---

## 0. 一句话总结

> 琢言是一个**前后端分离、单仓库部署**的本地化学术写作助手：
> `public/`（前端单页应用，无框架）→ `server/`（Express 后端，分层架构）→ `data/`（SQLite 运行数据），三者各自独立、职责单一。

---

## 1. 目录总览

```
zhuoyan/
├─ public/                   前端静态资源（浏览器直接加载）
├─ server/                   后端 Node.js + Express（分层架构核心）
├─ tests/                    Jest 单元测试
├─ docs/                     项目文档（本文件即在此）
├─ data/                     运行数据目录（不入 git、不打 Docker 镜像）
├─ .github/workflows/        GitHub Actions CI
├─ node_modules/             依赖包（npm install 生成）
├─ Dockerfile / .dockerignore        容器化
├─ eslint.config.js / .prettierrc    代码规范
├─ .env.example / .env              环境变量（.env 不入库）
├─ package.json / package-lock.json 依赖与脚本
└─ README.md                 项目说明
```

---

## 2. 后端分层架构（重点讲解）

`server/` 内部按经典分层组织，从外到内：

```
index.js ──► app.js ──► routes/(控制器)
                            │  authMiddleware → quotaMiddleware → rateLimit(横切)
                            ▼
                        agents/ (Agent 编排) ──► utils/llm.js (LLM 网关) ──► 外部大模型 API
                            │                        │
                            ▼                        ▼
                      middleware/quota.js    providers.js (供应商表) + providerResolver.js (运行时解析)
                            │
                            ▼
                        db.js (数据访问) ──► data/data.db (SQLite)
```

**讲解话术**：每一层只依赖它下面的一层，改动不跨层传染——这就是「分层 + 关注点分离」，与 Java 的 Controller/Service/DAO 是同一思想。

| 层 | 目录/文件 | 对应 Java 概念（老师若问） |
|----|-----------|---------------------------|
| 启动层 | `index.js` | main() / Spring Boot Application |
| 装配层 | `app.js` | ApplicationContext 装配 + WebMvcConfigurer |
| 控制器层 | `routes/*.js` | @RestController |
| 横切层 | `middleware/*.js` | Filter / Interceptor / AOP |
| 服务/编排层 | `agents/`、`utils/llm.js` | Service / Strategy + Factory |
| 配置层 | `config.js`、`providers.js` | application.yml + Bean 定义 |
| 数据访问层 | `db.js` | DAO / MyBatis Mapper |
| 工具层 | `utils/*.js` | 公共工具类 |

---

## 3. 每个文件一句话用途

### 3.1 根目录配置文件

| 文件 | 用途 | 验机可答一句 |
|------|------|------------|
| `package.json` | 项目元信息 + 脚本（`start`/`lint`/`test`）与依赖清单 | "入口是 `npm start`，内部跑 `node server/index.js`" |
| `package-lock.json` | 锁定依赖精确版本，保证 CI/他人安装一致 | "npm 自动生成，不用手改" |
| `.env.example` | 环境变量模板（PORT、JWT_SECRET、配额等） | "新环境复制为 .env 即可" |
| `.env` | 本机实际环境变量 | "已 gitignore，密钥不进仓库" |
| `eslint.config.js` | ESLint 扁平配置（前端 + 后端 + 测试） | "CI 里 `npm run lint` 就是用它" |
| `.prettierrc` | 统一代码格式 | "配合 VSCode 保存自动格式化" |
| `Dockerfile` | 多阶段构建，暴露 3003 端口 | "`npm start` 默认端口 3003" |
| `.dockerignore` | 构建镜像时排除 data/、node_modules 等 | "运行数据不打进镜像" |
| `.gitignore` | 不入库清单（data/、node_modules/、.env） | "源码与运行数据彻底分离" |
| `README.md` | 项目说明（含目录树） | "老师先看这个就能懂全貌" |
| `.github/workflows/ci.yml` | CI：lint + 30 条测试 + 覆盖率门槛 | "每次 push 自动跑质量门禁" |

### 3.2 `public/` 前端（无框架单页应用）

| 文件 | 用途 |
|------|------|
| `index.html` | SPA 唯一入口：登录 + 润色/逻辑/AIGC/Agent 四大功能页，**按依赖顺序 `<script>` 引入 12 个 JS 模块** |
| `css/style.css` | 全局样式 |
| `favicon.svg` | 站点图标 |
| `manifest.json` | PWA 安装清单（应用可离线/可安装） |
| `sw.js` | Service Worker，静态资源离线缓存 |
| `vendor/mammoth.browser.min.js` | 本地化的第三方库：浏览器端解析 .docx（Word 导入） |

`public/js/` 12 个模块（从原 3809 行单文件按职责拆分）：

| 模块 | 用途 | 类型 |
|------|------|------|
| `main.js` | 初始化 + 全局事件绑定、页面启动逻辑 | 启动 |
| `state.js` | 全局状态对象（润色/逻辑/AIGC 各自的结果与文档状态） | 状态 |
| `utils.js` | 通用函数：字数统计、.docx 导入、防抖等 | 工具 |
| `emoji-icons.js` | 用图片/字符替换 Emoji 渲染（跨平台显示一致） | 工具 |
| `api-client.js` | 后端 API 封装 + 设置项（自带 Key 模式切换、供应商状态展示） | 通信 |
| `auth.js` | 登录/注册/登出、token 存取、会员升级 UI | 认证 |
| `polish.js` | 润色页渲染：高亮原文、建议列表、接受/忽略 | 功能① |
| `logic.js` | 逻辑页渲染：论证结构图、逻辑断点列表、一键优化 | 功能② |
| `aigc.js` | AIGC 页渲染：逐段 AI 概率、风险标注、降 AI 改写 | 功能③ |
| `agent.js` | Agent 页渲染：多步分析进度、报告导出 | 功能④ |
| `ai-engine.js` | 前端核心引擎：组装请求参数 → 调 `/api/ai` → **解析 SSE 流** → 结果处理 | 引擎 |
| `docs.js` | 文档管理：历史列表、本地/云端切换、导出 | 数据 |

> 讲解要点：**无打包器**（不依赖 webpack/vite），模块靠 `index.html` 里 script 顺序加载、以全局命名空间协作——这是刻意为之，避免给"验机部署"增加构建步骤，任何静态服务器都能直接跑。

**概念映射（被问"没有用 React/Vue 算不算前端框架"时这样答）**

> 本项目是无框架的原生 ES Modules 单页应用，但**按 MVC 思想分层**：
> Model = `state.js`（全局状态）+ `api-client.js`（数据请求）｜ View = `index.html` 的 DOM + `css/`｜ Controller = 各页签模块（`auth.js`/`polish.js`/`logic.js`/`aigc.js`/`agent.js`）
> `ai-engine.js` 相当于 Service 层（业务编排 + SSE 解析）。选型理由：本地化工具零构建、可 PWA 离线、验机演示无环境依赖；如需演进可平滑迁移 Vue/React（Controller 换组件、Model/Service 复用）。

### 3.3 `server/` 后端

**入口与装配**

| 文件 | 用途 |
|------|------|
| `index.js` | 启动入口：读配置 → initDb → 监听端口 → 单实例锁 + 自动开浏览器 |
| `app.js` | Express 装配：安全/压缩/Cookie 中间件 → 静态托管 `public/` → 挂载 6 组路由 → 404/全局错误处理 |
| `config.js` | 配置中心：端口、CORS、配额、**JWT Secret 自动生成与持久化**、运行时数据路径（统一指向 `data/`） |

**数据层**

| 文件 | 用途 |
|------|------|
| `db.js` | better-sqlite3 封装：建表、`sqlGet/sqlAll/sqlRun/sqlInsert` 查询 API、`llm_calls` 审计记录、用户画像存取、优雅停机 |
| `providers.js` | **静态**供应商定义表：OpenAI/DeepSeek/Qwen 等的 endpoint/model/标识，含 `autoDetectProvider` 智能识别 |
| `utils/providerResolver.js` | **运行时**解析：按用户查库 → 解密其 API Key → 匹配供应商 → 产出本次调用的完整参数（与 providers.js 的分工要讲清） |

**横切中间件（middleware/）**

| 文件 | 用途 | 对应 Java |
|------|------|----------|
| `auth.js` | JWT 认证：httpOnly Cookie + Bearer Token 双模式 | Interceptor |
| `quota.js` | 配额中间件：每日免费字数 + 请求后按真实 token 扣减 | AOP 环绕通知 |
| `rateLimit.js` | 登录/API 限流（express-rate-limit），防爆破防滥用 | 网关限流 |

**控制器层（routes/，即 Controller）**

| 文件 | 暴露的接口 | 用途 |
|------|-----------|------|
| `auth.js` | `/api/auth/*` | 注册、登录、登出、改密（bcrypt 加盐哈希 + JWT） |
| `docs.js` | `/api/docs*` | 文档 CRUD（列表带缓存、内容、删除） |
| `ai.js` | `/api/ai/*` | **三大功能**：润色/逻辑优化/AIGC 检测（SSE 流式 + 可取消 + 按 token 计费） |
| `agent.js` | `/api/agent/*` | **Agent 编排**入口：全文多步智能分析（SSE 进度） |
| `user.js` | `/api/user/*` | 用户信息、自带 API Key 的加密保存/切换 |
| `system.js` | `/health`、Provider 列表、调试日志 | 健康检查与运维 |

**编排与工具层**

| 文件 | 用途 |
|------|------|
| `prompts.js` | **提示词模板库**：集中全部 system 提示词（路由级 + Agent 步骤级 + 反思循环），函数式变量注入，对标 LangChain PromptTemplate |
| `agents/chain.js` | **Chain 流水线**：自研轻量链式编排（Pipeline），声明式步骤 + 上下文贯穿 + required 中止/非 required 降级 + 进度回调，对标 LangChain RunnableSequence |
| `agents/fullPaperAgent.js` | **Agent 核心**：以 Chain 三步流水线（结构→综合诊断→综合报告）驱动全文分析，含反思循环（审稿人→改进）、跨文档用户画像、长文自动分块 + 结果合并 |
| `utils/llm.js` | **LLM 网关**：统一 OpenAI 兼容调用、SSE 流式、JSON 模式、429/5xx 指数退避重试、调用审计入库、内存调试日志 |
| `utils/langchainClient.js` | **LangChain 通道**：与 llmRequest 同签名的 textRequest，走 `ChatPromptTemplate.pipe(ChatOpenAI)` 的 LCEL 链（baseURL 复用网关解析）；anthropic / `DISABLE_LANGCHAIN=1` 自动回退原网关；`/api/aigc/rewrite` 已切此通道 |
| `utils/crypto.js` | API Key AES 加解密 + 掩码显示（密钥存 `data/.enc_key`） |
| `utils/logger.js` | Winston 日志：错误/全量分开落盘到 `data/logs/` |
| `utils/cache.js` | NodeCache 内存缓存（文档列表等），带容量上限 |

### 3.4 `tests/` 单元测试（Jest，36 条）

| 文件 | 测什么 |
|------|--------|
| `chunking.test.js` | 长文分块逻辑与多块结果合并（Agent 核心算法） |
| `providers.test.js` | 供应商识别 `autoDetectProvider` 各种 Key 形态 |
| `crypto.test.js` | API Key 加解密往返、掩码格式 |
| `chain.test.js` | Chain 流水线：顺序执行 / required 中止 / 非 required 降级 / 上下文贯穿 / 进度回调 |
| `langchain.test.js` | LangChain 通道：RunnableSequence 非流式/SSE 流式调用、usage 映射、anthropic 回退（mock fetch，不触网） |

> CI 门槛：`npm run lint` 0 error + `npm test` 36/36 + 覆盖率 functions ≥ 30%。

### 3.5 `data/` 运行数据（不入库）

| 文件 | 用途 | 说明 |
|------|------|------|
| `data.db` | SQLite 主库（用户/文档/配额/llm_calls 审计） | WAL 模式，`-wal/-shm` 为伴生文件 |
| `secret.json` | 自动生成的 JWT Secret | 首次启动生成，重启不失效 |
| `.enc_key` | API Key 的 AES 加密密钥 | 与 secret.json 同样不入库 |
| `logs/error.log` `logs/combined.log` | Winston 落盘日志 | 排障用 |

> 讲解要点：这轮重构把 db/密钥/日志从源码根目录**收拢进 data/**，实现「代码与运行数据物理隔离」——对应生产环境把数据挂独立卷的标准做法。

---

## 4. 验机讲解主线（建议顺序）

1. **打开 README** 看目录树 → 讲"前端/后端/数据三段分离"。
2. **浏览器演示**一次润色 → 顺势讲请求链路：
   `浏览器(public/ai-engine.js) → POST /api/ai → routes/ai.js → middleware(认证/配额/限流) → utils/llm.js → 大模型 → SSE 流式回传前端逐字渲染`。
3. 被问"AI Key 怎么存" → 讲 `utils/crypto.js` AES 加密 + `data/.enc_key` + `providerResolver.js` 运行时解密。
4. 被问"多模型怎么支持" → 讲 `providers.js`（定义表）+ `utils/llm.js`（网关，统一 OpenAI 兼容协议）。
5. 被问"怎么防超卖/防刷" → 讲 `middleware/quota.js` + `rateLimit.js` + `llm_calls` 审计表按真实 token 计费。
6. 被问"质量保障" → 打开 GitHub Actions CI：lint + 36 测试 + 覆盖率门禁，现场跑 `npm test`。
7. 被问"提示词/Chain 怎么组织" → 讲 `server/prompts.js`（模板集中 + 变量注入，对标 PromptTemplate）、`server/utils/langchainClient.js`（真实 LangChain LCEL 链驱动降 AI 改写）与 `server/agents/chain.js`（Pipeline 声明式步骤 + 失败降级，对标 RunnableSequence）——**单步链用官方 LangChain，多步编排用自研 Pipeline，两档可分别对答**。
8. 被问"和 Java 项目有什么区别" → 见《技术栈对比》：**思想同构**（分层/IoC 拆分为模块化 require/中间件≈拦截器），差异在规模与生态，本地小工具用 Node 更轻量，**无需换栈**。

---

## 5. 变更记录（本次整理做了什么）

| 变更 | 说明 |
|------|------|
| `server/config.js` | 运行数据路径统一指向 `data/`，启动自动建目录 |
| `server/utils/logger.js` | 日志落盘改到 `data/logs/` |
| `server/utils/provider.js` → `providerResolver.js` | 改名消除与 `providers.js` 的歧义，同步 3 处引用 |
| `.gitignore` / `.dockerignore` | 忽略 `data/`，源码与数据分离 |
| `coverage/` 删除 | 测试产物，CI 重新生成 |
| `README.md` | 重写「项目结构」为完整注释树，修正贡献指南命令 |
| `docs/PROJECT-STRUCTURE.md` | 本文档 |

**约束达成**：全部改动为**移动/改名/路径配置**，未改任何业务逻辑——ESLint 0 error、Jest 24/24 通过、生产模式冒烟（/health 与首页 200、DB 与日志均落在 `data/`）已验证。
