/**
 * 琢言 · 全文智能分析 Agent
 *
 * 多步骤分析流程：
 *   1. 结构分析   → 识别论文段落结构与功能
 *   2. 术语一致性 → 发现术语不一致问题
 *   3. 逻辑连贯性 → 跨段落论证关系分析
 *   4. 风格评估   → 统一性、正式度、流畅度
 *   5. AIGC 风险  → 全文 AI 生成概率评估
 *   6. 综合报告   → 结构化建议 + 优先级排序
 *
 * 设计原则：
 *   - 步骤 1 必须先执行（后续步骤依赖结构信息）
 *   - 步骤 2-5 可并行执行
 *   - 步骤 6 依赖前面所有结果
 *   - 单步骤失败不中断整体流程，降级为跳过
 */

const logger = require('../utils/logger');
const { resolveProviderInfo } = require('../utils/providerResolver');
const { getUserProfile, saveUserProfile } = require('../db');
const prompts = require('../prompts');
const { Pipeline } = require('./chain');

// ============================================================
// Agent 步骤定义
// ============================================================
const STEPS = {
  structure: {
    name: '结构分析',
    description: '识别论文段落结构与功能定位',
    temperature: 0.2,
    systemPrompt: prompts.AGENT_STRUCTURE_SYSTEM,
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    }
  },

  terms: {
    name: '术语一致性',
    description: '发现术语不一致问题',
    temperature: 0.2,
    systemPrompt: prompts.AGENT_TERMS_SYSTEM,
    parse: (data) => {
      const match = data.match(/\[[\s\S]*\]/);
      if (!match) return [];
      try { return JSON.parse(match[0]); } catch { return []; }
    }
  },

  logic: {
    name: '逻辑连贯性',
    description: '跨段落论证关系分析',
    temperature: 0.3,
    systemPrompt: prompts.AGENT_LOGIC_SYSTEM,
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return { argumentChain: [], logicGaps: [], logicScore: 0 };
      try { return JSON.parse(match[0]); } catch { return { argumentChain: [], logicGaps: [], logicScore: 0 }; }
    }
  },

  style: {
    name: '风格评估',
    description: '统一性、正式度、流畅度',
    temperature: 0.3,
    systemPrompt: prompts.AGENT_STYLE_SYSTEM,
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return { scores: {}, issues: [], overallStyleScore: 0, summary: '' };
      try { return JSON.parse(match[0]); } catch { return { scores: {}, issues: [], overallStyleScore: 0, summary: '' }; }
    }
  },

  aigc: {
    name: 'AIGC 风险评估',
    description: '全文 AI 生成概率评估',
    temperature: 0.2,
    systemPrompt: prompts.AGENT_AIGC_SYSTEM,
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return { overallRate: 0, riskLevel: 'low', indicators: [], paragraphs: [] };
      try { return JSON.parse(match[0]); } catch { return { overallRate: 0, riskLevel: 'low', indicators: [], paragraphs: [] }; }
    }
  },

  diagnose: {
    name: '综合诊断',
    description: '一次完成术语/逻辑/风格/AIGC 四项诊断',
    temperature: 0.3,
    systemPrompt: prompts.AGENT_DIAGNOSE_SYSTEM,
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return { terms: [], logic: null, style: null, aigc: null };
      try {
        const obj = JSON.parse(match[0]);
        return {
          terms: Array.isArray(obj.terms) ? obj.terms : [],
          logic: obj.logic && typeof obj.logic === 'object' ? obj.logic : null,
          style: obj.style && typeof obj.style === 'object' ? obj.style : null,
          aigc: obj.aigc && typeof obj.aigc === 'object' ? obj.aigc : null
        };
      } catch {
        return { terms: [], logic: null, style: null, aigc: null };
      }
    }
  },

  report: {
    name: '综合报告生成',
    description: '汇总所有分析结果，生成结构化建议',
    temperature: 0.4,
    systemPrompt: null, // 动态生成
    parse: (data) => {
      const match = data.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    }
  }
};

// ============================================================
// 分数汇总辅助
// ============================================================
function calcOverallScore(analysis) {
  const scores = [];
  if (analysis.structure?.structureScore) scores.push(analysis.structure.structureScore);
  if (analysis.logic?.logicScore) scores.push(analysis.logic.logicScore);
  if (analysis.style?.overallStyleScore) scores.push(analysis.style.overallStyleScore);
  if (analysis.aigc) {
    // AIGC: 人类写作率越高分越高 → (1 - aiRate) * 10
    scores.push((1 - (analysis.aigc.overallRate || 0)) * 10);
  }
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
}

// ============================================================
// 全文智能分析 Agent
// ============================================================
class FullPaperAgent {
  constructor(deps) {
    this.llmRequest = deps.llmRequest;
    this.getProviderInfo = deps.getProviderInfo;
    this.logger = deps.logger || console;
    this._deps = deps._deps || { getProviderInfo: deps.getProviderInfo };
  }

  /**
   * 执行单个分析步骤
   */
  async executeStep(stepKey, paperText, extraContext = '') {
    const step = STEPS[stepKey];
    if (!step) throw new Error('未知步骤: ' + stepKey);

    const info = this._currentProviderInfo;
    if (!info) throw new Error('请先在设置中配置 API Key，或在下方输入临时使用的 Key');

    const userText = extraContext
      ? `【前序分析结果】\n${extraContext}\n\n【论文全文】\n${paperText}`
      : paperText;

    const systemPrompt = stepKey === 'report'
      ? this.buildReportPrompt(extraContext)
      : this._injectProfile(step.systemPrompt);

    this.logger.debug(`Agent 步骤: ${step.name}`, { model: info.model });

    const result = await this.llmRequest(
      info.provider, info.apiKey, info.model,
      systemPrompt, userText, step.temperature, info.customEndpoint, info.userId,
      this._signal ? { signal: this._signal } : {}
    );

    let parsed;
    try {
      parsed = step.parse(result.content);
    } catch (e) {
      this.logger.warn(`Agent 步骤 ${step.name} 解析失败`, { error: e.message });
      parsed = null;
    }

    return {
      step: stepKey,
      name: step.name,
      data: parsed,
      raw: result.content,
      elapsed: result.elapsed,
      usage: result.usage,
      success: parsed !== null
    };
  }

  /**
   * 把用户画像注入到系统提示（个性化分析）
   */
  _injectProfile(prompt) {
    if (!this._userProfile) return prompt;
    let hint = this._userProfile;
    try {
      const p = JSON.parse(this._userProfile);
      const parts = [];
      if (p.paperTypes && p.paperTypes.length) parts.push('论文类型：' + p.paperTypes.join('、'));
      const issues = (p.commonIssues || []).map(c => c.name + '（' + c.count + '次）').join('、');
      if (issues) parts.push('常见问题：' + issues);
      if (parts.length) hint = parts.join('；') + '。';
    } catch (e) {}
    return `【用户画像】${hint}\n\n${prompt}`;
  }

  /**
   * 分析完成后，用规则从结果中提取用户画像要点并保存（跨文档记忆）
   */
  _saveProfile(analysis, userId) {
    try {
      if (!userId) return;
      let old;
      try { old = JSON.parse(getUserProfile(userId) || '{}'); } catch (e) { old = {}; }
      if (!old.paperTypes) old.paperTypes = [];
      if (!old.commonIssues) old.commonIssues = [];
      if (!old.count) old.count = 0;

      const pt = analysis.structure?.paperType;
      if (pt && !old.paperTypes.includes(pt)) {
        old.paperTypes.push(pt);
        if (old.paperTypes.length > 5) old.paperTypes.shift();
      }

      const issues = [];
      if (Array.isArray(analysis.terms) && analysis.terms.length) issues.push('术语不一致');
      if (analysis.logic?.logicGaps?.length) issues.push('逻辑断层');
      if (analysis.style?.issues?.length) issues.push('风格问题');
      if (analysis.aigc && analysis.aigc.overallRate > 0.7) issues.push('AI 痕迹明显');
      for (const name of issues) {
        const found = old.commonIssues.find(c => c.name === name);
        if (found) found.count = (found.count || 0) + 1;
        else old.commonIssues.push({ name, count: 1 });
      }
      if (old.commonIssues.length > 8) old.commonIssues = old.commonIssues.slice(-8);

      old.count += 1;
      saveUserProfile(userId, JSON.stringify(old));
    } catch (e) {
      logger.warn('保存用户画像失败', { error: e.message });
    }
  }

  /**
   * 构建综合报告的 prompt（委托给提示词模板库，注入各维度分析结果 JSON）
   */
  buildReportPrompt(analysisJson) {
    return prompts.AGENT_REPORT_SYSTEM(analysisJson);
  }

  /**
   * 主分析入口
   * @param {string} paperText - 论文全文
   * @param {object} options - { userId, customEndpoint, rawApiKey, model, onProgress }
   * @returns {object} 完整分析报告
   */
  async analyze(paperText, options = {}) {
    const { userId, customEndpoint, rawApiKey, model, signal } = options;

    // 预先解析 Provider 信息（避免在每一步重复调用）
    this._currentProviderInfo = null;
    const resolved = resolveProviderInfo(userId, { customEndpoint, rawApiKey });
    if (!resolved) {
      throw new Error('请先在设置中配置 API Key，或在输入框中填入临时使用的 Key');
    }
    this._currentProviderInfo = { ...resolved, model };

    // 读取用户画像（跨文档记忆），注入到后续分析步骤
    this._userProfile = getUserProfile(userId);
    this._signal = signal || null;
    this._reflectTokens = 0;

    // 长文本分块：超过阈值则走 Map-Reduce 分块分析，否则单次全文分析
    const chunks = splitChunks(paperText, MAX_CHUNK_CHARS);
    if (chunks.length <= 1) {
      return this._analyzeSingle(paperText, options);
    }
    return this._analyzeChunked(chunks, options);
  }

  /**
   * 单次全文分析（未分块）
   *
   * 以 Chain（Pipeline）驱动三步流水线，步骤定义即流程文档：
   *   1. structure（required）→ 产出段落结构，写入共享上下文 ctx
   *   2. diagnose            → 消费结构信息，产出术语/逻辑/风格/AIGC 四维诊断
   *   3. report              → 消费全部前序结果，产出综合报告
   * 链后处理：反思循环（Critic→Revise）、总分计算、用户画像持久化
   */
  async _analyzeSingle(paperText, options = {}) {
    const { userId, onProgress } = options;

    const analysis = {};
    const ctx = { paperText, analysis };

    const pipeline = new Pipeline({
      logger: this.logger,
      onProgress: (step, name, idx, total) => {
        if (onProgress) onProgress({ step, total, name });
      }
    });

    // 步骤 1：结构分析（后续步骤依赖其结果，失败则整体终止）
    pipeline.add({
      key: 'structure', name: '结构分析', required: true,
      run: async (c) => {
        const r = await this._safeStep('structure', c.paperText);
        if (!r.success) {
          throw new Error('分析失败（结构分析）：' + (r.error || '未知错误'));
        }
        c.analysis.structure = r.data || {};
        c.structContext = JSON.stringify({
          paperType: c.analysis.structure.paperType,
          sections: c.analysis.structure.sections
        });
        return r;
      }
    });

    // 步骤 2：综合诊断（术语/逻辑/风格/AIGC 一次完成，失败降级为空结果不中断）
    pipeline.add({
      key: 'diagnose', name: '综合诊断',
      run: async (c) => {
        const r = await this._safeStep('diagnose', c.paperText, c.structContext);
        const d = r.data || {};
        c.analysis.terms = d.terms || [];
        c.analysis.logic = d.logic || null;
        c.analysis.style = d.style || null;
        c.analysis.aigc = d.aigc || null;
        return r;
      }
    });

    // 步骤 3：综合报告（消费前序全部结果）
    pipeline.add({
      key: 'report', name: '综合报告生成',
      run: async (c) => {
        const r = await this._safeStep('report', c.paperText, JSON.stringify(c.analysis, null, 2));
        c.analysis.report = this._parseReport(r);
        return r;
      }
    });

    const results = await pipeline.run(ctx);
    const steps = [
      results.structure.value,
      results.diagnose.value,
      results.report.value
    ];

    // 反思循环：审稿人自评 → 改进（失败则保留原报告）
    const revisedReport = await this._reflectAndRevise(analysis);
    if (revisedReport) analysis.report = revisedReport;

    // ---------- 计算总分 ----------
    analysis.overallScore = calcOverallScore(analysis);

    // 保存用户画像（跨文档记忆）
    this._saveProfile(analysis, userId);

    this.logger.info('Agent 全文分析完成', {
      userId,
      overallScore: analysis.overallScore,
      steps: steps.map(s => s.success)
    });

    return {
      success: true,
      overallScore: analysis.overallScore,
      analysis,
      chunked: false,
      totalTokens: steps.reduce((sum, s) => sum + (s.usage?.total_tokens || 0), 0) + (this._reflectTokens || 0),
      steps: steps.map(s => ({
        step: s.step,
        name: s.name,
        success: s.success,
        elapsed: s.elapsed
      })),
      totalElapsed: steps.reduce((sum, s) => sum + (s.elapsed || 0), 0)
    };
  }

  /**
   * 分块 Map-Reduce 分析（长文本）
   * 每块独立分析，结果按步骤类型合并，最后统一生成综合报告
   */
  async _analyzeChunked(chunks, options = {}) {
    const { userId, onProgress } = options;
    const total = chunks.length;
    const notify = (step, name, chunk, chunkTotal) => {
      if (onProgress) onProgress({ step, total: chunkTotal, name, chunk, chunkTotal });
    };

    let totalTokens = 0;

    // ---------- 1. 结构分析：逐块识别，合并 ----------
    const structDatas = [];
    for (let i = 0; i < total; i++) {
      notify('structure', '结构分析', i + 1, total);
      const r = await this._safeStep('structure', chunks[i]);
      if (!r.success) {
        throw new Error('分析失败（结构分析·第 ' + (i + 1) + ' 块）：' + (r.error || '未知错误'));
      }
      totalTokens += r.usage?.total_tokens || 0;
      structDatas.push(r.data);
    }
    const structure = mergeStructure(structDatas);
    const structContext = JSON.stringify({ paperType: structure.paperType, sections: structure.sections });

    // ---------- 2. 综合诊断：逐块分析，合并 ----------
    const datas = { terms: [], logic: [], style: [], aigc: [] };
    for (let i = 0; i < total; i++) {
      notify('diagnose', '综合诊断', i + 1, total);
      const r = await this._safeStep('diagnose', chunks[i], structContext);
      totalTokens += r.usage?.total_tokens || 0;
      const d = r.data || {};
      datas.terms.push(d.terms || []);
      datas.logic.push(d.logic);
      datas.style.push(d.style);
      datas.aigc.push(d.aigc);
    }

    const analysis = {
      structure,
      terms: mergeTerms(datas.terms),
      logic: mergeLogic(datas.logic),
      style: mergeStyle(datas.style),
      aigc: mergeAigc(datas.aigc)
    };

    // ---------- 3. 综合报告（基于合并结果，不再重复发送全文） ----------
    notify('report', '综合报告生成', 1, 1);
    const reportResult = await this._safeStep('report', '', JSON.stringify(analysis, null, 2));
    totalTokens += reportResult.usage?.total_tokens || 0;
    analysis.report = this._parseReport(reportResult);
    const revisedReport = await this._reflectAndRevise(analysis);
    if (revisedReport) analysis.report = revisedReport;
    analysis.overallScore = calcOverallScore(analysis);

    this._saveProfile(analysis, userId);

    this.logger.info('Agent 全文分析完成（分块）', { userId, overallScore: analysis.overallScore, chunks: total });

    return {
      success: true,
      overallScore: analysis.overallScore,
      analysis,
      chunked: true,
      chunkCount: total,
      totalTokens: totalTokens + (this._reflectTokens || 0),
      steps: [
        { step: 'structure', name: '结构分析', success: true, elapsed: 0 },
        { step: 'diagnose', name: '综合诊断', success: true, elapsed: 0 },
        { step: 'report', name: '综合报告生成', success: !!analysis.report, elapsed: 0 }
      ],
      totalElapsed: 0
    };
  }

  /**
   * 反思循环：让 LLM 以审稿人身份审阅报告，再据意见改进
   * 失败时返回 null（保留原报告），不中断主流程
   */
  async _reflectAndRevise(analysis) {
    const info = this._currentProviderInfo;
    if (!info || !analysis.report) return null;

    const reportText = JSON.stringify(analysis.report, null, 2);
    try {
      const critique = await this.llmRequest(
        info.provider, info.apiKey, info.model,
        prompts.REFLECT_CRITIQUE_SYSTEM,
        `请审阅下面这份学术论文分析报告，指出其中的不足、错误与遗漏：\n\n${reportText}`,
        0.3, info.customEndpoint, info.userId,
        this._signal ? { signal: this._signal } : {}
      );
      this._reflectTokens += critique.usage?.total_tokens || 0;

      const revised = await this.llmRequest(
        info.provider, info.apiKey, info.model,
        prompts.REFLECT_REVISE_SYSTEM,
        `下面是一份分析报告和审稿人的批评意见，请据意见改进报告，保持与原报告相同的 JSON 结构：\n\n【原报告】\n${reportText}\n\n【审稿人意见】\n${critique.content}`,
        0.4, info.customEndpoint, info.userId,
        this._signal ? { signal: this._signal } : {}
      );
      this._reflectTokens += revised.usage?.total_tokens || 0;

      const parsed = this._parseReport({ data: null, raw: revised.content });
      if (parsed) {
        this.logger.info('反思循环完成，报告已改进');
        return parsed;
      }
      return null;
    } catch (e) {
      this.logger.warn('反思循环失败，保留原报告', { error: e.message });
      return null;
    }
  }

  /**
   * 安全执行步骤（失败返回 null 而非抛出）
   */
  async _safeStep(stepKey, paperText, extraContext = '') {
    try {
      return await this.executeStep(stepKey, paperText, extraContext);
    } catch (e) {
      this.logger.warn(`Agent 步骤 ${STEPS[stepKey]?.name || stepKey} 失败`, { error: e.message });
      return {
        step: stepKey,
        name: STEPS[stepKey]?.name || stepKey,
        data: null,
        raw: '',
        elapsed: 0,
        usage: {},
        success: false,
        error: e.message
      };
    }
  }

  _unwrap(settledResult) {
    if (settledResult.status === 'fulfilled') {
      return settledResult.value?.data || null;
    }
    return null;
  }

  _parseReport(reportResult) {
    if (!reportResult.data) {
      // 降级：从 raw 中解析
      const match = reportResult.raw?.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { return null; }
      }
      return null;
    }
    return reportResult.data;
  }
}

// ============================================================
// 长文本分块与结果合并（Map-Reduce 辅助）
// ============================================================

// 单块最大字符数（4000 字，控制单次 token 峰值与输出质量）
const MAX_CHUNK_CHARS = 4000;

/**
 * 按段落边界切分文本，尽量接近 maxSize 且不切断段落
 */
function splitChunks(text, maxSize) {
  const safe = text || '';
  if (safe.length <= maxSize) return [safe];
  const paragraphs = safe.split(/\n\s*\n/);
  const chunks = [];
  let cur = '';
  for (const p of paragraphs) {
    const seg = p.trim();
    if (!seg) continue;
    if (cur && cur.length + seg.length + 2 > maxSize) {
      chunks.push(cur);
      cur = seg;
    } else {
      cur = cur ? cur + '\n\n' + seg : seg;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [safe];
}

function mergeStructure(datas) {
  const sections = [];
  let paperType = '';
  let totalParagraphs = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  const issues = [];
  for (const d of datas) {
    if (!d) continue;
    if (!paperType && d.paperType) paperType = d.paperType;
    totalParagraphs += d.totalParagraphs || (Array.isArray(d.sections) ? d.sections.length : 0);
    if (typeof d.structureScore === 'number') { scoreSum += d.structureScore; scoreCount++; }
    if (Array.isArray(d.structureIssues)) issues.push(...d.structureIssues);
    if (Array.isArray(d.sections)) {
      for (const s of d.sections) {
        sections.push({ ...s, index: sections.length });
      }
    }
  }
  return {
    paperType,
    totalParagraphs,
    sections,
    structureScore: scoreCount ? Math.round(scoreSum / scoreCount) : 0,
    structureIssues: issues
  };
}

function mergeTerms(datas) {
  const arr = [];
  for (const d of datas) {
    if (Array.isArray(d)) arr.push(...d);
  }
  return arr;
}

function mergeLogic(datas) {
  let mainClaim = '';
  const argumentChain = [];
  const logicGaps = [];
  let scoreSum = 0;
  let scoreCount = 0;
  for (const d of datas) {
    if (!d) continue;
    if (!mainClaim && d.mainClaim) mainClaim = d.mainClaim;
    if (Array.isArray(d.argumentChain)) {
      for (const step of d.argumentChain) {
        argumentChain.push({ ...step, step: argumentChain.length + 1 });
      }
    }
    if (Array.isArray(d.logicGaps)) logicGaps.push(...d.logicGaps);
    if (typeof d.logicScore === 'number') { scoreSum += d.logicScore; scoreCount++; }
  }
  return {
    mainClaim,
    argumentChain,
    logicGaps,
    logicScore: scoreCount ? Math.round(scoreSum / scoreCount) : 0
  };
}

function mergeStyle(datas) {
  const scores = { formality: 0, consistency: 0, fluency: 0, conciseness: 0, objectivity: 0 };
  const scoreCounts = {};
  const issues = [];
  let overallSum = 0;
  let overallCount = 0;
  for (const d of datas) {
    if (!d) continue;
    if (d.scores) {
      for (const k of Object.keys(scores)) {
        if (typeof d.scores[k] === 'number') {
          scores[k] += d.scores[k];
          scoreCounts[k] = (scoreCounts[k] || 0) + 1;
        }
      }
    }
    if (Array.isArray(d.issues)) issues.push(...d.issues);
    if (typeof d.overallStyleScore === 'number') { overallSum += d.overallStyleScore; overallCount++; }
  }
  for (const k of Object.keys(scores)) {
    scores[k] = scoreCounts[k] ? Math.round((scores[k] / scoreCounts[k]) * 10) / 10 : 0;
  }
  return {
    scores,
    issues,
    overallStyleScore: overallCount ? Math.round((overallSum / overallCount) * 10) / 10 : 0,
    summary: ''
  };
}

function mergeAigc(datas) {
  const paragraphs = [];
  const indicators = [];
  let rateSum = 0;
  let rateCount = 0;
  for (const d of datas) {
    if (!d) continue;
    if (typeof d.overallRate === 'number') { rateSum += d.overallRate; rateCount++; }
    if (Array.isArray(d.indicators)) indicators.push(...d.indicators);
    if (Array.isArray(d.paragraphs)) {
      for (const p of d.paragraphs) {
        paragraphs.push({ ...p, index: paragraphs.length });
      }
    }
  }
  const overallRate = rateCount ? Math.round((rateSum / rateCount) * 100) / 100 : 0;
  const riskLevel = overallRate > 0.7 ? 'high' : overallRate > 0.5 ? 'medium' : 'low';
  return { overallRate, riskLevel, indicators, paragraphs };
}

module.exports = { FullPaperAgent, STEPS, calcOverallScore, splitChunks, MAX_CHUNK_CHARS, mergeStructure, mergeTerms, mergeLogic, mergeStyle, mergeAigc };
