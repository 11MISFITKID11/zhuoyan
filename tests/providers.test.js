/**
 * autoDetectProvider 单元测试
 * 覆盖 provider 自动识别逻辑（这是最容易因 endpoint/key 格式变化而出错的地方）
 */

const { autoDetectProvider } = require('../server/providers');

describe('autoDetectProvider', () => {
  test('通过 endpoint 含 anthropic 识别为 anthropic', () => {
    const r = autoDetectProvider('sk-test', 'https://api.anthropic.com/v1');
    expect(r.provider).toBe('anthropic');
    expect(r.model).toBe('claude-sonnet-5');
  });

  test('通过 key 前缀 sk-ant- 识别为 anthropic（无 endpoint）', () => {
    const r = autoDetectProvider('sk-ant-abc123', '');
    expect(r.provider).toBe('anthropic');
  });

  test('通过 endpoint 含 deepseek 识别为 deepseek', () => {
    const r = autoDetectProvider('sk-test', 'https://api.deepseek.com');
    expect(r.provider).toBe('deepseek');
    expect(r.model).toBe('deepseek-chat');
  });

  test('通过 endpoint 含 dashscope 识别为 qwen', () => {
    const r = autoDetectProvider('sk-test', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(r.provider).toBe('qwen');
  });

  test('通过 endpoint 含 aliyuncs（专属 MaaS 网关）识别为 qwen', () => {
    const r = autoDetectProvider('sk-ws-test', 'https://ws-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
    expect(r.provider).toBe('qwen');
  });

  test('无 endpoint 默认 openai', () => {
    const r = autoDetectProvider('sk-test', '');
    expect(r.provider).toBe('openai');
    expect(r.model).toBe('gpt-4o-mini');
  });

  test('有未知 endpoint 时按 openai 兼容处理', () => {
    const r = autoDetectProvider('sk-test', 'https://my-custom-endpoint.com/v1');
    expect(r.provider).toBe('openai');
  });
});
