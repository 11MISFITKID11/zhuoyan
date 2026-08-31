/* 琢言 · 全文智能分析 Agent（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 全文智能分析 Agent
// ============================================================
const agentState = {
  analyzing: false,
  progress: 0,
  result: null,
  currentPanel: 'overview'
};

const AGENT_STEPS = [
  { key: 'structure', name: '结构分析', icon: '📋' },
  { key: 'diagnose', name: '综合诊断', icon: '🔬' },
  { key: 'report', name: '综合报告', icon: '📊' }
];

function updateAgentWordCount() {
  updateWordCount('agentInput', 'agentWordCount');
}

function clearAgent() {
  const input = document.getElementById('agentInput');
  if (input) input.value = '';
  agentState.result = null;
  agentState.progress = 0;
  updateAgentWordCount();
  renderAgentPanel(agentState.currentPanel);
}

async function startAgentAnalysis() {
  const input = document.getElementById('agentInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('请输入论文文本', 'error'); return; }
  if (text.length < 50) { showToast('文本过短，请输入至少 50 字', 'error'); return; }

  const btn = document.getElementById('btnStartAgent');
  const statusEl = document.getElementById('agentStatus');
  const panel = document.getElementById('agentPanel');

  btn.disabled = true;
  btn.textContent = '🤖 分析中...';
  statusEl.textContent = '● 分析中';
  statusEl.style.color = 'var(--warning)';
  agentState.analyzing = true;
  agentState.progress = 0;

  // 显示加载状态
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">Agent 正在执行多步分析...</div><div class="loading-steps" id="agentSteps">' +
    AGENT_STEPS.map(s => '<div style="margin:6px 0;opacity:0.4;" id="agent-step-' + s.key + '">' + s.icon + ' ' + s.name + ' — 等待中</div>').join('') +
    '</div></div>';

  try {
    const token = getToken();
    const res = await fetch(API_BASE + '/api/agent/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        text,
        rawApiKey: apiSettings.apiKey || '',
        customEndpoint: apiSettings.customEndpoint,
        model: apiSettings.model || 'gpt-4o-mini'
      })
    });

    if (!res.ok) {
      let errMsg = '分析失败';
      try { const e = await res.json(); errMsg = e.error || e.message || errMsg; } catch (e) {}
      throw new Error(errMsg);
    }

    // 读取 SSE 流：实时更新步骤进度，直到收到 complete
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let result = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data:')) continue;
        let msg;
        try { msg = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (msg.type === 'progress') updateAgentStepProgress(msg);
        else if (msg.type === 'complete') result = msg.result;
      }
    }

    if (!result) throw new Error('未收到分析结果');
    agentState.result = result;
    agentState.analyzing = false;
    btn.disabled = false;
    btn.textContent = '🤖 重新分析';
    statusEl.textContent = '● 分析完成 ✓';
    statusEl.style.color = 'var(--success)';
    showToast(`分析完成！综合评分: ${result.overallScore}/10`, 'success');
    renderAgentPanel(agentState.currentPanel || 'overview');
  } catch (err) {
    agentState.analyzing = false;
    btn.disabled = false;
    btn.textContent = '🤖 开始分析';
    statusEl.textContent = '● 分析失败';
    statusEl.style.color = 'var(--danger)';
    showToast(err.message || '分析失败', 'error');
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">分析失败</div><div class="empty-desc">' + esc(err.message || '请稍后重试') + '</div></div>';
  }
}

// 根据 SSE 进度事件更新步骤显示（前面的步骤标记完成，当前步骤标记进行中）
function updateAgentStepProgress(p) {
  const keys = AGENT_STEPS.map(s => s.key);
  const idx = keys.indexOf(p.step);
  if (idx < 0) return;
  keys.forEach((key, i) => {
    const el = document.getElementById('agent-step-' + key);
    if (!el) return;
    const meta = AGENT_STEPS[i];
    if (i < idx) {
      el.textContent = meta.icon + ' ' + meta.name + ' — 已完成';
      el.style.opacity = '1';
      el.style.color = 'var(--success)';
    } else if (i === idx) {
      const chunkInfo = (p.chunk && p.chunkTotal && p.chunkTotal > 1)
        ? ' — 第 ' + p.chunk + '/' + p.chunkTotal + ' 块'
        : ' — 进行中...';
      el.textContent = meta.icon + ' ' + meta.name + chunkInfo;
      el.style.opacity = '1';
      el.style.color = 'var(--brand)';
    }
  });
}

function renderAgentPanel(panel) {
  agentState.currentPanel = panel;
  const el = document.getElementById('agentPanel');
  if (!el) return;
  const r = agentState.result;

  if (!r) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🤖</div><div class="empty-title">等待全文分析</div><div class="empty-desc">粘贴完整论文文本，AI Agent 将自动执行多维度分析并生成综合报告</div></div>';
    return;
  }

  if (panel === 'overview') renderAgentOverview(r, el);
  else if (panel === 'structure') renderAgentStructure(r, el);
  else if (panel === 'details') renderAgentDetails(r, el);
  else if (panel === 'report') renderAgentReport(r, el);
}

function renderAgentOverview(r, el) {
  const a = r.analysis || {};
  const score = r.overallScore || 0;
  const scoreColor = score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)';

  el.innerHTML =
    '<div class="aigc-hero" style="margin-bottom:16px;">' +
      '<div class="aigc-hero-ring">' +
        '<svg width="100" height="100" style="transform:rotate(-90deg);">' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="8"/>' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="' + scoreColor + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (2 * Math.PI * 45) + '" stroke-dashoffset="' + (2 * Math.PI * 45 * (1 - score / 10)) + '"/>' +
        '</svg>' +
        '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">' +
          '<div class="aigc-hero-num">' + score.toFixed(1) + '<span class="aigc-hero-unit">/10</span></div>' +
          '<div class="aigc-hero-label">综合评分</div>' +
        '</div>' +
      '</div>' +
      '<div class="aigc-hero-status">各维度分析评分</div>' +
    '</div>' +
    '<div class="aigc-stats-grid">' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num">' + (a.structure?.structureScore || '-') + '</div><div class="aigc-stat-label">📋 结构</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num">' + (a.logic?.logicScore || '-') + '</div><div class="aigc-stat-label">🔗 逻辑</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num">' + (a.style?.overallStyleScore || '-') + '</div><div class="aigc-stat-label">🎨 风格</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num">' + ((a.aigc ? Math.round((1 - a.aigc.overallRate) * 10) : '-')) + '</div><div class="aigc-stat-label">🛡️ 人类度</div></div>' +
    '</div>' +
    '<div style="padding:12px 14px;margin-top:8px;">' +
      '<div style="font-size:11px;color:var(--gray-500);margin-bottom:8px;">分析步骤耗时</div>' +
      (r.steps || []).map(s => {
        const st = AGENT_STEPS.find(x => x.key === s.step);
        const icon = st ? st.icon : '⚙️';
        const color = s.success ? 'var(--success)' : 'var(--danger)';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;">' +
          '<span>' + icon + ' ' + esc(s.name) + '</span>' +
          '<span style="color:' + color + ';">' + (s.success ? '✓ ' : '✗ ') + esc(s.elapsed) + 'ms</span>' +
        '</div>';
      }).join('') +
    '</div>';
}

function renderAgentStructure(r, el) {
  const s = r.analysis?.structure;
  if (!s) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">结构分析未完成</div></div>';
    return;
  }
  let html = '<div class="logic-summary-bar"><div class="logic-summary-title">📋 ' + esc(s.paperType || '论文结构') + '</div>';
  html += '<div class="logic-summary-stats"><span class="logic-stat-pill">段落 <strong>' + esc(s.totalParagraphs || '-') + '</strong></span>';
  html += '<span class="logic-stat-pill">结构评分 <strong>' + esc(s.structureScore || '-') + '/10</strong></span></div></div>';
  html += '<div class="logic-canvas"><div class="logic-tree">';
  (s.sections || []).forEach(sec => {
    html +=
      '<div class="logic-node">' +
        '<div class="logic-node-content">' +
          '<div class="logic-node-head">' +
            '<span class="logic-node-type ln-claim">' + esc(sec.name || '') + '</span>' +
            '<span class="logic-node-level">' + esc(sec.range || '') + '</span>' +
          '</div>' +
          '<div class="logic-node-text">' + esc(sec.summary || '') + '</div>' +
        '</div>' +
      '</div>';
  });
  html += '</div></div>';
  if (s.structureIssues && s.structureIssues.length) {
    html += '<div class="suggestion-list" style="margin-top:10px;">';
    s.structureIssues.forEach(issue => {
      html += '<div class="suggestion-card" style="border-left:3px solid var(--warning);"><div class="sg-reason" style="font-size:12px;">⚠ ' + esc(issue) + '</div></div>';
    });
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderAgentDetails(r, el) {
  const a = r.analysis || {};
  let html = '';

  // 术语一致性
  if (a.terms && a.terms.length) {
    html += '<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:700;color:var(--term);margin-bottom:8px;">🔤 术语一致性</div>';
    a.terms.forEach(t => {
      html += '<div class="suggestion-card" style="border-left:3px solid var(--term);margin-bottom:8px;">' +
        '<div class="sg-header"><span class="sg-type-pill term">' + esc(t.concept) + '</span>' +
        '<span class="sg-severity">' + esc(t.severity) + '</span></div>' +
        '<div class="sg-diff"><span class="sg-diff-old">' + (t.variants || []).map(esc).join(' / ') + '</span>' +
        '<div class="sg-diff-arrow">↓ 建议统一</div>' +
        '<span class="sg-diff-new">' + esc(t.recommended) + '</span></div></div>';
    });
    html += '</div>';
  }

  // 逻辑断层
  if (a.logic && a.logic.logicGaps && a.logic.logicGaps.length) {
    html += '<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:700;color:var(--danger);margin-bottom:8px;">🔗 逻辑断层</div>';
    a.logic.logicGaps.forEach(g => {
      html += '<div class="suggestion-card" style="border-left:3px solid var(--danger);margin-bottom:8px;">' +
        '<div class="sg-header"><span class="sg-type-pill" style="background:var(--danger-bg);color:var(--danger);">' + esc(g.location || '') + '</span></div>' +
        '<div class="sg-reason">⚠ ' + esc(g.description) + '</div>' +
        '<div style="font-size:11px;color:var(--gray-600);margin-top:4px;">💡 ' + esc(g.suggestion || '') + '</div></div>';
    });
    html += '</div>';
  }

  // 风格问题
  if (a.style && a.style.issues && a.style.issues.length) {
    html += '<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:700;color:var(--style);margin-bottom:8px;">🎨 风格问题</div>';
    a.style.issues.forEach(i => {
      html += '<div class="suggestion-card" style="border-left:3px solid var(--style);margin-bottom:8px;">' +
        '<div class="sg-reason" style="font-size:12px;">' + esc(i.description || '') + '</div>' +
        '<div style="font-size:11px;color:var(--gray-600);margin-top:4px;">💡 ' + esc(i.suggestion || '') + '</div></div>';
    });
    html += '</div>';
  }

  // AIGC 指标
  if (a.aigc && a.aigc.indicators && a.aigc.indicators.length) {
    html += '<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:700;color:var(--clarity);margin-bottom:8px;">🛡️ AIGC 特征</div>';
    a.aigc.indicators.forEach(i => {
      html += '<div class="suggestion-card" style="border-left:3px solid var(--clarity);margin-bottom:8px;">' +
        '<div class="sg-reason" style="font-size:12px;">' + esc(i.description || '') + '</div></div>';
    });
    html += '</div>';
  }

  if (!html) html = '<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-title">未发现明显问题</div></div>';
  el.innerHTML = html;
}

function renderAgentReport(r, el) {
  const rep = r.analysis?.report;
  if (!rep) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">综合报告未生成</div><div class="empty-desc">可能因 API 调用失败，请重试</div></div>';
    return;
  }

  let html = '';

  // 总体评价
  if (rep.overallScore) {
    const color = rep.overallScore >= 70 ? 'var(--success)' : rep.overallScore >= 50 ? 'var(--warning)' : 'var(--danger)';
    html += '<div style="text-align:center;margin-bottom:16px;">' +
      '<div style="font-size:36px;font-weight:800;color:' + color + ';">' + rep.overallScore + '</div>' +
      '<div style="font-size:11px;color:var(--gray-500);">综合评分 / 100</div></div>';
  }

  if (rep.summary) {
    html += '<div class="suggestion-card" style="margin-bottom:12px;border-left:3px solid var(--brand);">' +
      '<div class="sg-reason" style="font-size:12px;line-height:1.8;">' + esc(rep.summary) + '</div></div>';
  }

  // 优点
  if (rep.strengths && rep.strengths.length) {
    html += '<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--success);margin-bottom:6px;">✓ 论文优点</div>';
    rep.strengths.forEach(s => {
      html += '<div style="font-size:12px;color:var(--gray-700);padding:4px 0;">✓ ' + esc(s) + '</div>';
    });
    html += '</div>';
  }

  // 不足
  if (rep.weaknesses && rep.weaknesses.length) {
    html += '<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--danger);margin-bottom:6px;">⚠ 论文不足</div>';
    rep.weaknesses.forEach(s => {
      html += '<div style="font-size:12px;color:var(--gray-700);padding:4px 0;">⚠ ' + esc(s) + '</div>';
    });
    html += '</div>';
  }

  // 改进建议
  if (rep.recommendations && rep.recommendations.length) {
    html += '<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--brand);margin-bottom:6px;">💡 改进建议</div>';
    const pColor = { '高': 'var(--danger)', '中': 'var(--warning)', '低': 'var(--gray-400)' };
    rep.recommendations.forEach(rec => {
      html += '<div class="suggestion-card" style="margin-bottom:8px;border-left:3px solid ' + (pColor[rec.priority] || 'var(--brand)') + ';">' +
        '<div class="sg-header"><span class="sg-type-pill" style="background:var(--brand-bg);color:var(--brand);">' + esc(rec.priority) + '优先</span></div>' +
        '<div style="font-size:12px;font-weight:600;margin:4px 0;">' + esc(rec.title) + '</div>' +
        '<div class="sg-reason" style="font-size:11px;">' + esc(rec.description) + '</div>' +
        (rec.impact ? '<div style="font-size:10px;color:var(--gray-500);margin-top:4px;">预期: ' + esc(rec.impact) + '</div>' : '') +
      '</div>';
    });
    html += '</div>';
  }

  // 行动计划
  if (rep.actionPlan && rep.actionPlan.length) {
    html += '<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;">🚀 行动计划</div>';
    rep.actionPlan.forEach(step => {
      const toolMap = { polish: '✍️ 润色', logic: '🧩 逻辑', aigc: '🛡️ AIGC', rewrite: '🔄 改写' };
      html += '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:12px;">' +
        '<span style="background:var(--brand);color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;">' + step.step + '</span>' +
        '<div><div style="color:var(--gray-800);">' + esc(step.action) + '</div>' +
        (step.tool ? '<span style="font-size:10px;color:var(--brand);">使用工具: ' + esc(toolMap[step.tool] || step.tool) + '</span>' : '') +
        '</div></div>';
    });
    html += '</div>';
  }

  if (!html) html = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">报告为空</div></div>';
  el.innerHTML = html;
}

function exportAgentReport() {
  const r = agentState.result;
  if (!r) { showToast('请先执行分析', 'error'); return; }
  const rep = r.analysis?.report;
  let text = '琢言 · 全文智能分析报告\n';
  text += '════════════════════════════════\n';
  text += '综合评分: ' + r.overallScore + '/10\n';
  text += '分析耗时: ' + r.totalElapsed + 'ms\n\n';

  if (rep) {
    if (rep.summary) text += '【总体评价】\n' + rep.summary + '\n\n';
    if (rep.strengths) { text += '【优点】\n' + rep.strengths.map(s => '• ' + s).join('\n') + '\n\n'; }
    if (rep.weaknesses) { text += '【不足】\n' + rep.weaknesses.map(s => '• ' + s).join('\n') + '\n\n'; }
    if (rep.recommendations) {
      text += '【改进建议】\n';
      rep.recommendations.forEach(rec => {
        text += '[' + rec.priority + '优先] ' + rec.title + '\n  ' + rec.description + '\n';
      });
      text += '\n';
    }
    if (rep.actionPlan) {
      text += '【行动计划】\n';
      rep.actionPlan.forEach(s => {
        text += s.step + '. ' + s.action + (s.tool ? ' (工具: ' + s.tool + ')' : '') + '\n';
      });
    }
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '琢言-全文分析报告.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('报告已导出', 'success');
}

