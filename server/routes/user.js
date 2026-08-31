/**
 * 琢言 · 用户设置路由
 */

const express = require('express');
const { sqlGet, sqlRun } = require('../db');
const authMiddleware = require('../middleware/auth');
const { decryptApiKey, encryptApiKey, maskApiKey } = require('../utils/crypto');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/user/settings
 */
router.get('/settings', authMiddleware, (req, res) => {
  const user = sqlGet('SELECT apiKey, usageDate, usageCount FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const rawKey = decryptApiKey(user.apiKey);
  res.json({
    apiKey: maskApiKey(rawKey),
    hasApiKey: !!rawKey,
    usage: { date: user.usageDate || '', count: user.usageCount || 0 }
  });
});

/**
 * PUT /api/user/apikey
 */
router.put('/apikey', authMiddleware, (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: '请输入 API Key' });
  sqlRun('UPDATE users SET apiKey = ? WHERE id = ?', [encryptApiKey(apiKey), req.user.id]);
  res.json({ message: 'API Key 已加密保存' });
});

/**
 * GET /api/usage
 */
router.get('/usage', authMiddleware, (req, res) => {
  const user = sqlGet('SELECT plan, apiKey, usageDate, usageCount FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.json({ used: 0, limit: config.freeQuota, date: '', plan: 'free', isByok: false });
  const hasKey = !!decryptApiKey(user.apiKey);
  const isPro = user.plan === 'pro';
  const limit = isPro ? config.proQuota : config.freeQuota;
  const today = new Date().toISOString().split('T')[0];
  const used = (user.usageDate === today) ? (user.usageCount || 0) : 0;
  res.json({ used, limit, date: today, plan: user.plan || 'free', isByok: hasKey });
});

/**
 * POST /api/upgrade — Pro 升级（DEMO 模式）
 */
router.post('/upgrade', authMiddleware, (req, res) => {
  const { plan, paymentToken } = req.body;
  if (plan !== 'pro') return res.status(400).json({ error: '无效的套餐' });
  if (!paymentToken && config.isProduction) {
    return res.status(402).json({ error: '需要支付验证' });
  }
  sqlRun('UPDATE users SET plan = ? WHERE id = ?', ['pro', req.user.id]);
  res.json({ message: '已升级为 Pro 会员（演示模式）', plan: 'pro' });
});

module.exports = router;
