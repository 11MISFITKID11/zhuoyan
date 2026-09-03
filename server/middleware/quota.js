/**
 * 琢言 · 配额中间件
 *
 * 配额口径（与左下角显示完全一致）：免费每日「可计入的 AI 字数」上限 FREE_QUOTA。
 * 按功能消费点分两类，共用 usageCount/usageDate 同一账户、同一下左角显示：
 *   A. 采纳式（润色建议、逻辑分析、AIGC 检测、降AI改写）——分析/生成过程不消耗额度，
 *      只有用户真正「接受 / 采纳」AI 产出时才按采纳内容的字数计入 usageCount
 *      （统一走 POST /api/usage/adopt，撤销采纳传负数退回）；
 *      语义：做了分析但未采纳修改 → 额度不变；采纳修改 → 额度增加。
 *   B. 完成式（全文智能分析）——产出是评分/诊断/综合报告，没有「采纳」环节，
 *      分析完成即按「导入文本字数」计入 usageCount（同样走 POST /api/usage/adopt）。
 * 因此「左下角显示 used/limit、前端预检、后端拦截、实际入账」四者一致。
 * 真实 token 消耗仍由 llm.js/langchainClient.js 记入 llm_calls 审计表（成本分析用）。
 *
 * quotaMiddleware：免费用户兜底拦截（429 QUOTA_EXCEEDED）——
 *   - 已达上限（used >= limit）：任何消费都拒绝；
 *   - 声明了 req.quotaNeeded（完成式消费的预计入账字数，由全文分析路由设置）时，
 *     若 剩余额度 < quotaNeeded 也直接拒绝——避免白跑一次全文分析后入账失败。
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
    // 1) 已达每日上限 → 拒绝任何消费
    if (used >= config.freeQuota) {
      return res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message: `今日免费额度已用完（${config.freeQuota.toLocaleString()} 字），请升级 Pro`
      });
    }
    // 2) 完成式消费（全文分析）：本次预计按文本字数入账，剩余额度不足则提前拒绝
    const needed = Math.trunc(Number(req.quotaNeeded) || 0);
    if (needed > 0 && used + needed > config.freeQuota) {
      return res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        message: `今日免费额度不足（本次全文分析约需 ${needed.toLocaleString()} 字，剩余 ${Math.max(0, config.freeQuota - used).toLocaleString()} 字），请升级 Pro`
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
