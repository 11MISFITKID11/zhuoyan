# 琢言 · 学术写作助手

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

```
server/
├── config.js         # 配置中心
├── db.js             # 数据库操作
├── utils/            # 工具库
├── middleware/       # Express 中间件
└── routes/           # API 路由
```

## 贡献指南

```bash
# 安装开发依赖
npm install --dev

# 代码格式化
npm run lint
npm run format

# 运行测试
npm test
```

## 许可证

[MIT](LICENSE)