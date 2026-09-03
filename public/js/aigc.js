/* 琢言 · AIGC 检测模块（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// AIGC检测模块
// ============================================================
let aigcDetectionData = null;
let aigcOriginalText = '';   // 保存检测前的原文（textarea 被替换后仍可保存）
let aigcRewriteHistory = [];  // { paraIdx, originalText, rewrittenText }

function loadSampleAIGC() {
  const input = document.getElementById('aigcInput');
  if (input) { input.value = sampleAIGCText; updateWordCount('aigcInput', 'aigcWordCount'); }
  showToast('已载入示例文本', 'success');
}

function clearAIGC() {
  const input = document.getElementById('aigcInput');
  if (input) input.value = '';
  updateWordCount('aigcInput', 'aigcWordCount');
  aigcDetectionData = null;
  aigcOriginalText = '';
  aigcRewriteHistory = [];
  document.getElementById('aigcEditor').innerHTML = '<textarea class="doc-input" id="aigcInput" placeholder="在此粘贴需要检测的学术论文文本..."></textarea>';
  document.getElementById('aigcInput').addEventListener('input', () => updateWordCount('aigcInput', 'aigcWordCount'));
  document.getElementById('aigcPanel').innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">暂无检测报告</div><div class="empty-desc">开始检测后，此处将展示段落级 AI 率评分</div></div>';
  document.getElementById('aigcCount').textContent = '0';
  document.getElementById('aigcStatus').textContent = '● 就绪';
  document.getElementById('aigcStatus').style.color = 'var(--success)';
}

async function startAIGC() {
  // ====== FUTURE: 此处替换为 AIEngine.detectAIGC() 的 API 调用 ======
  const input = document.getElementById('aigcInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('请先输入文本', 'error'); return; }

  const panel = document.getElementById('aigcPanel');
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">正在逐段检测 AI 生成概率...</div><div class="loading-steps">文本特征提取 · 模型推理 · 段落级评分</div></div>';
  const btn = document.getElementById('btnStartAIGC');
  btn.disabled = true; btn.textContent = '检测中...';
  document.getElementById('aigcStatus').textContent = '● 检测中...';
  document.getElementById('aigcStatus').style.color = 'var(--warning)';

  aigcOriginalText = text;
  try {
    aigcDetectionData = await AIEngine.detectAIGC(text);
    aigcRewriteHistory = [];
    renderAIGCReport();
    renderAIGCParagraphs();

    // 高亮编辑器中的段落
    renderAIGCInEditor(aigcDetectionData);

    const highRisk = aigcDetectionData.filter(p => p.aiRate >= 0.5).length;
    document.getElementById('aigcCount').textContent = aigcDetectionData.length;
    btn.disabled = false; btn.textContent = '🔬 开始检测';
    document.getElementById('aigcStatus').textContent = '● 完成 ✓';
    document.getElementById('aigcStatus').style.color = 'var(--success)';
    showToast('检测完成，发现 ' + highRisk + ' 处高风险段落', highRisk > 0 ? 'error' : 'success');
  } catch (err) {
    btn.disabled = false; btn.textContent = '🔬 开始检测';
    document.getElementById('aigcStatus').textContent = '● ' + (err && err.quota ? '额度已用完' : '失败');
    document.getElementById('aigcStatus').style.color = 'var(--danger)';
    if (err && err.name === 'AbortError') return;
    if (err && err.quota) { showToast(err.message || '免费额度不足', 'error'); showProUpgrade(); return; }
    showToast(err.message || '检测失败', 'error');
  }
}

function renderAIGCInEditor(data) {
  if (!data || !data.length) return;
  const editor = document.getElementById('aigcEditor');
  let html = '<div class="doc-page"><div class="doc-page-title">检测结果</div><div class="doc-page-content">';
  data.forEach((p, i) => {
    const riskClass = p.aiRate >= 0.7 ? 'high' : p.aiRate >= 0.5 ? 'mid' : 'low';
    const bgColor = riskClass === 'high' ? 'rgba(239,68,68,0.08)' : riskClass === 'mid' ? 'rgba(245,158,11,0.08)' : 'transparent';
    const borderColor = riskClass === 'high' ? 'var(--danger)' : riskClass === 'mid' ? 'var(--warning)' : 'transparent';
    const label = riskClass === 'high' ? '⚠️ 高风险 ' + Math.round(p.aiRate * 100) + '%' : riskClass === 'mid' ? '⚡ 中风险 ' + Math.round(p.aiRate * 100) + '%' : '✓ 低风险 ' + Math.round(p.aiRate * 100) + '%';
    html +=
      '<div style="margin-bottom:12px;padding:8px;background:' + bgColor + ';border-left:3px solid ' + borderColor + ';border-radius:4px;" id="aigcPara-' + i + '">' +
        '<div style="font-size:10px;font-weight:600;margin-bottom:4px;color:' + borderColor + ';">¶' + (i + 1) + ' · ' + label + '</div>' +
        '<p style="margin:0;font-size:14px;">' + esc(p.text) + '</p>' +
      '</div>';
  });
  html += '</div></div>';
  editor.innerHTML = html;
}

function getRiskClass(rate) {
  if (rate < 0.3) return 'risk-low';
  if (rate < 0.5) return 'risk-mid';
  if (rate < 0.7) return 'risk-high';
  return 'risk-extreme';
}
function getRiskName(rate) {
  if (rate < 0.3) return '低风险';
  if (rate < 0.5) return '中风险';
  if (rate < 0.7) return '高风险';
  return '极高风险';
}
function getRiskColor(rate) {
  if (rate < 0.3) return '#10b981';
  if (rate < 0.5) return '#f59e0b';
  if (rate < 0.7) return '#f43f5e';
  return '#ef4444';
}

function renderAIGCReport() {
  const panel = document.getElementById('aigcPanel');
  if (!aigcDetectionData) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">暂无检测报告</div></div>';
    return;
  }

  const avgRate = aigcDetectionData.reduce((s, p) => s + p.aiRate, 0) / aigcDetectionData.length;
  const highRisk = aigcDetectionData.filter(p => p.aiRate >= 0.5).length;
  const extremeRisk = aigcDetectionData.filter(p => p.aiRate >= 0.7).length;
  const lowRisk = aigcDetectionData.filter(p => p.aiRate < 0.3).length;
  const midRisk = aigcDetectionData.filter(p => p.aiRate >= 0.3 && p.aiRate < 0.5).length;
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference * (1 - avgRate);

  panel.innerHTML =
    '<div class="aigc-hero">' +
      '<div class="aigc-hero-ring">' +
        '<svg width="100" height="100" style="transform:rotate(-90deg);">' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="8"/>' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="' + getRiskColor(avgRate) + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '"/>' +
        '</svg>' +
        '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">' +
          '<div class="aigc-hero-num">' + Math.round(avgRate * 100) + '<span class="aigc-hero-unit">%</span></div>' +
          '<div class="aigc-hero-label">平均 AI 率</div>' +
        '</div>' +
      '</div>' +
      '<div class="aigc-hero-status">' + (avgRate >= 0.5 ? '⚠ 风险较高，建议降AI改写' : avgRate >= 0.3 ? '⚡ 存在一定风险' : '✓ 风险较低') + '</div>' +
      '<div style="font-size:10px;opacity:0.5;margin-top:6px;">检测模型 aigc-detector-v2.3</div>' +
    '</div>' +
    '<div class="aigc-stats-grid">' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num">' + aigcDetectionData.length + '</div><div class="aigc-stat-label">检测段落</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num success">' + lowRisk + '</div><div class="aigc-stat-label">低风险</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num warning">' + midRisk + '</div><div class="aigc-stat-label">中风险</div></div>' +
      '<div class="aigc-stat-cell"><div class="aigc-stat-num danger">' + extremeRisk + '</div><div class="aigc-stat-label">极高风险</div></div>' +
    '</div>' +
    '<div style="padding:10px 14px;">' +
      '<div style="font-size:11px;color:var(--gray-500);line-height:1.7;">' +
        '💡 建议优先处理极高风险段落，使用「降AI改写」功能<br>' +
        '改写后请重新检测，直到 AI 率降至目标阈值以下' +
      '</div>' +
    '</div>';
}

function renderAIGCParagraphs() {
  const panel = document.getElementById('aigcPanel');
  if (!aigcDetectionData) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">暂无检测数据</div></div>';
    return;
  }

  panel.innerHTML = aigcDetectionData.map((p, i) => {
    const isHigh = p.aiRate >= 0.5;
    const newRate = Math.round(p.aiRate * 0.3 * 100);
    const isRewritten = aigcRewriteHistory.some(h => h.paraIdx === i);

    // 如果已接受改写，显示撤销状态
    if (isRewritten) {
      return '<div class="aigc-para-card" style="border-color:var(--success);">' +
        '<div class="aigc-para-head">' +
          '<span class="aigc-para-label" style="color:var(--success);">¶ 段落 ' + (i + 1) + ' · 已改写 ✓</span>' +
          '<div class="aigc-para-bar-wrap"><div class="aigc-para-bar" style="width:' + (newRate) + '%;background:var(--success);"></div></div>' +
          '<span class="aigc-para-score risk-low">' + newRate + '%</span>' +
        '</div>' +
        '<div class="aigc-para-body">' + esc(aigcRewriteHistory.find(h => h.paraIdx === i)?.rewrittenText || p.text) + '</div>' +
        '<div class="aigc-para-actions">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<span style="font-size:10px;color:var(--success);font-weight:600;">✓ 已改写</span>' +
            '<button class="btn btn-ghost btn-xs" onclick="undoAIGCRewrite(' + i + ')">↩ 撤销</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // 默认状态
    return '<div class="aigc-para-card ' + (isHigh ? 'high-risk' : '') + '">' +
      '<div class="aigc-para-head">' +
        '<span class="aigc-para-label">¶ 段落 ' + (i + 1) + ' · ' + getRiskName(p.aiRate) + '</span>' +
        '<div class="aigc-para-bar-wrap"><div class="aigc-para-bar" style="width:' + (p.aiRate * 100) + '%;background:' + getRiskColor(p.aiRate) + ';"></div></div>' +
        '<span class="aigc-para-score ' + getRiskClass(p.aiRate) + '">' + Math.round(p.aiRate * 100) + '%</span>' +
      '</div>' +
      '<div class="aigc-para-body">' + esc(p.text) + '</div>' +
      (isHigh ?
        '<div class="aigc-para-actions"><button class="btn btn-primary btn-sm" style="width:100%;" onclick="rewriteAIGCPara(' + i + ')" id="rewriteBtn-' + i + '">🔄 降AI改写</button></div>' +
        '<div class="rewrite-result" id="rewriteResult-' + i + '">' +
          '<div class="rewrite-label">✓ 改写完成 · AI率降至 ' + newRate + '%</div>' +
          '<div class="rewrite-text" id="rewriteText-' + i + '">改写中...</div>' +
          '<div class="rewrite-meta">' +
            '<span class="rewrite-meta-item">语义相似度 <strong>0.88</strong></span>' +
            '<span class="rewrite-meta-item">术语保留 <strong>100%</strong></span>' +
            '<span class="rewrite-meta-item">AI率下降 <strong>' + Math.round((1 - 0.3) * 100) + '%</strong></span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px;">' +
            '<button class="btn btn-success btn-xs" style="flex:1;" onclick="acceptAIGCRewrite(' + i + ')">✓ 接受改写</button>' +
            '<button class="btn btn-ghost btn-xs" onclick="showToast(\'改写已放弃\')">放弃</button>' +
          '</div>' +
        '</div>'
        : '<div class="aigc-para-actions"><div style="font-size:10px;color:var(--success);text-align:center;padding:4px;">✓ 风险较低，无需改写</div></div>'
      ) +
    '</div>';
  }).join('');
}

async function rewriteAIGCPara(i) {
  // ====== FUTURE: 此处替换为 AIEngine.rewriteAIGC() 的 API 调用 ======
  const btn = document.getElementById('rewriteBtn-' + i);
  const result = document.getElementById('rewriteResult-' + i);
  const textEl = document.getElementById('rewriteText-' + i);
  btn.textContent = '改写中...';
  btn.disabled = true;

  const para = aigcDetectionData[i];
  // 流式显示改写结果（打字机效果）
  let streamText = '';
  let rewritten;
  try {
    rewritten = await AIEngine.rewriteAIGC(para.text, {
      onDelta: (d) => {
        streamText += d;
        textEl.textContent = streamText;
      }
    });
  } catch (err) {
    btn.textContent = '🔄 降AI改写';
    btn.disabled = false;
    if (err && err.name === 'AbortError') return;
    if (err && err.quota) { showToast(err.message || '免费额度不足', 'error'); showProUpgrade(); return; }
    showToast(err.message || '改写失败', 'error');
    return;
  }
  textEl.textContent = rewritten;
  btn.style.display = 'none';
  result.classList.add('show');
  showToast('改写完成，AI率已下降', 'success');
}

async function acceptAIGCRewrite(i) {
  if (!aigcDetectionData || !aigcDetectionData[i]) return;
  const paraData = aigcDetectionData[i];
  const rewriteResult = document.getElementById('rewriteText-' + i);
  if (!rewriteResult) { showToast('请先进行降AI改写', 'error'); return; }
  const rewrittenText = rewriteResult.textContent;
  if (!rewrittenText || rewrittenText === '改写中...') return;
  // 采纳才计费：接受改写 → 按采纳文本字数计入额度；额度不足则拦截并引导升级 Pro
  if (!(await adoptQuota(rewrittenText.length))) return;

  // 1. 替换编辑器中的段落文本
  const paraDiv = document.getElementById('aigcPara-' + i);
  if (paraDiv) {
    const textP = paraDiv.querySelector('p');
    if (textP) {
      // 保存原始文本到历史
      const inHistory = aigcRewriteHistory.find(h => h.paraIdx === i);
      if (!inHistory) {
        aigcRewriteHistory.push({ paraIdx: i, originalText: paraData.text, rewrittenText: rewrittenText });
      }
      // 替换显示文本
      textP.textContent = rewrittenText;
      // 更新样式 - 绿色背景表示已改写
      paraDiv.style.background = 'rgba(16,185,129,0.1)';
      paraDiv.style.borderLeft = '3px solid var(--success)';
      // 更新标签
      const labelDiv = paraDiv.querySelector('div:first-child');
      if (labelDiv) {
        labelDiv.innerHTML = '¶' + (i + 1) + ' · 已改写 ✓';
        labelDiv.style.color = 'var(--success)';
      }
    }
  }

  // 2. 更新右侧卡片
  const card = document.querySelectorAll('.aigc-para-card')[i];
  if (card) {
    card.classList.remove('high-risk');
    const score = card.querySelector('.aigc-para-score');
    score.className = 'aigc-para-score risk-low';
    score.textContent = Math.round(paraData.aiRate * 0.3 * 100) + '%';
    const bar = card.querySelector('.aigc-para-bar');
    bar.style.width = (paraData.aiRate * 0.3 * 100) + '%';
    bar.style.background = 'var(--success)';

    // 替换按钮为撤销
    const actionsDiv = card.querySelector('.aigc-para-actions');
    if (actionsDiv) {
      const rewriteResultDiv = document.getElementById('rewriteResult-' + i);
      if (rewriteResultDiv) rewriteResultDiv.classList.remove('show');
      actionsDiv.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span style="font-size:10px;color:var(--success);font-weight:600;">✓ 已改写</span>' +
          '<button class="btn btn-ghost btn-xs" onclick="undoAIGCRewrite(' + i + ')">↩ 撤销</button>' +
        '</div>';
    }
  }

  showToast('改写已采纳，原文已替换 ✓', 'success');
}

function undoAIGCRewrite(i) {
  const history = aigcRewriteHistory.find(h => h.paraIdx === i);
  if (!history) { showToast('无法撤销', 'error'); return; }

  // 1. 恢复编辑器中的段落原文
  const paraDiv = document.getElementById('aigcPara-' + i);
  if (paraDiv) {
    const textP = paraDiv.querySelector('p');
    if (textP) {
      textP.textContent = history.originalText;
      // 恢复原始样式（根据AI率）
      const rate = aigcDetectionData[i] ? aigcDetectionData[i].aiRate : 0;
      const isHigh = rate >= 0.7;
      const isMid = rate >= 0.5;
      paraDiv.style.background = isHigh ? 'rgba(239,68,68,0.08)' : isMid ? 'rgba(245,158,11,0.08)' : 'transparent';
      paraDiv.style.borderLeft = '3px solid ' + (isHigh ? 'var(--danger)' : isMid ? 'var(--warning)' : 'transparent');
      const labelDiv = paraDiv.querySelector('div:first-child');
      if (labelDiv) {
        const label = isHigh ? '⚠️ 高风险 ' + Math.round(rate * 100) + '%' : isMid ? '⚡ 中风险 ' + Math.round(rate * 100) + '%' : '✓ 低风险 ' + Math.round(rate * 100) + '%';
        labelDiv.innerHTML = '¶' + (i + 1) + ' · ' + label;
        labelDiv.style.color = isHigh ? 'var(--danger)' : isMid ? 'var(--warning)' : 'var(--success)';
      }
    }
  }

  // 2. 恢复右侧卡片
  const card = document.querySelectorAll('.aigc-para-card')[i];
  if (card) {
    const rate = aigcDetectionData[i] ? aigcDetectionData[i].aiRate : 0;
    const isHigh = rate >= 0.5;
    if (isHigh) card.classList.add('high-risk');
    else card.classList.remove('high-risk');
    const score = card.querySelector('.aigc-para-score');
    score.className = 'aigc-para-score ' + getRiskClass(rate);
    score.textContent = Math.round(rate * 100) + '%';
    const bar = card.querySelector('.aigc-para-bar');
    bar.style.width = (rate * 100) + '%';
    bar.style.background = getRiskColor(rate);

    // 还原改写按钮
    const actionsDiv = card.querySelector('.aigc-para-actions');
    if (actionsDiv) {
      const newRate = Math.round(rate * 0.3 * 100);
      actionsDiv.innerHTML =
        '<button class="btn btn-primary btn-sm" style="width:100%;" onclick="rewriteAIGCPara(' + i + ')" id="rewriteBtn-' + i + '">🔄 降AI改写</button>' +
        '<div class="rewrite-result" id="rewriteResult-' + i + '">' +
          '<div class="rewrite-label">✓ 改写完成 · AI率降至 ' + newRate + '%</div>' +
          '<div class="rewrite-text" id="rewriteText-' + i + '">改写中...</div>' +
          '<div class="rewrite-meta">' +
            '<span class="rewrite-meta-item">语义相似度 <strong>0.88</strong></span>' +
            '<span class="rewrite-meta-item">术语保留 <strong>100%</strong></span>' +
            '<span class="rewrite-meta-item">AI率下降 <strong>' + Math.round((1 - 0.3) * 100) + '%</strong></span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px;">' +
            '<button class="btn btn-success btn-xs" style="flex:1;" onclick="acceptAIGCRewrite(' + i + ')">✓ 接受改写</button>' +
            '<button class="btn btn-ghost btn-xs" onclick="showToast(\'改写已放弃\')">放弃</button>' +
          '</div>' +
        '</div>';
    }
  }

  // 3. 从历史中移除
  aigcRewriteHistory = aigcRewriteHistory.filter(h => h.paraIdx !== i);
  // 撤销采纳 → 退回对应采纳字数（额度随实际采纳内容增减）
  void adoptQuota(-((history.rewrittenText || '').length));
  showToast('已撤销改写，恢复原文', '');
}

