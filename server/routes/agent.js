/**
 * 琢言 · Agent 路由
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const quotaMiddleware = require('../middleware/quota');
const { apiLimiter } = require('../middleware/rateLimit');
const { llmRequest } = require('../utils/llm');
const { resolveProviderInfo } = require('../utils/providerResolver');
const logger = require('../utils/logger');
const { FullPaperAgent } = require('../agents/fullPaperAgent');

const router = express.Router();

/**
 * POST /api/agent/analyze
 * 全文智能分析 Agent（SSE 流式进度 + 客户端取消 + 仅审计真实 token，不按请求计费）
 */
router.post('/analyze', authMiddleware, quotaMiddleware, apiLimiter, async (req, res) => {
  try {
    const { text, customEndpoint, rawApiKey, model } = req.body;
    if (!text) return res.status(400).json({ error: '缺少文本' });
    if (text.length < 50) return res.status(400).json({ error: '文本过短，请输入至少 50 字的论文内容' });

    // 使用共享的 Provider 解析逻辑
    const providerInfo = () => resolveProviderInfo(req.user.id, { customEndpoint, rawApiKey });

    const agent = new FullPaperAgent({
      llmRequest,
      getProviderInfo: providerInfo,
      logger,
      _deps: { getProviderInfo: providerInfo }
    });

    // 客户端断开（刷新/取消）时 abort 内部 LLM 调用，避免服务端白跑
    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const analyzeOpts = {
      userId: req.user.id,
      customEndpoint,
      rawApiKey,
      model,
      signal: controller.signal
    };

    // 支持流式进度（SSE）
    const acceptSSE = req.headers.accept === 'text/event-stream';
    if (acceptSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      analyzeOpts.onProgress = (p) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...p })}\n\n`);
      };

      try {
        const result = await agent.analyze(text, analyzeOpts);
        res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
res.end();
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
      return;
    }

    const result = await agent.analyze(text, analyzeOpts);
res.json(result);
  } catch (err) {
    logger.error('Agent 分析失败', { error: err.message, userId: req.user?.id });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
