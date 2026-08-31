/**
 * 琢言 · 系统路由（健康检查、Provider 列表、调试日志）
 */

const express = require('express');
const { PROVIDERS } = require('../providers');
const { getLogs, clearLogs } = require('../utils/llm');
const authMiddleware = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// ============================================================
// GET /health — 健康检查（无需认证）
// ============================================================
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    environment: config.nodeEnv,
    memoryUsage: process.memoryUsage().heapUsed
  });
});

// ============================================================
// GET /api/providers — Provider 列表
// ============================================================
router.get('/api/providers', (req, res) => {
  const list = Object.entries(PROVIDERS).map(([key, val]) => ({
    key,
    name: val.name,
    models: val.models,
    defaultModel: val.defaultModel
  }));
  res.json({ providers: list });
});

// ============================================================
// GET /api/debug/logs — 调试日志
// ============================================================
router.get('/api/debug/logs', authMiddleware, (req, res) => {
  const logs = getLogs(req.user.id);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ logs: logs.slice(0, limit) });
});

// ============================================================
// DELETE /api/debug/logs — 清空调试日志
// ============================================================
router.delete('/api/debug/logs', authMiddleware, (req, res) => {
  clearLogs(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
