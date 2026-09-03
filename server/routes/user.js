/**
 * 琢言 · 用户设置路由
 */

const express = require('express');
const { sqlGet, sqlRun } = require('../db');
const authMiddleware = require('../middleware/auth');
const { adjustQuota } = require('../middleware/quota');
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
 * POST /api/usage/adopt — 每日额度入账统一入口
 * 两种消费方式共用：
 *   - 采纳式（润色/逻辑/AIGC/降AI改写）：分析/生成不扣费，「接受修改」才按采纳内容字数
 *     计入（delta 正）；撤销采纳（undo）传负数退回（delta 负）。
 *   - 完成式（全文智能分析）：分析成功完成后按「导入文本字数」计入（delta = text.length）。
 * 免费用户超出每日限额返回 429 → 只能升级 Pro；Pro 会员不计数直接放行。
 */
router.post('/usage/adopt', authMiddleware, (req, res) => {
  const delta = Math.trunc(Number(req.body && req.body.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ error: '无效的采纳字数' });
  }
  const user = sqlGet('SELECT plan, usageDate, usageCount FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.plan === 'pro') {
    const today = new Date().toISOString().split('T')[0];
    return res.json({
      ok: true, plan: 'pro', limit: config.proQuota,
      used: (user.usageDate === today) ? (user.usageCount || 0) : 0
    });
  }
  const r = adjustQuota(req.user.id, delta);
  if (!r.ok) {
    return res.status(429).json({
      error: 'QUOTA_EXCEEDED',
      message: `今日免费额度不足（每日 ${config.freeQuota.toLocaleString()} 字），请升级 Pro`
    });
  }
  res.json({ ok: true, used: r.used, limit: r.limit, plan: r.plan });
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
