/* 琢言 · 学术润色模块（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 学术润色模块
// ============================================================
function loadSamplePolish() {
  const input = document.getElementById('polishInput');
  if (input) { input.value = samplePolishText; updateWordCount('polishInput', 'polishWordCount'); }
  showToast('已载入示例文本', 'success');
}

function clearPolish() {
  const input = document.getElementById('polishInput');
  if (input) input.value = '';
  updateWordCount('polishInput', 'polishWordCount');
  polishState.suggestions = [];
  polishState.acceptedCount = 0;
  polishState.dismissedCount = 0;
  polishState.editHistory = [];
  polishState.currentText = '';
  document.getElementById('btnAcceptAll').style.display = 'none';
  document.getElementById('polishEditor').innerHTML = '<textarea class="doc-input" id="polishInput" placeholder="在此粘贴或输入你的学术论文文本..."></textarea>';
  document.getElementById('polishInput').addEventListener('input', () => updateWordCount('polishInput', 'polishWordCount'));
  document.getElementById('polishPanel').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📝</div>
      <div class="empty-title">等待润色</div>
      <div class="empty-desc">输入文本并点击「开始润色」，系统将逐条给出修改建议</div>
    </div>`;
  document.getElementById('polishCount').textContent = '0';
  document.getElementById('polishStatus').textContent = '● 就绪';
  document.getElementById('polishStatus').style.color = 'var(--success)';
  updateStats();
}

async function startPolish() {
  // ====== FUTURE: 此处替换为 AIEngine.polish() 的 API 调用 ======
  const input = document.getElementById('polishInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('请先输入文本', 'error'); return; }
  if (text.length < 20) { showToast('文本过短，请输入至少20字', 'error'); return; }

  const panel = document.getElementById('polishPanel');
  panel.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">正在分析文本...</div>
      <div class="loading-steps">识别语法错误 · 检测措辞问题 · 校验术语一致性</div>
    </div>`;
  const btn = document.getElementById('btnStartPolish');
  btn.disabled = true; btn.textContent = '润色中...';
  document.getElementById('polishStatus').textContent = '● 分析中...';
  document.getElementById('polishStatus').style.color = 'var(--warning)';

  polishState.text = text;
  polishState.currentText = text;
  polishState.editHistory = [];
  try {
    const suggestions = await AIEngine.polish(text);
    polishState.suggestions = suggestions;

    renderPolishDocWithHighlights(text, suggestions);
    renderPolishSuggestions();
    document.getElementById('polishCount').textContent = suggestions.length;
    document.getElementById('btnAcceptAll').style.display = suggestions.length > 0 ? 'inline-flex' : 'none';
    btn.disabled = false; btn.textContent = '✨ 开始润色';
    document.getElementById('polishStatus').textContent = '● 完成 ✓';
    document.getElementById('polishStatus').style.color = 'var(--success)';
    showToast('润色完成，发现 ' + suggestions.length + ' 条建议', 'success');
  } catch (err) {
    // 复位按钮与状态，避免卡在 loading
    btn.disabled = false; btn.textContent = '✨ 开始润色';
    document.getElementById('polishStatus').textContent = '● ' + (err && err.quota ? '额度已用完' : '失败');
    document.getElementById('polishStatus').style.color = 'var(--danger)';
    if (err && err.name === 'AbortError') return;
    if (err && err.quota) { showToast(err.message || '免费额度不足', 'error'); showProUpgrade(); return; }
    showToast(err.message || '润色失败', 'error');
  }
}

function renderPolishDocWithHighlights(text, suggestions) {
  const editor = document.getElementById('polishEditor');
  if (!suggestions || suggestions.length === 0) {
    editor.innerHTML = '<div class="doc-page"><div class="doc-page-title">润色结果</div><div class="doc-page-content"><p>未发现需要修改的问题。</p></div></div>';
    return;
  }

  let html = text.split('\n\n').map((para, idx) => {
    let processed = para;
    suggestions.forEach(s => {
      if (para.includes(s.anchor)) {
        const escaped = s.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        processed = processed.replace(regex, (match) => {
          return '<mark class="hl ' + esc(s.type) + '" data-sid="' + esc(s.id) + '" onclick="scrollToSuggestion(\'' + esc(s.id) + '\')">' + esc(match) + '</mark>';
        });
      }
    });
    return '<p>' + processed + '</p>';
  }).join('');

  editor.innerHTML = '<div class="doc-page"><div class="doc-page-title">润色结果</div><div class="doc-page-content">' + html + '</div></div>';
}

function renderPolishSuggestions() {
  const panel = document.getElementById('polishPanel');
  if (!polishState.suggestions.length) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">等待润色</div><div class="empty-desc">输入文本并点击「开始润色」</div></div>';
    return;
  }
  const typeClass = { grammar: 'grammar', clarity: 'clarity', term: 'term', style: 'style' };
  panel.innerHTML = '<div class="suggestion-list">' + polishState.suggestions.map(s => {
    const mark = document.querySelector('mark.hl[data-sid="' + esc(s.id) + '"]');
    const replaced = document.querySelector('span.accepted-replacement[data-sid="' + esc(s.id) + '"]');
    const isDismissed = mark && mark.classList.contains('dismissed');
    const isAccepted = replaced !== null;
    let actionsHtml = '';
    if (replaced) {
      actionsHtml = '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();undoSuggestion(\'' + esc(s.id) + '\')">↩ 撤销</button>';
    } else if (isDismissed) {
      actionsHtml = '<span style="font-size:10px;color:var(--gray-400);">已忽略</span>';
    } else {
      actionsHtml = '<button class="btn btn-success btn-xs" onclick="event.stopPropagation();acceptSuggestion(\'' + esc(s.id) + '\')">✓ 接受</button>' +
                    '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dismissSuggestion(\'' + esc(s.id) + '\')">忽略</button>';
    }
    return '<div class="suggestion-card ' + (isAccepted ? 'accepted' : '') + ' ' + (isDismissed ? 'dismissed' : '') + '" id="card-' + esc(s.id) + '" onclick="scrollToHighlight(\'' + esc(s.id) + '\')">' +
      '<div class="sg-header">' +
        '<span class="sg-type-pill ' + esc(typeClass[s.type] || '') + '">' + esc(s.typeName) + '</span>' +
        '<span class="sg-severity">' + esc(s.severity) + '优先级</span>' +
        (replaced ? '<span style="font-size:10px;color:var(--success);margin-left:auto;">✓ 已替换</span>' : '') +
      '</div>' +
      '<div class="sg-diff ' + esc(typeClass[s.type] || '') + '">' +
        '<span class="sg-diff-old">' + esc(s.old) + '</span>' +
        '<div class="sg-diff-arrow">↓ 已改为</div>' +
        '<span class="sg-diff-new">' + esc(s.new) + '</span>' +
      '</div>' +
      '<div class="sg-reason">💡 ' + esc(s.reason) + '</div>' +
      '<div class="sg-actions">' + actionsHtml + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function renderPolishSummary() {
  const panel = document.getElementById('polishPanel');
  const s = polishState.suggestions;
  const total = s.length;
  const grammar = s.filter(x => x.type === 'grammar').length;
  const clarity = s.filter(x => x.type === 'clarity').length;
  const term = s.filter(x => x.type === 'term').length;
  const style = s.filter(x => x.type === 'style').length;
  const score = Math.max(60, 100 - total * 5);

  panel.innerHTML =
    '<div class="score-card">' +
      '<div class="score-ring-wrap">' +
        '<svg class="score-ring-svg" width="90" height="90">' +
          '<circle class="score-ring-bg" cx="45" cy="45" r="38"/>' +
          '<circle class="score-ring-fill" cx="45" cy="45" r="38" stroke-dasharray="' + (2 * Math.PI * 38) + '" stroke-dashoffset="' + (2 * Math.PI * 38 * (1 - score / 100)) + '"/>' +
        '</svg>' +
        '<div class="score-ring-text"><div class="score-ring-num">' + score + '</div><div class="score-ring-label">写作得分</div></div>' +
      '</div>' +
      '<div class="score-card-title">' + (score >= 85 ? '优秀' : score >= 70 ? '良好' : '需改进') + '</div>' +
      '<div class="score-card-desc">共发现 ' + total + ' 处可优化点</div>' +
    '</div>' +
    '<div class="score-breakdown">' +
      '<div class="breakdown-item"><div class="breakdown-num grammar">' + grammar + '</div><div class="breakdown-label">语法错误</div></div>' +
      '<div class="breakdown-item"><div class="breakdown-num clarity">' + clarity + '</div><div class="breakdown-label">清晰度</div></div>' +
      '<div class="breakdown-item"><div class="breakdown-num term">' + term + '</div><div class="breakdown-label">术语统一</div></div>' +
      '<div class="breakdown-item"><div class="breakdown-num style">' + style + '</div><div class="breakdown-label">写作风格</div></div>' +
    '</div>' +
    '<div style="padding:14px 16px;font-size:11px;color:var(--gray-500);line-height:1.7;">' +
      '💡 <strong style="color:var(--gray-700);">改进建议</strong><br>' +
      (grammar > 0 ? '• 优先处理语法错误，影响基础可读性<br>' : '') +
      (term > 0 ? '• 术语不统一会影响学术严谨性，建议全文统一<br>' : '') +
      (style > 0 ? '• 风格问题可后续优化，提升表达专业度<br>' : '') +
      (clarity > 0 ? '• 清晰度问题建议逐条审阅<br>' : '') +
    '</div>';
}

function scrollToSuggestion(id) {
  const card = document.getElementById('card-' + id);
  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('active'); setTimeout(() => card.classList.remove('active'), 2000); }
}

function scrollToHighlight(id) {
  const mark = document.querySelector('mark.hl[data-sid="' + id + '"]');
  if (mark) {
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('mark.hl').forEach(m => m.classList.remove('active'));
    mark.classList.add('active');
    setTimeout(() => mark.classList.remove('active'), 2000);
  }
}

// 后端额度缓存（由 refreshQuota / adoptQuota 从 /api/usage 刷新，页面加载与采纳成功后同步）
// 额度口径：仅在「采纳 AI 修改」时按采纳内容的字数累计（adoptQuota）；
// 分析/生成过程不计费 —— 不做修改则额度不变，接受修改才增加字数；
// 已达上限时由入口预检与后端 429 兜底，只能升级 Pro 解锁。
let quotaCache = { used: 0, limit: 3000, plan: 'free' };

// 升级引导：额度不足时统一由此抛出 quota 错误，由各页面 catch 复位 UI 并弹出升级框
function makeQuotaError() {
  const limit = quotaCache.limit || 3000;
  const err = new Error('今日可采纳字数已达上限（每日 ' + limit.toLocaleString() + ' 字），请升级 Pro 获取无限额度');
  err.quota = true;
  return err;
}

async function acceptSuggestion(id) {
  const suggestion = polishState.suggestions.find(s => s.id === id);
  if (!suggestion) return;

  // 采纳才计费：接受修改 → 按采纳内容字数计入额度；额度不足则拦截并引导升级 Pro
  const mark = document.querySelector('mark.hl[data-sid="' + id + '"]');
  if (!mark) { showToast('该建议已被处理', 'error'); return; }
  if (!(await adoptQuota(suggestion.new.length))) return;

  const span = document.createElement('span');
  span.className = 'accepted-replacement';
  span.title = '原文: ' + mark.textContent + '  点击右侧面板可撤销';
  span.dataset.sid = id;
  span.textContent = suggestion.new;
  span.onclick = function() { scrollToSuggestion(id); };
  mark.parentNode.replaceChild(span, mark);

  polishState.editHistory.push({
    id: id,
    originalAnchor: suggestion.anchor,
    originalText: mark.textContent
  });

  const idx = polishState.currentText.indexOf(suggestion.anchor);
  if (idx >= 0) {
    polishState.currentText =
      polishState.currentText.substring(0, idx) +
      suggestion.new +
      polishState.currentText.substring(idx + suggestion.anchor.length);
  }

  const card = document.getElementById('card-' + id);
  if (card) {
    card.classList.add('accepted');
    const actions = card.querySelector('.sg-actions');
    if (actions) {
      actions.innerHTML = '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();undoSuggestion(\'' + esc(id) + '\')">↩ 撤销</button>';
    }
  }

  polishState.acceptedCount++;
  showToast('已采纳: ' + suggestion.new, 'success');
  updatePolishCount();
  updateStats();
}

function dismissSuggestion(id) {
  const mark = document.querySelector('mark.hl[data-sid="' + id + '"]');
  if (mark) mark.classList.add('dismissed');
  const card = document.getElementById('card-' + id);
  if (card) { card.classList.add('dismissed'); card.querySelector('.sg-actions').innerHTML = '<span style="font-size:10px;color:var(--gray-400);">已忽略</span>'; }
  polishState.dismissedCount++;
  updatePolishCount();
  updateStats();
}

function undoSuggestion(id) {
  const history = polishState.editHistory.find(h => h.id === id);
  if (!history) { showToast('无法撤销', 'error'); return; }
  const suggestion = polishState.suggestions.find(s => s.id === id);
  if (!suggestion) return;

  const span = document.querySelector('span.accepted-replacement[data-sid="' + id + '"]');
  if (!span) return;

  // 恢复原来的高亮标记
  const mark = document.createElement('mark');
  mark.className = 'hl ' + (suggestion.type || 'clarity');
  mark.dataset.sid = id;
  mark.textContent = history.originalText;
  mark.onclick = function() { scrollToSuggestion(id); };
  span.parentNode.replaceChild(mark, span);

  // 回退 currentText
  const idx = polishState.currentText.indexOf(suggestion.new);
  if (idx >= 0) {
    polishState.currentText =
      polishState.currentText.substring(0, idx) +
      history.originalAnchor +
      polishState.currentText.substring(idx + suggestion.new.length);
  }

  // 更新卡片
  const card = document.getElementById('card-' + id);
  if (card) {
    card.classList.remove('accepted');
    const actions = card.querySelector('.sg-actions');
    if (actions) {
      actions.innerHTML =
        '<button class="btn btn-success btn-xs" onclick="event.stopPropagation();acceptSuggestion(\'' + id + '\')">✓ 接受</button>' +
        '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();dismissSuggestion(\'' + id + '\')">忽略</button>';
    }
  }

  polishState.editHistory = polishState.editHistory.filter(h => h.id !== id);
  polishState.acceptedCount--;
  // 撤销采纳 → 退回对应采纳字数（额度随实际采纳内容增减）
  void adoptQuota(-suggestion.new.length);
  showToast('已撤销修改', '');
  updatePolishCount();
  updateStats();
}

async function acceptAllPolish() {
  const pending = polishState.suggestions.filter(s => {
    const mark = document.querySelector('mark.hl[data-sid="' + s.id + '"]');
    return mark && !mark.classList.contains('accepted') && !mark.classList.contains('dismissed');
  });
  if (pending.length === 0) { showToast('没有待处理的建议', ''); return; }
  // 采纳才计费：先做一次总量预检，避免逐条采纳到一半被拦截
  const total = pending.reduce((sum, s) => sum + (s.new || '').length, 0);
  if (getToken() && quotaCache.plan !== 'pro' && (quotaCache.used || 0) + total > (quotaCache.limit || 3000)) {
    showToast('今日可采纳字数不足（每日 ' + (quotaCache.limit || 3000).toLocaleString() + ' 字），请升级 Pro', 'error');
    showProUpgrade();
    return;
  }
  for (const s of pending) {
    const m = document.querySelector('mark.hl[data-sid="' + s.id + '"]');
    if (m && !m.classList.contains('dismissed')) await acceptSuggestion(s.id);
  }
  showToast('已接受全部 ' + pending.length + ' 条建议', 'success');
}

function updatePolishCount() {
  let remaining = 0;
  polishState.suggestions.forEach(s => {
    const mark = document.querySelector('mark.hl[data-sid="' + s.id + '"]');
    const replaced = document.querySelector('span.accepted-replacement[data-sid="' + s.id + '"]');
    if (mark && !mark.classList.contains('dismissed')) remaining++;    // mark还在 = 未接受也未忽略
    if (replaced) {} // 已替换到原文 = 已处理
  });
  document.getElementById('polishCount').textContent = remaining;
}

