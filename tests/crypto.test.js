/**
 * API Key 加解密 单元测试
 */

const { encryptApiKey, decryptApiKey, maskApiKey } = require('../server/utils/crypto');

describe('crypto（API Key 加解密）', () => {
  test('加密后能解密还原', () => {
    const key = 'sk-ws-abcdef123456';
    const enc = encryptApiKey(key);
    expect(enc).not.toBe(key);
    expect(enc).toContain(':');
    expect(decryptApiKey(enc)).toBe(key);
  });

  test('中文 Key 也能正确往返', () => {
    const key = '密钥-测试-123';
    expect(decryptApiKey(encryptApiKey(key))).toBe(key);
  });

  test('空字符串返回空', () => {
    expect(encryptApiKey('')).toBe('');
    expect(decryptApiKey('')).toBe('');
  });

  test('每次加密结果不同（随机 IV）', () => {
    const key = 'sk-abcdef123456';
    expect(encryptApiKey(key)).not.toBe(encryptApiKey(key));
  });

  test('maskApiKey 隐藏中间部分', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-123****cdef');
  });

  test('maskApiKey 短 key 返回空', () => {
    expect(maskApiKey('short')).toBe('');
  });
});
