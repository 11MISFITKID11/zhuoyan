/**
 * 琢言 · AI 功能路由（润色、逻辑、AIGC）
 *
 * v2：所有接口支持 SSE 流式输出（Accept: text/event-stream）、
 *     客户端取消（AbortController 链路）、JSON response_format + 解析失败重试、
 *     免费额度按「输入字数」扣减（与左下角显示口径一致，见 middleware/quota.js），
 *     真实 token 消耗另记入 llm_calls 审计表
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const quotaMiddleware = require('../middleware/quota');
const { apiLimiter } = require('../middleware/rateLimit');
const { llmRequest } = require('../utils/llm');
const { textRequest } = require('../utils/langchainClient');
const { resolveProviderInfo } = require('../utils/providerResolver');
const prompts = require('../prompts');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================
// 辅助函数
// ============================================================

// 解析 JSON 数组；失败返回 null（触发重试）
function parseJsonArray(raw) {
  const match = String(raw || '').match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

// 按原文段落拼装 AIGC 结果：模型只需返回 { index, aiRate }，不回显段落原文。
// 输出 token 从「≈输入 2~3 倍」降为「每段几 token」，长文检测显著提速；段落文本始终取原文，不丢内容。
function composeParagraphResults(paragraphs, list) {
  const rateByIndex = new Map();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && Number.isFinite(item.aiRate)) {
        const idx = Number(item.index);
        if (Number.isInteger(idx) && idx >= 1 && idx <= paragraphs.length) {
          rateByIndex.set(idx, item.aiRate);
        }
      }
    }
  }
  return paragraphs.map((text, i) => {
    let rate = rateByIndex.get(i + 1);
    if (typeof rate !== 'number' || !(rate >= 0 && rate <= 1)) rate = 0.5; // 模型漏评段落给保守中位
    return { text, aiRate: Math.round(rate * 100) / 100 };
  });
}

// 客户端断开（刷新/取消）时 abort LLM 调用，避免服务端白跑
function makeAbortSignal(req, res) {
  const controller = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

// 初始化 SSE 响应头
function startSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
}

// 带 JSON 解析重试的 LLM 调用（response_format + 失败带错重试一次）
async function llmJsonCall({ provider, apiKey, model, systemPrompt, text, temperature, customEndpoint, userId, signal }) {
  const attempt = async (extra) => {
    // extra 为 retryInstruction 生成的纠偏指令（完整追加片段），非空时拼在 systemPrompt 之后
    const prompt = extra ? systemPrompt + extra : systemPrompt;
    return llmRequest(provider, apiKey, model, prompt, text, temperature, customEndpoint, userId, {
      responseFormat: { type: 'json_object' },
      signal
    });
  };

  let result = await attempt(null);
  let parsed = parseJsonArray(result.content);
  if (parsed === null) {
    logger.warn('JSON 解析失败，自动带错重试一次', { provider, model });
    result = await attempt(prompts.retryInstruction(result.content.slice(0, 200)));
    parsed = parseJsonArray(result.content);
  }
  return { parsed, result };
}

// ============================================================
// POST /api/polish — 学术语言润色
// ============================================================
router.post('/polish', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model: modelName } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });

    const info = resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });
    if (!info) return res.status(400).json({ error: '请先在设置中配置 API Key，或在下方输入临时使用的 Key' });
    const provider = info.provider;
    const model = modelName || info.model;

    const systemPrompt = prompts.POLISH_SYSTEM;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.2, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        const suggestions = parseJsonArray(result.content) || [];
        res.write(`data: ${JSON.stringify({ type: 'complete', suggestions, usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const { parsed, result } = await llmJsonCall({
      provider, apiKey: info.apiKey, model, systemPrompt, text,
      temperature: 0.2, customEndpoint, userId: req.user.id, signal
    });
    if (parsed === null) {
      return res.json({ suggestions: [], raw: result.content, parseError: true });
    }
    res.json({ suggestions: parsed, elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    logger.error('润色失败', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/logic — 逻辑分析
// ============================================================
router.post('/logic', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model: modelName } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });

    const info = resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });
    if (!info) return res.status(400).json({ error: '请先在设置中配置 API Key，或在下方输入临时使用的 Key' });
    const provider = info.provider;
    const model = modelName || info.model;

    const systemPrompt = prompts.LOGIC_SYSTEM;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.3, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        const parsed = parseJsonArray(result.content);
        res.write(`data: ${JSON.stringify({ type: 'complete', nodes: parsed || [], parseError: parsed === null, usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const { parsed, result } = await llmJsonCall({
      provider, apiKey: info.apiKey, model, systemPrompt, text,
      temperature: 0.3, customEndpoint, userId: req.user.id, signal
    });
    if (parsed === null) {
      return res.json({ nodes: [], raw: result.content, parseError: true });
    }
    res.json({ nodes: parsed, elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    logger.error('逻辑分析失败', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/logic/optimize — 逻辑优化（纯文本输出）
// ============================================================
router.post('/logic/optimize', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model: modelName } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });

    const info = resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });
    if (!info) return res.status(400).json({ error: '请先在设置中配置 API Key，或在下方输入临时使用的 Key' });
    const provider = info.provider;
    const model = modelName || info.model;

    const systemPrompt = prompts.LOGIC_OPTIMIZE_SYSTEM;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.4, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        res.write(`data: ${JSON.stringify({ type: 'complete', optimized: result.content.trim(), usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.4, customEndpoint, req.user.id, { signal });
    res.json({ optimized: result.content.trim(), elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/aigc/detect — AIGC 检测
// ============================================================
router.post('/aigc/detect', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model: modelName } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });

    const info = resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });
    if (!info) return res.status(400).json({ error: '请先在设置中配置 API Key，或在下方输入临时使用的 Key' });
    const provider = info.provider;
    const model = modelName || info.model;

    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 10);
    const paraText = paragraphs.map((p, i) => `【段落 ${i + 1}】\n${p.trim()}`).join('\n\n---\n\n');

    const systemPrompt = prompts.AIGC_DETECT_SYSTEM;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, paraText, 0.2, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        const parsed = parseJsonArray(result.content);
        res.write(`data: ${JSON.stringify({ type: 'complete', paragraphs: composeParagraphResults(paragraphs, parsed), parseError: parsed === null, usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const { parsed, result } = await llmJsonCall({
      provider, apiKey: info.apiKey, model, systemPrompt, text: paraText,
      temperature: 0.2, customEndpoint, userId: req.user.id, signal
    });
    if (parsed === null) {
      return res.json({ paragraphs: [], raw: result.content, parseError: true });
    }
    res.json({ paragraphs: composeParagraphResults(paragraphs, parsed), elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/aigc/rewrite — 降 AI 改写（纯文本输出）
// ============================================================
router.post('/aigc/rewrite', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model: modelName } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });

    const info = resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });
    if (!info) return res.status(400).json({ error: '请先在设置中配置 API Key，或在下方输入临时使用的 Key' });
    const provider = info.provider;
    const model = modelName || info.model;

    const systemPrompt = prompts.AIGC_REWRITE_SYSTEM;

    // LangChain 通道：本条路由经 langchainClient.textRequest 走
    // ChatPromptTemplate.pipe(ChatOpenAI) 的 LCEL 链（anthropic 或 DISABLE_LANGCHAIN=1 时自动回退原网关）
    const llmCall = (opts) => textRequest(provider, info.apiKey, model, systemPrompt, text, 0.5, customEndpoint, req.user.id, opts);

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmCall({
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        res.write(`data: ${JSON.stringify({ type: 'complete', rewritten: result.content.trim(), usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const result = await llmCall({ signal });
    res.json({ rewritten: result.content.trim(), elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
