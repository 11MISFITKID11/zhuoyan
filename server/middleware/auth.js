/**
 * 琢言 · JWT 认证中间件
 * 支持 httpOnly Cookie 和 Bearer Token 双模式
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

function authMiddleware(req, res, next) {
  let token = null;

  // 优先从 httpOnly Cookie 获取
  if (req.cookies && req.cookies.zhuoyan_token) {
    token = req.cookies.zhuoyan_token;
  }
  // 回退到 Bearer Token
  else {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (e) {
    logger.debug('JWT 验证失败', { error: e.message });
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

module.exports = authMiddleware;
