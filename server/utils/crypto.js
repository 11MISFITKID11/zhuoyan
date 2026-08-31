/**
 * 琢言 · 加密工具
 * AES-256-CBC 加密/解密 API Key
 */

const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');

function getEncKey() {
  if (fs.existsSync(config.encKeyFile)) {
    return Buffer.from(fs.readFileSync(config.encKeyFile, 'utf-8').trim(), 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(config.encKeyFile, key.toString('hex'));
  return key;
}

function encryptApiKey(s) {
  if (!s) return '';
  const key = getEncKey();
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  let e = c.update(s, 'utf8', 'hex');
  e += c.final('hex');
  return iv.toString('hex') + ':' + e;
}

function decryptApiKey(s) {
  if (!s) return '';
  try {
    const p = s.split(':');
    if (p.length !== 2) return s;
    const d = crypto.createDecipheriv('aes-256-cbc', getEncKey(), Buffer.from(p[0], 'hex'));
    let r = d.update(p[1], 'hex', 'utf8');
    r += d.final('utf8');
    return r;
  } catch (e) {
    return '';
  }
}

function maskApiKey(s) {
  return s && s.length > 8 ? s.substring(0, 6) + '****' + s.slice(-4) : '';
}

module.exports = { encryptApiKey, decryptApiKey, maskApiKey };
