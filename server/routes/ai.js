/**
 * 琢言 · AI 功能路由（润色、逻辑、AIGC）
 *
 * v2：所有接口支持 SSE 流式输出（Accept: text/event-stream）、
 *     客户端取消（AbortController 链路）、JSON response_format + 解析失败重试、
 *     按真实 token 扣配额（llm_calls 审计）
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const quotaMiddleware = require('../middleware/quota');
const { consumeQuota } = require('../middleware/quota');
const { apiLimiter } = require('../middleware/rateLimit');
const { llmRequest } = require('../utils/llm');
const { resolveProviderInfo } = require('../utils/provider');
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
    const prompt = extra
      ? `${systemPrompt}\n\n【注意】你上一次的输出不是合法 JSON（参考输出开头：${extra.slice(0, 200)}）。请务必只输出一个合法的 JSON 数组，不要包含任何其他文字或解释。`
      : systemPrompt;
    return llmRequest(provider, apiKey, model, prompt, text, temperature, customEndpoint, userId, {
      responseFormat: { type: 'json_object' },
      signal
    });
  };

  let result = await attempt(null);
  let parsed = parseJsonArray(result.content);
  if (parsed === null) {
    logger.warn('JSON 解析失败，自动带错重试一次', { provider, model });
    result = await attempt(result.content.slice(0, 200));
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

    const systemPrompt = `你是一位中文学术写作专家。分析用户输入的中文学术文本，找出以下四类问题：
1. 语法错误（搭配不当、成分残缺、句式杂糅）
2. 清晰度问题（口语化、冗余、模糊表达）
3. 术语不一致（同一概念多种表述）
4. 写作风格问题（不够正式、不够简洁）

请返回 JSON 格式的数组（不要包含任何其他文字），每项包含：
{
  "id": "s_序号",
  "type": "grammar | clarity | term | style",
  "typeName": "语法 | 清晰度 | 术语 | 风格",
  "severity": "高 | 中 | 低",
  "old": "原文片段",
  "new": "建议修改的文本",
  "reason": "修改理由（引用学术规范或语法规则）",
  "anchor": "原文中用于定位的片段（必须在原文中存在，用于高亮定位）"
}

注意：
- 如果不确定问题类型，优先使用 clarity
- anchor 必须是原文中原文中存在的连续字符串
- 如果文本没有明显问题，返回空数组 []
- severity 高/中/低 分别对应 严重/中等/轻微`;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.2, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
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
    consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
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

    const systemPrompt = `你是一位学术写作逻辑分析专家。分析用户输入的学术文本的论证结构。

请返回 JSON 格式的数组（不要包含任何其他文字），每项代表一个论证节点：
{
  "id": "n_序号",
  "type": "claim | evidence | conclusion | transition",
  "typeName": "论点 | 论据 | 结论 | 过渡",
  "text": "节点内容的简要概括（20-60字）",
  "level": 1-3,
  "warning": null 或 "对逻辑问题的具体描述",
  "paraIdx": 0
}

规则：
- 论点(claim): 作者提出的核心主张 level=1
- 论据(evidence): 支持论点的证据/数据/推理 level=2
- 结论(conclusion): 从论据推导出的结论 level=2
- 过渡(transition): 上下文衔接段落 level=1或2
- warning: 仅在发现逻辑断层、衔接生硬、论据不足时填写
- paraIdx: 对应原文的段落序号（从0开始）

如果文本不适合做逻辑分析，返回包含一条说明的数组。`;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.3, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
        const nodes = parseJsonArray(result.content) || [];
        res.write(`data: ${JSON.stringify({ type: 'complete', nodes, usage: result.usage || {} })}\n\n`);
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
    consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
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

    const systemPrompt = `你是一位学术写作与逻辑优化专家。用户会给你一段学术文本，你需要重构其论证结构，使其逻辑更清晰、更有说服力。

要求：
1. 识别原文的核心论点和论据
2. 按「论点 → 论据支撑 → 结论」的框架重新组织
3. 补充过渡句和逻辑连接词，消除逻辑跳跃
4. 保留所有原文的核心观点、专业术语和数据
5. 不要添加原文没有的新观点或数据

输出格式：直接返回优化后的完整文本（纯文本，不要任何JSON包装）。使用【核心论点】【论据支撑】【改进方案】【结论】等标题来标示各部分。

注意：输出必须是纯文本，不要包含JSON标记或代码块。`;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.4, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
        res.write(`data: ${JSON.stringify({ type: 'complete', optimized: result.content.trim(), usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.4, customEndpoint, req.user.id, { signal });
    consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
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

    const systemPrompt = `你是一位 AIGC 文本检测专家。逐段评估以下文本的 AI 生成概率。

请返回 JSON 格式的数组（不要包含任何其他文字），数组长度必须等于段落数：
{
  "text": "段落原文（完整原文，不要截断）",
  "aiRate": 0.0-1.0
}

评分标准：
- 0.0-0.3: 极可能是人类写作（语言灵活、有个人风格、存在合理的不完美）
- 0.3-0.5: 可能是人类写作（某些部分有模板痕迹）
- 0.5-0.7: 可能由 AI 辅助生成（结构规整、语言模板化）
- 0.7-1.0: 极可能是 AI 生成（高度模板化、缺乏个人风格）

注意：aiRate 必须是一个 0-1 之间的小数，保留两位小数。`;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, paraText, 0.2, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
        const paragraphs_result = parseJsonArray(result.content) || [];
        res.write(`data: ${JSON.stringify({ type: 'complete', paragraphs: paragraphs_result, usage: result.usage || {} })}\n\n`);
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
    consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
    if (parsed === null) {
      return res.json({ paragraphs: [], raw: result.content, parseError: true });
    }
    res.json({ paragraphs: parsed, elapsed: result.elapsed, usage: result.usage });
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

    const systemPrompt = `你是一位学术写作专家。将以下文本改写得更像人类写作，同时严格遵循以下要求：

1. 保留所有学术术语和专业概念不变
2. 保留原文的核心观点和论证逻辑
3. 使语言更自然、句式更多样化
4. 适当调整句式结构，避免模板化表达
5. 保持学术写作的正式风格
6. 不要添加原文没有的新信息
7. 改写后的篇幅应与原文相近

直接返回改写后的文本，不要包含任何其他说明或格式。`;

    const signal = makeAbortSignal(req, res);
    const acceptSSE = req.headers.accept === 'text/event-stream';

    if (acceptSSE) {
      startSSE(res);
      try {
        const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.5, customEndpoint, req.user.id, {
          stream: true, signal,
          onDelta: (d) => res.write(`data: ${JSON.stringify({ type: 'delta', content: d })}\n\n`)
        });
        consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
        res.write(`data: ${JSON.stringify({ type: 'complete', rewritten: result.content.trim(), usage: result.usage || {} })}\n\n`);
        res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const result = await llmRequest(provider, info.apiKey, model, systemPrompt, text, 0.5, customEndpoint, req.user.id, { signal });
    consumeQuota(req.user.id, result.usage?.total_tokens || text.length);
    res.json({ rewritten: result.content.trim(), elapsed: result.elapsed, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
