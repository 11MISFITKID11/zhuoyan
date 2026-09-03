/**
 * 琢言 · LangChain 通道适配器（langchainClient）
 *
 * 背景：
 *   项目 LLM 网关（utils/llm.js）默认用原生 fetch 直连各家「OpenAI 兼容」端点。
 *   为落地课程要求「LangChain 及 Chain 的使用」，本文件提供与 llmRequest 同签名的
 *   textRequest()，作为网关的「LangChain 后端」：
 *
 *   - OpenAI 兼容协议 Provider（openai / deepseek / qwen / custom）
 *     → 走 LangChain RunnableSequence：ChatPromptTemplate.pipe(ChatOpenAI)，
 *       baseURL 复用网关同款解析（自定义 Endpoint 优先于供应商默认），零配置改动；
 *   - anthropic（原生 /messages 协议，非 OpenAI 兼容）
 *     → 自动回退原网关，保证所有 Provider 可用；
 *   - 环境变量 DISABLE_LANGCHAIN=1 → 一键切回原生 fetch 通道（排障 / 对比用）。
 *
 * 路由接入方式：把该路由内的 llmRequest(...) 换成 textRequest(...) 即可，
 * SSE 流式、按 token 扣配额、llm_calls 审计、响应结构全部保持不变。
 */

const { ChatOpenAI } = require('@langchain/openai');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { PROVIDERS } = require('../providers');
const { llmRequest, addLog } = require('./llm');
const { recordLlmCall } = require('../db');
const logger = require('./logger');

/** 走 LangChain 的 Provider（均支持 OpenAI 兼容协议）；anthropic 除外 */
const OPENAI_COMPAT_PROVIDERS = new Set(['openai', 'deepseek', 'qwen', 'custom']);

/**
 * 解析请求 baseURL（与 utils/llm.js 的优先级保持一致）：
 * 自定义 Endpoint 优先，其次取供应商默认地址，统一去掉尾部斜杠。
 */
function resolveBaseURL(provider, customEndpoint = '') {
  const ep = String(customEndpoint || '').trim();
  if (ep) return ep.replace(/\/+$/, '');
  const cfg = PROVIDERS[provider];
  return cfg && cfg.baseUrl ? cfg.baseUrl.replace(/\/+$/, '') : '';
}

/** LangChain usage_metadata（input/output/total_tokens）→ 网关统一的 usage 结构 */
function toUsage(metadata = {}) {
  return {
    prompt_tokens: metadata.input_tokens || 0,
    completion_tokens: metadata.output_tokens || 0,
    total_tokens: metadata.total_tokens || 0
  };
}

/** 写 llm_calls 审计表（与原网关同一张表，保证用量统计口径一致） */
function record(rec) {
  try { recordLlmCall(rec); } catch (e) { /* 审计失败不阻断主流程 */ }
}

/**
 * 文本生成请求（与 utils/llm.js 的 llmRequest 同签名，可作为 LangChain 替代实现）
 *
 * @param {string} provider     供应商 key（openai/deepseek/qwen/anthropic/custom）
 * @param {string} apiKey       API Key（已由 providerResolver 解析为明文）
 * @param {string} model        模型名
 * @param {string} systemPrompt 系统提示词（引用 server/prompts.js 模板）
 * @param {string} userText     用户输入文本
 * @param {number} temperature  温度
 * @param {string} customEndpoint 用户自定义 Endpoint（可空）
 * @param {string} userId       用户 ID（计费 / 审计）
 * @param {object} options      { stream, signal, onDelta, timeoutMs }
 * @returns {Promise<{content:string, elapsed:number, usage:object}>}
 */
async function textRequest(provider, apiKey, model, systemPrompt, userText, temperature = 0.3, customEndpoint, userId, options = {}) {
  const startTime = Date.now();

  // 回退条件：非 OpenAI 兼容协议（anthropic），或显式禁用 LangChain → 交给原网关
  if (!OPENAI_COMPAT_PROVIDERS.has(provider) || process.env.DISABLE_LANGCHAIN === '1') {
    return llmRequest(provider, apiKey, model, systemPrompt, userText, temperature, customEndpoint, userId, options);
  }

  const baseURL = resolveBaseURL(provider, customEndpoint);
  if (!baseURL) {
    const err = new Error('缺少 API Endpoint，无法创建 LangChain 通道');
    record({ userId, provider, model, elapsed: 0, success: false, error: err.message });
    throw err;
  }

  // 1) LangChain 模型（OpenAI 兼容）：baseURL 指向与原生网关相同的端点
  const chat = new ChatOpenAI({
    apiKey,
    model,
    temperature,
    timeout: options.timeoutMs || 180000,  // 单请求超时（ms）
    maxRetries: 0,                          // 重试策略由上层控制，LangChain 层不自动重试
    streamUsage: false,                     // 不向兼容端点下发 stream_options，避免个别网关 400；流式用量由路由按原文长度兜底
    configuration: { baseURL }
  });

  // 2) 用 LCEL 把「提示词模板 + 模型」串成一条可执行链（对标 RunnableSequence）
  const chain = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['human', '{text}']
  ]).pipe(chat);

  const runConfig = options.signal ? { signal: options.signal } : {};

  try {
    if (options.stream) {
      // 流式分支：逐 chunk 回调增量（前端 SSE 打字机），内容在服务端聚合
      let content = '';
      const stream = await chain.stream({ text: userText }, runConfig);
      for await (const chunk of stream) {
        const delta = typeof chunk.content === 'string' ? chunk.content : '';
        if (delta) {
          content += delta;
          if (options.onDelta) options.onDelta(delta);
        }
      }
      const elapsed = Date.now() - startTime;
      // 兼容端点在流式响应中不一定返回 usage，取不到则归零，由路由按原文长度兜底扣量
      const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      record({ userId, provider, model, elapsed, promptTokens: 0, completionTokens: 0, totalTokens: 0, success: true });
      logger.debug('LangChain 流式响应', { provider, model, elapsed, contentLength: content.length });
      return { content, elapsed, usage };
    }

    // 非流式分支：一次 invoke 拿全量结果，OpenAI 兼容响应自带 usage → usage_metadata
    const res = await chain.invoke({ text: userText }, runConfig);
    const content = typeof res.content === 'string' ? res.content : '';
    const usage = toUsage(res.usage_metadata || {});
    const elapsed = Date.now() - startTime;
    record({
      userId, provider, model, elapsed,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      success: true
    });
    addLog(userId || 'anonymous', {
      backend: 'langchain', provider, model, elapsed, status: 200,
      requestPreview: JSON.stringify({ url: baseURL, body: { model, temperature } }),
      responsePreview: content.substring(0, 200)
    });
    logger.debug('LangChain 响应', { provider, model, elapsed, contentLength: content.length });
    return { content, elapsed, usage };
  } catch (e) {
    const elapsed = Date.now() - startTime;
    const msg = (e.name === 'AbortError' || e.name === 'TimeoutError')
      ? `LLM 请求超时或已取消（LangChain 通道）: ${baseURL}`
      : `LangChain 调用失败: ${e.message}`;
    record({ userId, provider, model, elapsed, success: false, error: msg });
    throw new Error(msg);
  }
}

module.exports = { textRequest, resolveBaseURL };
