/**
 * 琢言 · 配置中心
 * 统一管理环境变量、路径、常量
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// 加载 .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ============================================================
// 路径配置
//   rootDir  项目根（源码/配置）
//   dataDir  运行数据目录（数据库/密钥/日志，不入库、不打进镜像）
// ============================================================
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const LOG_DIR = path.join(DATA_DIR, 'logs');

// 确保 data/ 与 data/logs/ 存在（首次启动自动创建）
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const config = {
  // 服务器
  port: parseInt(process.env.PORT) || 3003,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',

  // 路径
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  dataDir: DATA_DIR,
  logDir: LOG_DIR,
  dbFile: path.join(DATA_DIR, 'data.db'),
  secretFile: path.join(DATA_DIR, 'secret.json'),
  encKeyFile: path.join(DATA_DIR, '.enc_key'),

  // JWT
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // 配额
  freeQuota: parseInt(process.env.FREE_QUOTA) || 3000,
  proQuota: 999999,

  // 速率限制
  authRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT) || 20
  },
  apiRateLimit: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.API_RATE_LIMIT) || 15
  },

  // 缓存
  cacheTTL: parseInt(process.env.CACHE_TTL) || 600,

  // 日志
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  // CORS 允许的源
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3003,http://127.0.0.1:3003,http://localhost:3004,http://127.0.0.1:3004')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
};

// ============================================================
// JWT Secret 持久化
// ============================================================
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (fs.existsSync(config.secretFile)) {
    return JSON.parse(fs.readFileSync(config.secretFile, 'utf-8')).secret;
  }
  const secret = 'zhuoyan_jwt_' + crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(config.secretFile, JSON.stringify({ secret }));
  return secret;
}

config.jwtSecret = getJwtSecret();

module.exports = config;
