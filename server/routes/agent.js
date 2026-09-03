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
 * 全文智能分析 Agent（SSE 流式进度 + 客户端取消 + 配额「完成式消费」）：
 * 分析/生成过程不计费，分析成功完成后按「导入文本字数」计入每日额度（free）；
 * 路由通过 req.quotaNeeded 声明预计字数，quotaMiddleware 据此做剩余额度预检。
 */
router.post('/analyze',
  authMiddleware,
  // 声明完成式配额消耗：本次分析完成后将按导入文本字数入账
  (req, res, next) => {
    req.quotaNeeded = String((req.body && req.body.text) || '').length;
    next();
  },
  quotaMiddleware,
  apiLimiter,
  async (req, res) => {
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
