/**
 * 琢言 · LangChain 通道（server/utils/langchainClient.js）单元测试
 *
 * 覆盖目标（全部用 mock fetch，不触网）：
 *   1. resolveBaseURL 的 Endpoint 优先级与去尾斜杠逻辑
 *   2. RunnableSequence（PromptTemplate.pipe(ChatOpenAI)）非流式调用：
 *      正确解析返回内容、usage_metadata → 网关统一 usage 结构
 *   3. 流式调用：SSE 增量正确聚合、onDelta 逐段回调
 *   4. anthropic（非 OpenAI 兼容协议）自动回退原网关 llmRequest
 *   5. DISABLE_LANGCHAIN=1 一键回退原生 fetch 通道
 */

/* global Response, beforeEach, afterAll */

jest.mock('../server/utils/llm', () => ({
  llmRequest: jest.fn(async () => ({ content: 'anthropic 网关输出', elapsed: 7, usage: { total_tokens: 3 } })),
  addLog: jest.fn()
}));

const { textRequest, resolveBaseURL } = require('../server/utils/langchainClient');
const { llmRequest } = require('../server/utils/llm');
const { PROVIDERS } = require('../server/providers');

// ---------- mock fetch：OpenAI 兼容的 HTTP 层 ----------
const realFetch = global.fetch;

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function sseResponse(lines) {
  const body = lines.map(l => `data: ${JSON.stringify(l)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

/** 模拟非流式 Chat Completion 响应 */
function completionPayload(content = '这是改写后的文本。') {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.6-plus',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  };
}

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockClear(); global.fetch = fetchMock; });
afterAll(() => { global.fetch = realFetch; });

describe('resolveBaseURL', () => {
  it('自定义 Endpoint 优先并去掉尾部斜杠', () => {
    expect(resolveBaseURL('qwen', 'https://my-gw.example.com/compatible-mode/v1/')).toBe('https://my-gw.example.com/compatible-mode/v1');
  });
  it('未传自定义 Endpoint 时使用供应商默认地址', () => {
    expect(resolveBaseURL('qwen')).toBe(PROVIDERS.qwen.baseUrl.replace(/\/$/, ''));
  });
});

describe('textRequest · LangChain RunnableSequence（非流式）', () => {
  it('invoke 链式调用成功并返回内容 + 网关统一 usage', async () => {
    fetchMock.mockResolvedValue(jsonResponse(completionPayload('优化后的中文学术文本。')));

    const out = await textRequest('qwen', 'sk-test', 'qwen3.6-plus', '系统提示', '待改写文本', 0.5, 'https://my-gw.example.com/compatible-mode/v1', 'u1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.content).toBe('优化后的中文学术文本。');
    expect(out.usage.total_tokens).toBe(15);
    expect(out.usage.prompt_tokens).toBe(10);

    // 请求打到了 baseURL 对应地址，且按 OpenAI 兼容协议带 system/human 消息
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://my-gw.example.com/compatible-mode/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen3.6-plus');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });
});

describe('textRequest · 流式（SSE）', () => {
  it('逐 chunk 聚合内容并回调 onDelta', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'qwen3.6-plus', choices: [{ index: 0, delta: { role: 'assistant', content: '改写后' }, finish_reason: null }] },
      { id: 'c2', object: 'chat.completion.chunk', created: 1, model: 'qwen3.6-plus', choices: [{ index: 0, delta: { content: '的文本' }, finish_reason: null }] },
      { id: 'c3', object: 'chat.completion.chunk', created: 1, model: 'qwen3.6-plus', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
    ]));

    const deltas = [];
    const out = await textRequest('qwen', 'sk-test', 'qwen3.6-plus', '系统提示', '待改写文本', 0.5, 'https://my-gw.example.com/compatible-mode/v1', 'u1', {
      stream: true,
      onDelta: (d) => deltas.push(d)
    });

    expect(out.content).toBe('改写后的文本');
    expect(deltas).toEqual(['改写后', '的文本']);
  });
});

describe('textRequest · 回退策略', () => {
  it('anthropic（非 OpenAI 协议）自动回退原网关', async () => {
    const out = await textRequest('anthropic', 'sk-ant-test', 'claude-haiku', '系统提示', '文本', 0.3, '', 'u1');
    expect(llmRequest).toHaveBeenCalled();
    expect(out.content).toBe('anthropic 网关输出');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('DISABLE_LANGCHAIN=1 时整体回退原生 fetch 通道', async () => {
    process.env.DISABLE_LANGCHAIN = '1';
    try {
      const out = await textRequest('qwen', 'sk-test', 'qwen3.6-plus', '系统提示', '文本', 0.3, 'https://x/v1', 'u1');
      expect(llmRequest).toHaveBeenCalled();
      expect(out.content).toBe('anthropic 网关输出');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.DISABLE_LANGCHAIN;
    }
  });
});
