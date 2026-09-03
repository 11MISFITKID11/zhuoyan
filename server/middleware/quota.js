/**
 * 琢言 · 配额中间件
 *
 * 配额口径（与左下角显示完全一致）：免费每日「可采纳的 AI 修改字数」上限 FREE_QUOTA。
 *   - 分析 / 生成过程（润色建议、逻辑分析、AIGC 检测、降AI改写、全文分析）不消耗额度，
 *     只有用户真正「接受 / 采纳」AI 产出时才按采纳内容的字数计入 usageCount
 *     （统一走 POST /api/usage/adopt，撤销采纳传负数退回）；
 *   - 因此「左下角显示 used/limit、前端预检、后端拦截、实际扣减」四者一致，
 *     且满足产品语义：做了分析但未采纳修改 → 额度不变；采纳修改 → 额度增加。
 * 真实 token 消耗仍由 llm.js/langchainClient.js 记入 llm_calls 审计表（成本分析用）。
 *
 * quotaMiddleware：免费用户已达上限（used >= limit）时兜底拦截（429 QUOTA_EXCEEDED），
 * 不按「本次输入字数」预扣——因为生成过程本身不再计费。
 * 升级 Pro（plan='pro'）后不受限制。
 */

const { sqlGet, sqlRun } = require('../db');
const config = require('../config');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function quotaMiddleware(req, res, next) {
  try {
    const user = sqlGet('SELECT plan, usageDate, usageCount FROM users WHERE id = ?', [req.user.id]);
    if (!user || user.plan === 'pro') return next();

    const used = (user.usageDate === todayStr()) ? (user.usageCount || 0) : 0;
    if (used >= config.freeQuota) {
      return res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message: `今日免费额度已用完（${config.freeQuota.toLocaleString()} 字），请升级 Pro`
      });
    }
    next();
  } catch {
    next();
  }
}

/**
 * 采纳/撤销采纳后调整额度：按「采纳的 AI 修改字数」累计（delta 为负表示撤销退回）。
 * 免费用户超出上限时返回 ok=false（由调用方路由发 429）；额度下限钳制为 0。
 * @param {number} userId 用户 ID
 * @param {number} delta 采纳字数（正）/ 撤销字数（负）
 * @returns {{ok: boolean, used: number, limit: number, plan: string}}
 */
function adjustQuota(userId, delta) {
  try {
    const user = sqlGet('SELECT plan, usageDate, usageCount FROM users WHERE id = ?', [userId]);
    if (!user) return { ok: false, used: 0, limit: config.freeQuota, plan: 'free' };
    if (user.plan === 'pro') {
      return { ok: true, used: (user.usageDate === todayStr()) ? (user.usageCount || 0) : 0, limit: config.proQuota, plan: 'pro' };
    }
    const today = todayStr();
    const used0 = (user.usageDate === today) ? (user.usageCount || 0) : 0;
    const next = used0 + (delta || 0);
    if (next > config.freeQuota) {
      return { ok: false, used: used0, limit: config.freeQuota, plan: user.plan };
    }
    const clamped = Math.max(0, next);
    sqlRun('UPDATE users SET usageDate = ?, usageCount = ? WHERE id = ?', [today, clamped, userId]);
    return { ok: true, used: clamped, limit: config.freeQuota, plan: user.plan };
  } catch {
    return { ok: false, used: 0, limit: config.freeQuota, plan: 'free' };
  }
}

module.exports = quotaMiddleware;
module.exports.adjustQuota = adjustQuota;
