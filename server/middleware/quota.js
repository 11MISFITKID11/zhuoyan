/**
 * 琢言 · 配额中间件
 *
 * 改为「先检查、成功后扣费」模式：
 *   - quotaMiddleware 只判断是否超限，不预扣减；
 *   - 请求成功后再调用 consumeQuota 真正扣费，失败不扣。
 * 避免了旧版「预扣减不退还」导致失败也扣字、额度被浪费的问题。
 */

const { sqlGet, sqlRun } = require('../db');
const config = require('../config');

function quotaMiddleware(req, res, next) {
  try {
    const user = sqlGet('SELECT plan, usageDate, usageCount FROM users WHERE id = ?', [req.user.id]);
    if (!user) return next();
    if (user.plan === 'pro') return next();

    const today = new Date().toISOString().split('T')[0];
    const limit = config.freeQuota;
    const currentUsed = (user.usageDate === today) ? (user.usageCount || 0) : 0;
    const estimatedWords = (req.body.text || '').length || 1;

    if (currentUsed + estimatedWords > limit) {
      return res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message: `今日免费额度已用完（${limit.toLocaleString()} 字），请升级 Pro`
      });
    }

    // 只检查，不预扣减（成功后才由 consumeQuota 扣费）
    next();
  } catch (e) {
    next();
  }
}

/**
 * 成功后扣费（按实际消耗字数累加）
 * @param {number} userId 用户 ID
 * @param {number} words 消耗字数
 */
function consumeQuota(userId, words) {
  try {
    const user = sqlGet('SELECT plan, usageDate, usageCount FROM users WHERE id = ?', [userId]);
    if (!user || user.plan === 'pro') return;
    const today = new Date().toISOString().split('T')[0];
    const w = words || 0;
    if (user.usageDate !== today) {
      sqlRun('UPDATE users SET usageDate = ?, usageCount = ? WHERE id = ?', [today, w, userId]);
    } else {
      sqlRun('UPDATE users SET usageCount = usageCount + ? WHERE id = ?', [w, userId]);
    }
  } catch (e) {
    // 扣费失败不应影响主流程
  }
}

module.exports = quotaMiddleware;
module.exports.consumeQuota = consumeQuota;
