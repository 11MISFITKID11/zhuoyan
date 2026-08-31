/**
 * 琢言 · Express 应用配置
 * 中间件注册、路由挂载、静态文件服务
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./config');
const logger = require('./utils/logger');

// 路由
const authRoutes = require('./routes/auth');
const docRoutes = require('./routes/docs');
const aiRoutes = require('./routes/ai');
const userRoutes = require('./routes/user');
const systemRoutes = require('./routes/system');
const agentRoutes = require('./routes/agent');

const app = express();

// ============================================================
// 安全中间件
// ============================================================
app.use(helmet({
  contentSecurityPolicy: config.isProduction ? undefined : false,
  crossOriginEmbedderPolicy: false
}));

// ============================================================
// CORS
// ============================================================
app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));

// ============================================================
// 压缩
// ============================================================
app.use(compression());

// ============================================================
// Cookie 解析
// ============================================================
app.use(cookieParser());

// ============================================================
// Body 解析
// ============================================================
app.use(express.json({ limit: '10mb' }));

// ============================================================
// 请求日志
// ============================================================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    logger.debug(`${req.method} ${req.path} ${res.statusCode} ${elapsed}ms`);
  });
  next();
});

// ============================================================
// API 路由挂载
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/docs', docRoutes);
app.use('/api', aiRoutes);     // /api/polish, /api/logic, /api/aigc/*
app.use('/api/agent', agentRoutes); // /api/agent/analyze
app.use('/api/user', userRoutes);  // /api/user/settings, /api/user/apikey
app.use('/', systemRoutes);    // /health, /api/providers, /api/debug/logs

// /api/usage 和 /api/upgrade 也挂到 user routes
app.use('/api', userRoutes);

// ============================================================
// 前端错误上报
// ============================================================
app.post('/api/log/error', express.json(), (req, res) => {
  const { message, stack, url } = req.body || {};
  logger.error('前端错误', { message, stack: stack?.substring(0, 500), url });
  res.json({ ok: true });
});

// ============================================================
// 静态文件服务（前端 public/）
// ============================================================
app.use(express.static(config.publicDir));

// ============================================================
// 404 处理
// ============================================================
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  // 非 API 请求回退到 index.html（SPA）
  res.sendFile('index.html', { root: config.publicDir });
});

// ============================================================
// 全局错误处理
// ============================================================
app.use((err, req, res, _next) => {
  logger.error('未捕获错误', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: config.isProduction ? '服务器内部错误' : err.message });
});

module.exports = app;
