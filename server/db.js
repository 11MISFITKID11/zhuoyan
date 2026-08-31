/**
 * 琢言 · 数据库模块（better-sqlite3）
 *
 * better-sqlite3：原生 SQLite，同步 API，自带文件锁与自动持久化，
 * 多实例安全共享同一数据文件，根治了 sql.js 内存库「各自内存、最后写盘者赢」导致的互相覆盖问题。
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./utils/logger');

let db = null;

// ============================================================
// 初始化
// ============================================================
function initDb() {
  if (db) return db;
  const existed = fs.existsSync(config.dbFile);
  db = new Database(config.dbFile);

  // WAL 模式 + 外键约束（多实例并发读写安全）
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 建表
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    apiKey TEXT DEFAULT '',
    securityQuestion TEXT,
    securityAnswerHash TEXT,
    usageDate TEXT DEFAULT '',
    usageCount INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    loginAttempts INTEGER DEFAULT 0,
    lockedUntil TEXT DEFAULT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);

  // 兼容旧表：缺失列则补充（列已存在会抛错，忽略即可）
  try { db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'"); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN loginAttempts INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN lockedUntil TEXT DEFAULT NULL'); } catch (e) {}

  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'polish',
    content TEXT DEFAULT '',
    words INTEGER DEFAULT 0,
    date TEXT DEFAULT '刚刚',
    status TEXT DEFAULT '草稿',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(userId)');

  // 用户画像表（跨文档记忆，用于个性化分析）
  db.exec(`CREATE TABLE IF NOT EXISTS user_profile (
    userId INTEGER PRIMARY KEY,
    profile TEXT DEFAULT '',
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(id)
  )`);

  // LLM 调用审计表（token 计费 + 成本审计）
  db.exec(`CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    provider TEXT DEFAULT '',
    model TEXT DEFAULT '',
    promptTokens INTEGER DEFAULT 0,
    completionTokens INTEGER DEFAULT 0,
    totalTokens INTEGER DEFAULT 0,
    elapsed INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    error TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_llm_calls_user ON llm_calls(userId)');

  logger.info('SQLite 已就绪', { path: config.dbFile, existed });
  return db;
}

// ============================================================
// 优雅关闭（node:sqlite 自动落盘，这里仅负责关闭连接）
// ============================================================
function setupGracefulShutdown() {
  const shutdown = () => {
    if (db) {
      try { db.close(); db = null; } catch (e) {}
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function getDb() {
  if (!db) throw new Error('数据库未初始化');
  return db;
}

// ============================================================
// 统一查询封装（接口与旧版 sql.js 保持一致）
// ============================================================
function sqlGet(sql, params) {
  return getDb().prepare(sql).get(...(params || []));
}

function sqlAll(sql, params) {
  return getDb().prepare(sql).all(...(params || []));
}

function sqlRun(sql, params) {
  getDb().prepare(sql).run(...(params || []));
}

function sqlInsert(sql, params) {
  const r = getDb().prepare(sql).run(...(params || []));
  return Number(r.lastInsertRowid) || 0;
}

// 兼容旧接口：better-sqlite3 每次写操作立即持久化，无需手动落盘
function saveNow() {}

// ============================================================
// 用户画像（跨文档记忆）
// ============================================================
function getUserProfile(userId) {
  const row = sqlGet('SELECT profile FROM user_profile WHERE userId = ?', [userId]);
  return row ? row.profile : '';
}

function saveUserProfile(userId, profile) {
  sqlRun(
    `INSERT INTO user_profile (userId, profile, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET profile = excluded.profile, updatedAt = excluded.updatedAt`,
    [userId, profile, new Date().toISOString()]
  );
}

// ============================================================
// LLM 调用记录（token 计费 + 成本审计）
// ============================================================
function recordLlmCall({ userId, provider, model, promptTokens = 0, completionTokens = 0, totalTokens = 0, elapsed = 0, success = true, error = null }) {
  try {
    sqlRun(
      `INSERT INTO llm_calls (userId, provider, model, promptTokens, completionTokens, totalTokens, elapsed, success, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, provider || '', model || '', promptTokens, completionTokens, totalTokens, elapsed, success ? 1 : 0, error ? String(error).substring(0, 500) : null]
    );
  } catch (e) {}
}

module.exports = { initDb, getDb, sqlGet, sqlAll, sqlRun, sqlInsert, saveNow, setupGracefulShutdown, getUserProfile, saveUserProfile, recordLlmCall };
