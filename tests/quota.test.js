/**
 * 琢言 · 配额中间件单元测试
 * 验证两类消费口径：
 *   A. 采纳式：adjustQuota 正负 delta 累计/退回、超限拒绝、下限钳 0（润色/逻辑/AIGC 采纳场景）
 *   B. 完成式：quotaMiddleware 对 req.quotaNeeded（全文分析按导入文本字数入账）的剩余额度预检
 */
jest.mock('../server/db', () => ({
  sqlGet: jest.fn(),
  sqlRun: jest.fn()
}));

const { sqlGet, sqlRun } = require('../server/db');
const quotaMiddleware = require('../server/middleware/quota');
const { adjustQuota } = require('../server/middleware/quota');
const config = require('../server/config');

/* global jest, describe, test, expect, beforeEach */

const today = new Date().toISOString().split('T')[0];
const FREE = config.freeQuota;

function mkRes() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn(function (code) { res.statusCode = code; return this; });
  res.json = jest.fn(function (body) { res.body = body; return this; });
  return res;
}

describe('quotaMiddleware — 完成式消费（全文分析 quotaNeeded）预检', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    sqlGet.mockReturnValue({ plan: 'free', usageDate: today, usageCount: FREE - 100 }); // 已用 2900/3000
  });

  test('Pro 会员不受限，即使 quotaNeeded 超过免费上限也放行', () => {
    sqlGet.mockReturnValue({ plan: 'pro', usageDate: '', usageCount: 0 });
    const res = mkRes();
    const next = jest.fn();
    quotaMiddleware({ user: { id: 1 }, quotaNeeded: 50000 }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('剩余 100 字，本次全文分析需 200 字 → 429 拦截', () => {
    const res = mkRes();
    const next = jest.fn();
    quotaMiddleware({ user: { id: 1 }, quotaNeeded: 200 }, res, next);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('QUOTA_EXCEEDED');
    expect(next).not.toHaveBeenCalled();
  });

  test('剩余 100 字，本次全文分析需 50 字 → 放行（不预扣）', () => {
    const res = mkRes();
    const next = jest.fn();
    quotaMiddleware({ user: { id: 1 }, quotaNeeded: 50 }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('采纳式请求（未声明 quotaNeeded）未达上限 → 放行', () => {
    const res = mkRes();
    const next = jest.fn();
    quotaMiddleware({ user: { id: 1 }, quotaNeeded: undefined }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('已达上限且未声明 quotaNeeded → 429（旧兜底逻辑保留）', () => {
    sqlGet.mockReturnValue({ plan: 'free', usageDate: today, usageCount: FREE });
    const res = mkRes();
    const next = jest.fn();
    quotaMiddleware({ user: { id: 1 } }, res, next);
    expect(res.statusCode).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('adjustQuota — 采纳式计费（润色/逻辑/AIGC 采纳 & 撤销）', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    sqlRun.mockReturnValue({ changes: 1 });
  });

  test('采纳 +120 字：从 0 累加到 120 并写库', () => {
    sqlGet.mockReturnValue({ plan: 'free', usageDate: today, usageCount: 0 });
    const r = adjustQuota(1, 120);
    expect(r.ok).toBe(true);
    expect(r.used).toBe(120);
    expect(sqlRun).toHaveBeenCalledWith(
      'UPDATE users SET usageDate = ?, usageCount = ? WHERE id = ?',
      [today, 120, 1]
    );
  });

  test('撤销 −80 字：退回且下限钳 0', () => {
    sqlGet.mockReturnValue({ plan: 'free', usageDate: today, usageCount: 50 });
    const r = adjustQuota(1, -80);
    expect(r.ok).toBe(true);
    expect(r.used).toBe(0);
  });

  test('采纳后超限（2900 + 200 > 3000）→ ok=false，不写库', () => {
    sqlGet.mockReturnValue({ plan: 'free', usageDate: today, usageCount: FREE - 100 });
    const r = adjustQuota(1, 200);
    expect(r.ok).toBe(false);
    expect(r.used).toBe(FREE - 100);
    expect(sqlRun).not.toHaveBeenCalled();
  });

  test('Pro 会员不计费：返回 ok=true 且不写 usageCount', () => {
    sqlGet.mockReturnValue({ plan: 'pro', usageDate: '', usageCount: 0 });
    const r = adjustQuota(1, 9999);
    expect(r.ok).toBe(true);
    expect(r.plan).toBe('pro');
    expect(sqlRun).not.toHaveBeenCalled();
  });
});
