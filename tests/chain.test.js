/**
 * 琢言 · Chain 流水线单元测试
 * 验证：顺序执行、上下文贯穿、required 中止、非 required 降级、进度回调
 */

const { Pipeline } = require('../server/agents/chain');

describe('Pipeline 链式流水线', () => {
  test('按声明顺序执行并返回每步产出', async () => {
    const order = [];
    const pipe = new Pipeline();
    pipe.add({ key: 'a', name: 'A', run: async () => { order.push('a'); return 1; } });
    pipe.add({ key: 'b', name: 'B', run: async () => { order.push('b'); return 2; } });

    const results = await pipe.run();
    expect(order).toEqual(['a', 'b']);
    expect(results.a).toEqual({ ok: true, value: 1 });
    expect(results.b).toEqual({ ok: true, value: 2 });
  });

  test('共享上下文 ctx 在步骤间贯穿（前序输出 = 后续输入）', async () => {
    const pipe = new Pipeline();
    pipe.add({
      key: 'structure', name: '结构分析',
      run: async (ctx) => { ctx.paperType = '研究论文'; return { sections: 5 }; }
    });
    pipe.add({
      key: 'report', name: '综合报告',
      run: async (ctx, results) => `${results.structure.value.sections} 节 · ${ctx.paperType}`
    });

    const results = await pipe.run({});
    expect(results.report.value).toBe('5 节 · 研究论文');
  });

  test('required 步骤失败立即中止链并抛出原错误', async () => {
    const pipe = new Pipeline();
    let ranAfter = false;
    pipe.add({
      key: 'must', name: '必需步骤', required: true,
      run: async () => { throw new Error('booom'); }
    });
    pipe.add({
      key: 'later', name: '后续步骤',
      run: async () => { ranAfter = true; return 1; }
    });

    await expect(pipe.run()).rejects.toThrow('booom');
    expect(ranAfter).toBe(false);
  });

  test('非 required 步骤失败降级记录，后续继续执行', async () => {
    const pipe = new Pipeline();
    pipe.add({
      key: 'soft', name: '可降级步骤',
      run: async () => { throw new Error('soft-fail'); }
    });
    pipe.add({ key: 'final', name: '收尾', run: async () => 'done' });

    const results = await pipe.run();
    expect(results.soft).toEqual({ ok: false, error: expect.any(Error) });
    expect(results.soft.error.message).toBe('soft-fail');
    expect(results.final).toEqual({ ok: true, value: 'done' });
  });

  test('进度回调按 (key, name, idx, total) 触发', async () => {
    const calls = [];
    const pipe = new Pipeline({
      onProgress: (key, name, idx, total) => calls.push({ key, name, idx, total })
    });
    pipe.add({ key: 'a', name: '甲', run: async () => 1 });
    pipe.add({ key: 'b', name: '乙', run: async () => 2 });

    await pipe.run();
    expect(calls).toEqual([
      { key: 'a', name: '甲', idx: 1, total: 2 },
      { key: 'b', name: '乙', idx: 2, total: 2 }
    ]);
  });

  test('add 支持链式调用', async () => {
    const pipe = new Pipeline().add({ key: 'x', run: async () => 1 }).add({ key: 'y', run: async () => 2 });
    const results = await pipe.run();
    expect(results.x.ok).toBe(true);
    expect(results.y.ok).toBe(true);
  });
});
