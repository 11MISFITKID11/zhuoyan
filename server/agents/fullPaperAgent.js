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
const { resolveProviderInfo } = require('../utils/provider');
const { getUserProfile, saveUserProfile } = require('../db');

// ============================================================
// Agent 步骤定义
// ============================================================
const STEPS = {
  structure: {
    name: '结构分析',
    description: '识别论文段落结构与功能定位',
    temperature: 0.2,
    systemPrompt: `你是一位学术论文结构分析专家。分析用户输入的学术论文，识别其段落结构与功能。

请返回 JSON 格式（不要包含任何其他文字）：
{
  "paperType": "论文类型（如：研究论文、综述、实验报告、案例分析等）",
  "totalParagraphs": 段落总数,
  "sections": [
    {
      "index": 0,
      "name": "段落功能名称（如：引言、方法、结果、讨论、结论等）",
      "range": "第X-Y段",
      "summary": "该部分内容摘要（30-60字）",
      "function": "claim | evidence | method | result | discussion | conclusion | transition | background"
    }
  ],
  "structureScore": 1-10,
  "structureIssues": ["结构问题描述"]
}

注意：structureScore 为 1-10 的整数，10 表示结构完美。`,
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
    systemPrompt: `你是一位学术术语专家。分析用户输入的学术论文，检查术语使用的一致性。

请返回 JSON 格式的数组（不要包含任何其他文字），每项代表一个术语一致性问题：
{
  "concept": "核心概念（如：机器学习）",
  "variants": ["文中出现的不同表述", "..."],
  "recommended": "建议统一使用的术语",
  "occurrences": 出现次数,
  "severity": "高 | 中 | 低",
  "locations": ["第X段", "..."]
}

如果没有术语一致性问题，返回空数组 []。`,
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
    systemPrompt: `你是一位学术论文逻辑分析专家。分析用户输入的学术论文的论证结构与逻辑连贯性。

请返回 JSON 格式（不要包含任何其他文字）：
{
  "mainClaim": "论文的核心论点（20-50字）",
  "argumentChain": [
    {
      "step": 1,
      "type": "claim | evidence | reasoning | counter | conclusion",
      "text": "论证步骤摘要（20-50字）",
      "paraIdx": 0,
      "supported": true | false
    }
  ],
  "logicGaps": [
    {
      "description": "逻辑断层描述",
      "location": "第X段→第Y段",
      "severity": "高 | 中 | 低",
      "suggestion": "改进建议"
    }
  ],
  "logicScore": 1-10
}

注意：logicScore 为 1-10 的整数。如果没有逻辑断层，logicGaps 为空数组。`,
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
    systemPrompt: `你是一位学术写作风格评估专家。分析用户输入的学术论文的写作风格。

请返回 JSON 格式（不要包含任何其他文字）：
{
  "scores": {
    "formality": 1-10,
    "consistency": 1-10,
    "fluency": 1-10,
    "conciseness": 1-10,
    "objectivity": 1-10
  },
  "issues": [
    {
      "category": "formality | consistency | fluency | conciseness | objectivity",
      "description": "问题描述",
      "example": "原文示例片段",
      "suggestion": "改进建议"
    }
  ],
  "overallStyleScore": 1-10,
  "summary": "风格总体评价（50-100字）"
}

注意：所有分数为 1-10 的整数。`,
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
    systemPrompt: `你是一位 AIGC 文本检测专家。评估以下学术论文的 AI 生成概率。

请返回 JSON 格式（不要包含任何其他文字）：
{
  "overallRate": 0.0-1.0,
  "riskLevel": "low | medium | high",
  "indicators": [
    {
      "type": "template | redundancy | uniformity | lack_citation | passive_voice",
      "description": "AI 生成特征描述",
      "example": "原文示例"
    }
  ],
  "paragraphs": [
    {
      "index": 0,
      "rate": 0.0-1.0,
      "reason": "该段落评分理由（20-50字）"
    }
  ]
}

评分标准：
- 0.0-0.3: 极可能是人类写作
- 0.3-0.5: 可能是人类写作
- 0.5-0.7: 可能由 AI 辅助
- 0.7-1.0: 极可能是 AI 生成`,
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
    systemPrompt: `你是一位学术写作诊断专家。对输入的学术论文进行四项诊断：术语一致性、逻辑连贯性、写作风格、AIGC 生成痕迹。

请返回 JSON 格式（不要包含任何其他文字），整体结构：
{
  "terms": [ ... ],
  "logic": { ... },
  "style": { ... },
  "aigc": { ... }
}

【terms】术语一致性 — 数组，每项：{ "concept": "核心概念", "variants": ["文中不同表述"], "recommended": "建议统一术语", "occurrences": 出现次数, "severity": "高|中|低", "locations": ["第X段"] }。无问题返回 []。

【logic】逻辑连贯性 — 对象：{ "mainClaim": "核心论点（20-50字）", "argumentChain": [{ "step": 1, "type": "claim|evidence|reasoning|counter|conclusion", "text": "步骤摘要（20-50字）", "paraIdx": 0, "supported": true }], "logicGaps": [{ "description": "断层描述", "location": "第X段→第Y段", "severity": "高|中|低", "suggestion": "改进建议" }], "logicScore": 1-10 }。无断层时 logicGaps 为 []。

【style】写作风格 — 对象：{ "scores": { "formality": 1-10, "consistency": 1-10, "fluency": 1-10, "conciseness": 1-10, "objectivity": 1-10 }, "issues": [{ "category": "formality|consistency|fluency|conciseness|objectivity", "description": "问题描述", "example": "原文示例", "suggestion": "改进建议" }], "overallStyleScore": 1-10, "summary": "风格总体评价（50-100字）" }。

【aigc】AIGC 生成痕迹 — 对象：{ "overallRate": 0.0-1.0, "riskLevel": "low|medium|high", "indicators": [{ "type": "template|redundancy|uniformity|lack_citation|passive_voice", "description": "AI 特征描述", "example": "原文示例" }], "paragraphs": [{ "index": 0, "rate": 0.0-1.0, "reason": "评分理由（20-50字）" }] }。

注意：
- 所有分数为 1-10 整数，AIGC 概率为 0-1 小数
- 某方面没有问题，对应数组返回 []`,
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
   * 构建综合报告的 prompt
   */
  buildReportPrompt(analysis) {
    return `你是一位学术写作综合评估专家。根据以下各维度分析结果，生成一份结构化的综合报告。

请返回 JSON 格式（不要包含任何其他文字）：
{
  "overallScore": 1-100,
  "summary": "总体评价（100-200字）",
  "strengths": ["论文优点1", "优点2", "..."],
  "weaknesses": ["论文不足1", "不足2", "..."],
  "recommendations": [
    {
      "priority": "高 | 中 | 低",
      "category": "structure | terms | logic | style | aigc",
      "title": "建议标题",
      "description": "具体建议描述",
      "impact": "改进后预期效果"
    }
  ],
  "actionPlan": [
    {
      "step": 1,
      "action": "行动步骤描述",
      "tool": "建议使用的琢言工具（polish | logic | aigc | rewrite）"
    }
  ]
}

以下是各维度分析结果：

【结构分析】
${JSON.stringify(analysis.structure, null, 2)}

【术语一致性】
${JSON.stringify(analysis.terms, null, 2)}

【逻辑连贯性】
${JSON.stringify(analysis.logic, null, 2)}

【风格评估】
${JSON.stringify(analysis.style, null, 2)}

【AIGC 风险评估】
${JSON.stringify(analysis.aigc, null, 2)}

请基于以上结果综合判断，给出整体评分（1-100）、优缺点、优先改进建议和行动计划。`;
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
   * 单次全文分析（原文逻辑，未分块）
   */
  async _analyzeSingle(paperText, options = {}) {
    const { userId, onProgress } = options;

    const analysis = {};
    const steps = [];

    // ---------- 步骤 1：结构分析（必须先执行）----------
    const progress = (step, total) => {
      if (onProgress) onProgress({ step, total, name: STEPS[step]?.name || step });
    };

    progress('structure', 3);
    const structResult = await this._safeStep('structure', paperText);
    if (!structResult.success) {
      // 结构分析是后续步骤的基础，失败则整体终止并返回真实原因
      const reason = structResult.error || '未知错误';
      logger.warn('Agent 结构分析失败，终止流程', { reason });
      throw new Error('分析失败（结构分析）：' + reason);
    }
    analysis.structure = structResult.data || {};
    steps.push(structResult);

    const structContext = JSON.stringify({
      paperType: analysis.structure.paperType,
      sections: analysis.structure.sections
    });

    // ---------- 步骤 2：综合诊断（术语/逻辑/风格/AIGC 一次完成）----------
    progress('diagnose', 3);
    const diagResult = await this._safeStep('diagnose', paperText, structContext);
    const diag = diagResult.data || {};
    analysis.terms = diag.terms || [];
    analysis.logic = diag.logic || null;
    analysis.style = diag.style || null;
    analysis.aigc = diag.aigc || null;
    steps.push(diagResult);

    // ---------- 步骤 3：综合报告 ----------
    progress('report', 3);
    const reportResult = await this._safeStep('report', paperText, JSON.stringify(analysis, null, 2));
    analysis.report = this._parseReport(reportResult);
    steps.push(reportResult);

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
        '你是一位严格的学术审稿人。请找出分析报告中的问题：分析是否准确、结论是否有依据、建议是否具体可操作、是否遗漏重要问题。直接给出批评意见。',
        `请审阅下面这份学术论文分析报告，指出其中的不足、错误与遗漏：\n\n${reportText}`,
        0.3, info.customEndpoint, info.userId,
        this._signal ? { signal: this._signal } : {}
      );
      this._reflectTokens += critique.usage?.total_tokens || 0;

      const revised = await this.llmRequest(
        info.provider, info.apiKey, info.model,
        '你是一位学术写作综合评估专家。请根据审稿意见改进分析报告，输出 JSON。',
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
