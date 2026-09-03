/* 琢言 · 逻辑优化模块（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 逻辑优化模块
// ============================================================
function loadSampleLogic() {
  const input = document.getElementById('logicInput');
  if (input) { input.value = sampleLogicText; updateWordCount('logicInput', 'logicWordCount'); }
  showToast('已载入示例文本', 'success');
}

function clearLogic() {
  const input = document.getElementById('logicInput');
  if (input) input.value = '';
  updateWordCount('logicInput', 'logicWordCount');
  logicState.nodes = [];
  logicState.optimizedText = '';
  logicState.originalText = '';
  document.getElementById('btnOptimizeLogic').style.display = 'none';
  document.getElementById('btnAcceptLogic').style.display = 'none';
  document.getElementById('logicEditor').innerHTML = '<textarea class="doc-input" id="logicInput" placeholder="在此粘贴论文正文..."></textarea>';
  document.getElementById('logicInput').addEventListener('input', () => updateWordCount('logicInput', 'logicWordCount'));
  document.getElementById('logicPanel').innerHTML = '<div class="empty-state"><div class="empty-icon">🧩</div><div class="empty-title">等待分析</div><div class="empty-desc">粘贴论文文本并点击「分析逻辑」</div></div>';
  document.getElementById('logicCount').textContent = '0';
  document.getElementById('logicStatus').textContent = '● 就绪';
  document.getElementById('logicStatus').style.color = 'var(--success)';
}

async function startLogic() {
  // ====== FUTURE: 此处替换为 AIEngine.analyzeLogic() 的 API 调用 ======
  const input = document.getElementById('logicInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('请先输入文本', 'error'); return; }

  const panel = document.getElementById('logicPanel');
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">正在识别论证结构...</div><div class="loading-steps">论点/论据/结论识别 · 层级关系构建 · 逻辑断层检测</div></div>';
  const btn = document.getElementById('btnStartLogic');
  btn.disabled = true; btn.textContent = '分析中...';
  document.getElementById('logicStatus').textContent = '● 分析中...';
  document.getElementById('logicStatus').style.color = 'var(--warning)';

  try {
    logicState.nodes = await AIEngine.analyzeLogic(text);
    logicState.originalText = text;
    renderLogicStructure();
    const warnings = logicState.nodes.filter(n => n.warning).length;
    document.getElementById('logicCount').textContent = warnings;
    document.getElementById('btnOptimizeLogic').style.display = 'inline-flex';
    document.getElementById('btnAcceptLogic').style.display = 'none';
    btn.disabled = false; btn.textContent = '🔍 分析逻辑';
    document.getElementById('logicStatus').textContent = '● 完成 ✓';
    document.getElementById('logicStatus').style.color = 'var(--success)';
    showToast('分析完成，发现 ' + warnings + ' 处逻辑断层', warnings > 0 ? '' : 'success');
  } catch (err) {
    btn.disabled = false; btn.textContent = '🔍 分析逻辑';
    document.getElementById('logicStatus').textContent = '● ' + (err && err.quota ? '额度已用完' : '失败');
    document.getElementById('logicStatus').style.color = 'var(--danger)';
    if (err && err.name === 'AbortError') return;
    if (err && err.quota) { showToast(err.message || '免费额度不足', 'error'); showProUpgrade(); return; }
    showToast(err.message || '分析失败', 'error');
  }
}

function renderLogicStructure() {
  const panel = document.getElementById('logicPanel');
  if (!logicState.nodes.length) { panel.innerHTML = '<div class="empty-state"><div class="empty-icon">🧩</div><div class="empty-title">等待分析</div></div>'; return; }

  const claims = logicState.nodes.filter(n => n.type === 'claim').length;
  const evidence = logicState.nodes.filter(n => n.type === 'evidence').length;
  const conclusions = logicState.nodes.filter(n => n.type === 'conclusion').length;
  const warnings = logicState.nodes.filter(n => n.warning).length;
  const typeClass = { claim: 'ln-claim', evidence: 'ln-evidence', conclusion: 'ln-conclusion', transition: 'ln-transition' };

  let html =
    '<div class="logic-summary-bar">' +
      '<div class="logic-summary-title">📊 论证结构概览</div>' +
      '<div class="logic-summary-stats">' +
        '<span class="logic-stat-pill">论点 <strong>' + claims + '</strong></span>' +
        '<span class="logic-stat-pill">论据 <strong>' + evidence + '</strong></span>' +
        '<span class="logic-stat-pill">结论 <strong>' + conclusions + '</strong></span>' +
        (warnings > 0 ? '<span class="logic-stat-pill" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger);">⚠ 断层 <strong>' + warnings + '</strong></span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="logic-canvas"><div class="logic-tree">';

  logicState.nodes.forEach(node => {
    html +=
      '<div class="logic-node" style="padding-left:' + ((node.level - 1) * 20) + 'px;">' +
        '<div class="logic-node-content ' + (node.warning ? 'has-warning' : '') + '" onclick="highlightLogicPara(' + (node.paraIdx || 0) + ')">' +
          '<div class="logic-node-head">' +
            '<span class="logic-node-type ' + esc(typeClass[node.type] || '') + '">' + esc(node.typeName) + '</span>' +
            '<span class="logic-node-level">L' + node.level + '</span>' +
          '</div>' +
          '<div class="logic-node-text">' + esc(node.text) + '</div>' +
          (node.warning ? '<div class="logic-warning">⚠ ' + esc(node.warning) + '</div>' : '') +
        '</div>' +
      '</div>';
  });

  html +=
      '</div></div>' +
      '<div style="margin:10px;padding:10px;background:var(--brand-bg);border-radius:var(--r-md);">' +
        '<div style="font-size:11px;font-weight:700;color:var(--brand);margin-bottom:4px;">📌 结构重组建议</div>' +
        '<div style="font-size:10px;color:var(--gray-600);line-height:1.7;">' +
          '1. 检查论点之间的逻辑递进关系是否清晰<br>' +
          '2. 确保每个论点都有至少1个论据支撑<br>' +
          '3. 结论应与前述论证形成闭环' +
        '</div>' +
      '</div>';

  panel.innerHTML = html;
}

function highlightLogicPara(idx) {
  // 在编辑器中定位对应段落（可视化提示）
  const input = document.getElementById('logicInput');
  if (input) {
    const paras = input.value.split('\n\n');
    if (idx < paras.length) {
      const pos = input.value.indexOf(paras[idx]);
      if (pos >= 0) input.focus();
      showToast('已定位到段落 ' + (idx + 1), '');
    }
  }
}

function renderLogicIssues() {
  const panel = document.getElementById('logicPanel');
  const issues = logicState.nodes.filter(n => n.warning);
  if (!issues.length) {
    panel.innerHTML = '<div class="empty-state"><div class="empty-icon" style="background:var(--success-bg);">✓</div><div class="empty-title">未发现逻辑问题</div><div class="empty-desc">论证结构清晰，层级关系合理</div></div>';
    return;
  }
  panel.innerHTML = '<div class="suggestion-list">' + issues.map((node, i) =>
    '<div class="suggestion-card" style="border-left:3px solid var(--danger);">' +
      '<div class="sg-header">' +
        '<span class="sg-type-pill" style="background:var(--danger-bg);color:var(--danger);">断层 ' + (i + 1) + '</span>' +
        '<span class="sg-severity">' + esc(node.typeName) + '</span>' +
      '</div>' +
      '<div class="sg-diff" style="border-left-color:var(--danger);">' +
        '<div style="color:var(--gray-700);font-size:12px;margin-bottom:4px;">' + esc(node.text) + '</div>' +
      '</div>' +
      '<div class="sg-reason" style="border-left-color:var(--danger);font-size:11px;">⚠ ' + esc(node.warning) + '</div>' +
    '</div>'
  ).join('') + '</div>';
}

async function optimizeLogic() {
  const input = document.getElementById('logicInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('没有可优化的文本', 'error'); return; }

  const panel = document.getElementById('logicPanel');
  panel.innerHTML = '<div class="loading-state"><div class="spinner"></div><div class="loading-text">正在优化论证结构...</div><div class="loading-steps">分析论证关系 · 重组段落顺序 · 优化衔接过渡</div></div>';
  const btn = document.getElementById('btnOptimizeLogic');
  const btnAccept = document.getElementById('btnAcceptLogic');
  btn.disabled = true; btn.textContent = '优化中...';
  document.getElementById('logicStatus').textContent = '● 优化中...';
  document.getElementById('logicStatus').style.color = 'var(--warning)';

  // 流式显示优化结果（打字机效果），完成后用完整结果渲染。
  // 性能：固定内容节点 + requestAnimationFrame 节流，textContent 增量写入，
  // 避免每个网络增量都整页 innerHTML 重渲染（O(n²) 卡顿）。
  let streamText = '';
  let rafPending = false;
  const editor = document.getElementById('logicEditor');
  if (editor) {
    editor.innerHTML = '<div class="doc-page"><div class="doc-page-title">优化后的论证结构</div>' +
      '<div class="doc-page-content" id="logicStreamBody" style="white-space:pre-wrap;word-break:break-word;"></div></div>';
  }
  const flushStream = () => {
    rafPending = false;
    const bodyEl = document.getElementById('logicStreamBody');
    if (bodyEl) {
      bodyEl.textContent = streamText;
      bodyEl.scrollTop = bodyEl.scrollHeight; // 容器自身可滚时跟随末尾
    }
  };
  let optimizedText;
  try {
    optimizedText = await AIEngine.optimizeLogic(text, {
      onDelta: (d) => {
        streamText += d;
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(flushStream);
        }
      }
    });
  } catch (err) {
    // 复位按钮/状态，并恢复 textarea 编辑模式（避免卡在空 loading）
    btn.disabled = false; btn.textContent = '✨ 优化结构';
    btnAccept.style.display = 'none';
    document.getElementById('logicStatus').textContent = '● ' + (err && err.quota ? '额度已用完' : '优化失败');
    document.getElementById('logicStatus').style.color = 'var(--danger)';
    const le = document.getElementById('logicEditor');
    if (le && input && !le.contains(input)) { le.innerHTML = ''; le.appendChild(input); }
    if (err && err.name === 'AbortError') return;
    if (err && err.quota) { showToast(err.message || '免费额度不足', 'error'); showProUpgrade(); return; }
    showToast(err.message || '优化失败', 'error');
    return;
  }
  logicState.optimizedText = optimizedText;

  // 在编辑器中显示优化结果
  if (editor) {
    editor.innerHTML = '<div class="doc-page"><div class="doc-page-title">优化后的论证结构</div><div class="doc-page-content">' +
    logicState.optimizedText.split('\n\n').filter(p => p.trim()).map(p => {
      const t = p.trim();
      if (t.startsWith('【')) {
        const title = t.match(/【([^】]+)】/);
        const body = t.replace(/【[^】]+】/, '');
        return '<div style="margin-bottom:16px;padding:8px 10px;background:var(--brand-bg);border-radius:var(--r-md);border-left:3px solid var(--brand);">' +
          '<div style="font-size:11px;font-weight:700;color:var(--brand);margin-bottom:4px;">' + esc(title ? title[1] : '') + '</div>' +
          '<p style="margin:0;font-size:14px;line-height:1.8;">' + esc(body.trim()) + '</p>' +
        '</div>';
      }
      return '<p style="margin-bottom:12px;">' + esc(t) + '</p>';
    }).join('') + '</div></div>';
  }

  // 更新侧边面板
  panel.innerHTML =
    '<div style="padding:16px;text-align:center;">' +
      '<div style="font-size:40px;margin-bottom:10px;">✨</div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--gray-800);margin-bottom:6px;">结构优化完成</div>' +
      '<div style="font-size:12px;color:var(--gray-500);margin-bottom:14px;">论证已重组，过渡衔接已优化</div>' +
      '<div style="font-size:11px;color:var(--gray-400);line-height:1.7;text-align:left;background:var(--gray-50);padding:10px;border-radius:var(--r-md);">' +
        '📌 优化内容<br>' +
        '• 论点前置，论据分层支撑<br>' +
        '• 补充过渡句，消除逻辑跳跃<br>' +
        '• 结论与论点形成闭环<br>' +
        '• 段落间增加逻辑连接词' +
      '</div>' +
    '</div>';

  btn.style.display = 'none';
  btnAccept.style.display = 'inline-flex';
  btn.disabled = false; btn.textContent = '✨ 优化结构';
  document.getElementById('logicStatus').textContent = '● 优化完成 ✓';
  document.getElementById('logicStatus').style.color = 'var(--success)';
  showToast('结构优化完成，请预览后接受', 'success');
}

async function acceptLogicOptimize() {
  const input = document.getElementById('logicInput');
  if (!input || !logicState.optimizedText) return;
  // 采纳才计费：接受修改 → 按采纳文本字数计入额度；额度不足则拦截并引导升级 Pro
  if (!(await adoptQuota(logicState.optimizedText.length))) return;
  input.value = logicState.optimizedText;
  updateWordCount('logicInput', 'logicWordCount');
  document.getElementById('btnAcceptLogic').style.display = 'none';
  document.getElementById('btnOptimizeLogic').style.display = 'none';
  // 恢复编辑器为 textarea 模式
  document.getElementById('logicEditor').innerHTML = '';
  document.getElementById('logicEditor').appendChild(input);
  input.focus();
  showToast('已应用优化结果', 'success');
}

