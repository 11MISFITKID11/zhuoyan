/**
 * 琢言 · 认证路由
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { sqlGet, sqlRun, sqlInsert } = require('../db');
const { authLimiter } = require('../middleware/rateLimit');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// 邮箱正则
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

/**
 * POST /api/auth/register
 */
router.post('/register', authLimiter, (req, res) => {
  try {
    const { email, password, securityQuestion, securityAnswer } = req.body;
    if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `密码至少${MIN_PASSWORD_LENGTH}位` });

    const existing = sqlGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: '该邮箱已注册' });

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = sqlInsert(
      `INSERT INTO users (email, passwordHash, apiKey, securityQuestion, securityAnswerHash, usageDate, usageCount, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, passwordHash, '', securityQuestion || null,
        securityQuestion && securityAnswer ? bcrypt.hashSync(securityAnswer, 10) : null,
        '', 0, new Date().toISOString()]
    );

    const token = jwt.sign({ id: userId, email }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    // 设置 httpOnly cookie
    res.cookie('zhuoyan_token', token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    logger.info('用户注册', { userId, email });
    res.json({ token, user: { id: userId, email } });
  } catch (err) {
    logger.error('注册失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });

    const user = sqlGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: '账号不存在' });

    // 检查账号锁定
    if (user.lockedUntil) {
      const lockExpiry = new Date(user.lockedUntil);
      if (new Date() < lockExpiry) {
        const remainMin = Math.ceil((lockExpiry - new Date()) / 60000);
        return res.status(423).json({ error: `账号已锁定，请 ${remainMin} 分钟后再试` });
      }
      // 锁定期已过，重置
      sqlRun('UPDATE users SET loginAttempts = 0, lockedUntil = NULL WHERE id = ?', [user.id]);
    }

    if (!user.passwordHash) return res.status(400).json({ error: '账号数据异常，请重新注册' });
    if (!bcrypt.compareSync(password, user.passwordHash)) {
      // 增加失败计数
      const attempts = (user.loginAttempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60000).toISOString();
        sqlRun('UPDATE users SET loginAttempts = ?, lockedUntil = ? WHERE id = ?', [attempts, lockedUntil, user.id]);
        logger.warn('账号因密码错误过多被锁定', { email, attempts });
        return res.status(423).json({ error: `密码错误次数过多，账号已锁定 ${LOCK_DURATION_MINUTES} 分钟` });
      }
      sqlRun('UPDATE users SET loginAttempts = ? WHERE id = ?', [attempts, user.id]);
      return res.status(400).json({ error: `密码错误（剩余 ${MAX_LOGIN_ATTEMPTS - attempts} 次）` });
    }

    // 登录成功，重置计数
    sqlRun('UPDATE users SET loginAttempts = 0, lockedUntil = NULL WHERE id = ?', [user.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    res.cookie('zhuoyan_token', token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    logger.info('用户登录', { userId: user.id, email });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    logger.error('登录失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('zhuoyan_token');
  res.json({ message: '已退出登录' });
});

/**
 * POST /api/auth/forgot
 */
router.post('/forgot', authLimiter, (req, res) => {
  try {
    const { email, securityAnswer, newPassword } = req.body;
    if (!email) return res.status(400).json({ error: '请输入邮箱' });
    const user = sqlGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: '该邮箱未注册' });

    if (user.securityQuestion && user.securityAnswerHash) {
      if (!securityAnswer) return res.status(400).json({ error: '请回答安全问题', needSecurityQuestion: true, question: user.securityQuestion });
      if (!bcrypt.compareSync(securityAnswer, user.securityAnswerHash)) return res.status(400).json({ error: '安全问题回答错误' });
    } else {
      return res.status(400).json({ error: '未设置安全问题，请联系管理员重置密码' });
    }

    if (newPassword) {
      if (newPassword.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `密码至少${MIN_PASSWORD_LENGTH}位` });
      sqlRun('UPDATE users SET passwordHash = ? WHERE email = ?', [bcrypt.hashSync(newPassword, 10), email]);
      res.json({ message: '密码已重置，请使用新密码登录' });
    } else {
      return res.json({ needSecurityQuestion: true, question: user.securityQuestion });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

module.exports = router;
