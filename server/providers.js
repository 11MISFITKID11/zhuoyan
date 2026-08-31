/**
 * 琢言 · LLM Provider 配置
 */

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),
    formatBody: (model, messages, temperature) => ({ model, messages, temperature }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat'],
    defaultModel: 'deepseek-chat',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),
    formatBody: (model, messages, temperature) => ({ model, messages, temperature }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3.6-flash', 'qwen-plus', 'qwen-max', 'qwen-turbo'],
    defaultModel: 'qwen3.6-plus',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),
    formatBody: (model, messages, temperature) => ({ model, messages, temperature }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-5', 'claude-haiku'],
    defaultModel: 'claude-sonnet-5',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }),
    formatBody: (model, messages, temperature) => {
      const systemMsg = messages.find(m => m.role === 'system');
      const userMsgs = messages.filter(m => m.role !== 'system');
      return {
        model,
        system: systemMsg?.content || '',
        messages: userMsgs,
        max_tokens: 4096,
        temperature
      };
    },
    parseResponse: (data) => data.content?.[0]?.text || ''
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    models: ['custom-model'],
    defaultModel: 'custom-model',
    headers: (apiKey, extra) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extra
    }),
    formatBody: (model, messages, temperature) => ({ model, messages, temperature }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  }
};

/**
 * 自动识别 AI 提供商（凭 API Key 和 Endpoint）
 */
function autoDetectProvider(apiKey, customEndpoint) {
  const ep = (customEndpoint || '').toLowerCase();
  const key = (apiKey || '').toLowerCase();
  if (ep.includes('anthropic') || key.startsWith('sk-ant-')) {
    return { provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel };
  }
  if (ep.includes('deepseek')) {
    return { provider: 'deepseek', model: PROVIDERS.deepseek.defaultModel };
  }
  if (ep.includes('dashscope') || ep.includes('aliyun') || ep.includes('qwen')) {
    return { provider: 'qwen', model: PROVIDERS.qwen.defaultModel };
  }
  return { provider: 'openai', model: PROVIDERS.openai.defaultModel };
}

module.exports = { PROVIDERS, autoDetectProvider };
