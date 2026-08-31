/**
 * 琢言 · Provider 解析工具
 *
 * 统一的 API Key → Provider / Model 解析逻辑：
 *   1. 如果传入了 rawApiKey（用户临时提供的 Key），直接使用并自动检测 Provider
 *   2. 否则从数据库查询用户的加密 API Key，解密后检测 Provider
 */

const { sqlGet } = require('../db');
const { decryptApiKey } = require('./crypto');
const { autoDetectProvider } = require('../providers');

/**
 * 解析 Provider 信息
 * @param {string} userId - 用户 ID（查库用）
 * @param {object} options - { customEndpoint?, rawApiKey? }
 * @returns {{ apiKey: string, provider: string, model?: string, endpoint: string, byok: boolean } | null}
 */
function resolveProviderInfo(userId, { customEndpoint = '', rawApiKey = '' }) {
  // 优先使用临时传入的 Key（用户自己输入的，明文）
  if (rawApiKey && rawApiKey.trim()) {
    const detected = autoDetectProvider(rawApiKey.trim(), customEndpoint);
    return { apiKey: rawApiKey.trim(), customEndpoint, byok: true, ...detected };
  }
  // 回退到数据库中的 Key
  const user = sqlGet('SELECT apiKey FROM users WHERE id = ?', [userId]);
  const rawKey = user ? decryptApiKey(user.apiKey) : '';
  if (!rawKey) return null;
  const detected = autoDetectProvider(rawKey, customEndpoint);
  return { apiKey: rawKey, customEndpoint, byok: false, ...detected };
}

module.exports = { resolveProviderInfo };
