# 琢言 · 学术写作助手

![CI](https://github.com/11MISFITKID11/zhuoyan/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

> 一个本地运行的学术写作辅助工具，提供语言润色、逻辑分析、AIGC检测等功能

## 功能特点

- ✅ **学术语言润色**：识别语法错误、清晰度问题、术语不一致
- ✅ **逻辑结构分析**：可视化论证关系，发现逻辑断层
- ✅ **AIGC检测**：逐段评估AI生成概率，支持降AI改写
- ✅ **多模型支持**：兼容 OpenAI、Anthropic、Qwen、DeepSeek 等 API
- ✅ **本地优先**：敏感数据不出内网，无云服务依赖

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 创建 .env 文件（复制示例）
cp .env.example .env

# 3. 启动服务
npm start
```

服务将自动打开浏览器，访问 http://localhost:3003

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3003 | 服务端口 |
| `NODE_ENV` | development | 环境类型 |
| `JWT_SECRET` | 随机生成 | JWT 签名密钥 |
| `FREE_QUOTA` | 3000 | 免费用户每日配额 |
| `CORS_ORIGINS` | 本地端口 | 允许的跨域源 |

## 项目结构

项目按「分层 + 关注点分离」组织，前后端分离部署于同一仓库：

```
zhuoyan/
├─ public/                  # 前端静态资源（Express 直接托管）
│  ├─ index.html            # 单页应用入口（登录 + 四大功能页）
│  ├─ css/style.css         # 全局样式
│  ├─ js/                   # 前端逻辑（无框架，按职责拆 12 个模块）
│  ├─ vendor/               # 本地化的第三方库（Word 解析 mammoth）
│  ├─ manifest.json         # PWA 安装清单
│  ├─ sw.js                 # Service Worker（离线缓存）
│  └─ favicon.svg           # 站点图标
├─ server/                  # 后端（Node.js + Express）
│  ├─ index.js              # 启动入口（单实例锁 + 自动开浏览器）
│  ├─ app.js                # Express 装配（中间件/路由/静态/错误处理）
│  ├─ config.js             # 配置中心（env、路径、JWT Secret）
│  ├─ db.js                 # better-sqlite3（建表 + 查询封装 + 审计）
│  ├─ providers.js          # LLM 供应商定义表（OpenAI/DeepSeek/Qwen…）
│  ├─ prompts.js            # 提示词模板库（集中管理，对标 PromptTemplate）
│  ├─ middleware/           # 横切中间件（认证 / 配额 / 限流）
│  ├─ routes/               # 路由层（Controller：auth/docs/ai/agent/user/system）
│  ├─ agents/               # Agent 编排（chain.js 流水线 + fullPaperAgent 全文分析）
│  └─ utils/                # 工具层（LLM 网关 / LangChain 通道 / 加解密 / 日志等）
├─ tests/                   # Jest 单元测试（36 用例：核心逻辑 + Chain/LangChain 通道）
├─ docs/                    # 项目文档
├─ data/                    # 运行数据目录（不入库、不打镜像）
│  ├─ data.db               # SQLite 数据库（WAL 模式）
│  ├─ secret.json           # 自动生成的 JWT Secret
│  ├─ .enc_key              # API Key AES 加密密钥
│  └─ logs/                 # Winston 日志（error.log / combined.log）
├─ .github/workflows/ci.yml # GitHub Actions：lint + 测试 + 覆盖率门槛
├─ Dockerfile               # 多阶段构建（node:18-alpine）
├─ eslint.config.js         # ESLint 扁平配置
├─ .env.example             # 环境变量模板
└─ package.json             # 依赖与脚本（start / lint / test）
```

## 贡献指南

```bash
# 安装开发依赖
npm install

# 代码规范检查（CI 门禁之一）
npm run lint

# 运行测试（含覆盖率）
npm test
```

## 许可证

[MIT](LICENSE)