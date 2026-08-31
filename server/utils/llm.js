/**
 * 琢言 · LLM 调用服务
 *
 * v2：支持流式输出（SSE）、JSON response_format、429/5xx 指数退避重试、
 *     调用记录（llm_calls 表，token 计费 + 成本审计）、外部取消（AbortSignal）
 */

const { PROVIDERS } = require('../providers');
const { recordLlmCall } = require('../db');
const logger = require('./logger');

// ============================================================
// 调试日志（按用户 ID 隔离，限制用户数防内存泄漏）
// ============================================================
const debugLogs = {};
const MAX_LOGS = 200;
const MAX_LOG_USERS = 100;

function addLog(userId, entry) {
  const uid = userId || 'anonymous';
  if (!debugLogs[uid]) {
    const keys = Object.keys(debugLogs);
    if (keys.length >= MAX_LOG_USERS) {
      delete debugLogs[keys[keys.length - 1]];
    }
    debugLogs[uid] = [];
  }
  entry.timestamp = new Date().toISOString();
  entry.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  debugLogs[uid].unshift(entry);
  if (debugLogs[uid].length > MAX_LOGS) debugLogs[uid].length = MAX_LOGS;
}

function getLogs(userId) {
  return debugLogs[userId || 'anonymous'] || [];
}

function clearLogs(userId) {
  const uid = userId || 'anonymous';
  if (debugLogs[uid]) debugLogs[uid] = [];
}

// 记录一次 LLM 调用（成功/失败都记，用于计费与审计）
function _recordCall(rec) {
  try { recordLlmCall(rec); } catch (e) {}
}

// ============================================================
// 核心：调用 LLM（支持流式 / 重试 / response_format / 取消）
// ============================================================
async function callLLM(provider, apiKey, model, messages, temperature = 0.3, customEndpoint, userId, options = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error('不支持的 Provider: ' + provider);

  const baseUrl = (customEndpoint || '').trim()
    ? customEndpoint.replace(/\/$/, '')
    : cfg.baseUrl;
  if (!baseUrl) throw new Error('请填写自定义 API Endpoint');

  const isAnthropic = provider === 'anthropic';
  const url = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;

  // 组装 body
  const body = cfg.formatBody(model, messages, temperature);
  if (options.responseFormat && !isAnthropic) {
    body.response_format = options.responseFormat;
  }
  if (options.stream) {
    body.stream = true;
  }

  const headers = cfg.headers(apiKey);
  const startTime = Date.now();
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const timeoutMs = options.timeoutMs || 180000;

  // 组合「外部取消信号 + 超时信号」
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      });

      // 流式分支：把 token 增量回调给调用方
      if (options.stream && response.ok) {
        return await _readStream(response, { provider, model, startTime, userId, onDelta: options.onDelta });
      }

      const raw = await response.text();
      let data = null;
      try { data = JSON.parse(raw); } catch {}

      const elapsed = Date.now() - startTime;
      addLog(userId || 'anonymous', {
        provider, model, elapsed, status: response.status,
        requestPreview: JSON.stringify({
          url,
          body: {
            ...body,
            messages: messages.map(m => ({ role: m.role, content: m.content.substring(0, 100) }))
          }
        }),
        responsePreview: raw.substring(0, 500),
        error: response.ok ? null : raw.substring(0, 300)
      });

      // 429 / 5xx：指数退避重试
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const delayMs = 500 * Math.pow(2, attempt);
        logger.warn(`LLM 请求失败（${response.status}），${delayMs}ms 后重试`, { provider, model, attempt: attempt + 1 });
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        logger.error('LLM API 错误', { provider, model, status: response.status, error: raw.substring(0, 200) });
        const err = new Error(`API 错误 (${response.status}): ${raw.substring(0, 200)}`);
        _recordCall({ userId, provider, model, elapsed, success: false, error: err.message });
        throw err;
      }

      const content = cfg.parseResponse(data);
      const usage = data.usage || {};
      _recordCall({
        userId, provider, model, elapsed,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        success: true
      });
      logger.debug('LLM 响应', { provider, model, elapsed, contentLength: content.length });
      return { content, elapsed, usage };
    } catch (e) {
      const elapsed = Date.now() - startTime;
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        const msg = `LLM 请求超时（${Math.round(timeoutMs / 1000)}s）或已取消: ${url}，请检查模型名称与 Endpoint 是否正确，或尝试缩短文本`;
        _recordCall({ userId, provider, model, elapsed, success: false, error: msg });
        throw new Error(msg);
      }
      // 网络类异常：重试
      if (attempt < maxRetries) {
        const delayMs = 500 * Math.pow(2, attempt);
        logger.warn('LLM 请求异常，稍后重试', { provider, model, attempt: attempt + 1, error: e.message });
        await sleep(delayMs);
        continue;
      }
      _recordCall({ userId, provider, model, elapsed, success: false, error: e.message });
      throw e;
    }
  }
  throw new Error('LLM 请求失败（重试耗尽）');
}

// ============================================================
// 流式读取：解析 SSE 增量，回调给调用方
// ============================================================
async function _readStream(response, { provider, model, startTime, userId, onDelta }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            if (onDelta) onDelta(delta);
          }
          if (json.usage) usage = json.usage;
        } catch (e) { /* 忽略无法解析的块 */ }
      }
    }
  } catch (e) {
    _recordCall({ userId, provider, model, elapsed: Date.now() - startTime, success: false, error: e.message });
    throw e;
  }

  const elapsed = Date.now() - startTime;
  _recordCall({
    userId, provider, model, elapsed,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    success: true
  });
  return { content, elapsed, usage };
}

/**
 * 统一 Prompt 封装
 * options: { stream, responseFormat, signal, onDelta, maxRetries, timeoutMs }
 */
async function llmRequest(provider, apiKey, model, systemPrompt, userText, temperature, customEndpoint, userId, options = {}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText }
  ];
  return callLLM(provider, apiKey, model, messages, temperature, customEndpoint, userId, options);
}

module.exports = { callLLM, llmRequest, addLog, getLogs, clearLogs };
