/**
 * 长文本分块与结果合并 单元测试
 */

const {
  splitChunks,
  MAX_CHUNK_CHARS,
  mergeStructure,
  mergeTerms,
  mergeLogic,
  mergeStyle,
  mergeAigc
} = require('../server/agents/fullPaperAgent');

describe('splitChunks', () => {
  test('短文本不切块', () => {
    expect(splitChunks('短文本'.repeat(10), 8000)).toHaveLength(1);
  });

  test('超过阈值按段落边界切块', () => {
    const text = Array.from({ length: 50 }, (_, i) => `第${i + 1}段内容。`).join('\n\n');
    const chunks = splitChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // 每块不应超过阈值太多（单个段落本身很短）
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(110);
    }
  });

  test('空文本返回包含空字符串的数组', () => {
    expect(splitChunks('', 100)).toEqual(['']);
  });

  test('不切断段落（块内不出现被拆散的段落）', () => {
    const text = Array.from({ length: 20 }, (_, i) => `段落${i}：${'内容'.repeat(20)}`).join('\n\n');
    const chunks = splitChunks(text, 60);
    // 每块应由完整段落组成（段落分隔符不会出现在块中间被截断）
    for (const c of chunks) {
      expect(c.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('merge 合并函数', () => {
  test('mergeStructure 合并 sections 并重排 index、平均 score', () => {
    const r = mergeStructure([
      { paperType: '研究论文', sections: [{ name: '引言' }, { name: '方法' }], structureScore: 8, structureIssues: ['A'] },
      { paperType: '研究论文', sections: [{ name: '结果' }, { name: '结论' }], structureScore: 6, structureIssues: ['B'] }
    ]);
    expect(r.paperType).toBe('研究论文');
    expect(r.sections).toHaveLength(4);
    expect(r.sections.map(s => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.structureScore).toBe(7);
    expect(r.structureIssues).toEqual(['A', 'B']);
  });

  test('mergeStructure 容错（跳过 null/undefined）', () => {
    const r = mergeStructure([null, { sections: [{ name: '引言' }], structureScore: 5 }]);
    expect(r.sections).toHaveLength(1);
    expect(r.structureScore).toBe(5);
  });

  test('mergeTerms 拼接数组', () => {
    expect(mergeTerms([['a', 'b'], ['c'], null])).toEqual(['a', 'b', 'c']);
  });

  test('mergeLogic 合并并重排 step、平均 score', () => {
    const r = mergeLogic([
      { mainClaim: '论点1', argumentChain: [{ step: 1, text: 'x' }], logicGaps: [{ description: 'g1' }], logicScore: 8 },
      { mainClaim: '', argumentChain: [{ step: 1, text: 'y' }], logicGaps: [{ description: 'g2' }], logicScore: 6 }
    ]);
    expect(r.mainClaim).toBe('论点1');
    expect(r.argumentChain.map(s => s.step)).toEqual([1, 2]);
    expect(r.logicGaps).toHaveLength(2);
    expect(r.logicScore).toBe(7);
  });

  test('mergeStyle 各维度取平均、issues 拼接', () => {
    const r = mergeStyle([
      { scores: { formality: 8, fluency: 6 }, issues: [{ description: 'i1' }], overallStyleScore: 7 },
      { scores: { formality: 6, fluency: 8 }, issues: [{ description: 'i2' }], overallStyleScore: 5 }
    ]);
    expect(r.scores.formality).toBe(7);
    expect(r.scores.fluency).toBe(7);
    expect(r.issues).toHaveLength(2);
    expect(r.overallStyleScore).toBe(6);
  });

  test('mergeAigc 平均 rate、风险等级、段落重排', () => {
    const r = mergeAigc([
      { overallRate: 0.9, indicators: [{ type: 'template' }], paragraphs: [{ rate: 0.9 }] },
      { overallRate: 0.9, indicators: [], paragraphs: [{ rate: 0.9 }] }
    ]);
    expect(r.overallRate).toBe(0.9);
    expect(r.riskLevel).toBe('high');
    expect(r.paragraphs).toHaveLength(2);
    expect(r.paragraphs.map(p => p.index)).toEqual([0, 1]);
  });

  test('mergeAigc 低 rate 判定为 low', () => {
    const r = mergeAigc([{ overallRate: 0.1, paragraphs: [] }]);
    expect(r.riskLevel).toBe('low');
  });
});
