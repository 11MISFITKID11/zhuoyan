/**
 * 琢言 · 速率限制配置
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const authLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.max,
  message: { error: '请求过于频繁，请 15 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: config.apiRateLimit.windowMs,
  max: config.apiRateLimit.max,
  message: { error: 'API 调用过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { authLimiter, apiLimiter };
