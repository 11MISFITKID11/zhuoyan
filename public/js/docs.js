/* 琢言 · 文档持久化与文档列表（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 文档持久化
// ============================================================
// ============================================================
// 远程文档 API（JWT 认证，按用户隔离）
// ============================================================
async function fetchDocsFromServer() {
  try {
    const data = await API.docs.list();
    documents.length = 0;
    if (data.docs) documents.push(...data.docs);
    if (documents.length > 0) {
      docIdCounter = Math.max(...documents.map(d => d.id)) + 1;
    } else {
      docIdCounter = 0;
    }
  } catch (e) {
    // 离线时使用本地缓存
    try {
      const cached = localStorage.getItem('zhuoyan_docs_backup');
      if (cached) { documents.length = 0; documents.push(...JSON.parse(cached)); }
    } catch(e2) {}
  }
  renderDocList();
  renderWsRecent();
  updateStats();
}

async function saveDocToServer(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  try {
    await API.docs.update(id, { title: doc.title, type: doc.type, words: doc.words, status: doc.status });
  } catch (e) { /* 静默失败 */ }
}

async function saveContentToServer(id, content) {
  try {
    await API.docs.update(id, { content });
  } catch (e) {}
}

async function loadContentFromServer(id) {
  try {
    const data = await API.docs.getContent(id);
    return data.content || '';
  } catch (e) { return ''; }
}

function backupDocsLocal() {
  try { localStorage.setItem('zhuoyan_docs_backup', JSON.stringify(documents)); } catch(e) {}
}

const typeIcons = { polish: '✍️', logic: '🧩', aigc: '🛡️' };
const typeLabels = { polish: '润色', logic: '逻辑', aigc: 'AIGC' };

const samplePolishText = `通过对于该问题的深入研究，从而可以使得我们更好地理解深度学习模型的工作原理。在本文中，我们对于卷积神经网络在图像识别领域的应用进行了研究，并且得出了以下结论。

首先，CNN模型在ImageNet数据集上的准确率达到了95.6%，这个结果比传统方法好了很多。其次，我们发现使用残差连接可以使得训练更加稳定，从而可以使得模型的性能进一步提升。

另外，ML和机器学习这两个术语在本文中被交替使用。人工神经网络和神经网络也指代相同的概念。

总的来说，通过本研究的实验，我们可以看出深度学习在计算机视觉领域有着很大的潜力，未来可能会有更多的应用场景。`;

const sampleLogicText = `本文研究深度学习在医学图像诊断中的应用。卷积神经网络在ImageNet数据集上准确率达95.6%。残差连接显著提升了模型训练稳定性。因此，深度学习在医学影像分析中具有巨大潜力。

医学影像数据量大、标注成本高。迁移学习可有效缓解小样本问题。预训练模型在医学数据上微调后准确率提升12%。然而，当前方法在罕见病变识别上仍有不足。

本研究提出了基于注意力机制的改进方案。实验验证该方法在3类罕见病变上F1提升8.3%。说明注意力机制有效提升了模型的特征提取能力。`;

const sampleAIGCText = `随着人工智能技术的快速发展，深度学习在各个领域取得了显著的成果。特别是在计算机视觉、自然语言处理和语音识别等方面，深度学习模型已经达到了甚至超越了人类的表现水平。

本文基于ResNet-50网络结构，在ImageNet数据集上进行了实验。实验结果表明，模型在测试集上的Top-1准确率达到95.6%，较基线方法提升了3.2个百分点。

这个结果其实挺不错的，比我们预期的要好。我觉得主要原因是加了残差连接以后梯度能更好地传播。

综上所述，深度学习技术在医学图像分析领域展现出了巨大的应用潜力和广阔的发展前景。未来，随着算法的不断优化和计算能力的持续提升，该技术有望在临床诊断中发挥更加重要的作用。

实验中我们还发现，当学习率设置为0.001时，模型收敛速度最快。batch size为64时GPU利用率最高。`;


// ============================================================
// 文档列表
// ============================================================
function renderDocList(filter) {
  const list = document.getElementById('docList');
  const items = filter ? documents.filter(d => d.title.includes(filter)) : documents;
  list.innerHTML = items.map(doc => `
    <div class="doc-item" data-id="${doc.id}" onclick="selectDoc(${doc.id})">
      <div class="doc-icon ${esc(doc.type)}">${typeIcons[doc.type]}</div>
      <div class="doc-info">
        <div class="doc-title" id="docTitle-${doc.id}">${esc(doc.title)}</div>
        <div class="doc-meta"><span>${esc(doc.date)}</span><span class="doc-meta-dot">·</span><span>${doc.words.toLocaleString()}字</span></div>
      </div>
      <div style="display:flex;gap:8px;position:absolute;right:6px;top:50%;transform:translateY(-50%);">
        <button class="doc-rename-btn" onclick="event.stopPropagation();renameDocument(${doc.id})" title="重命名">✏️</button>
        <button class="doc-del-btn" onclick="event.stopPropagation();deleteDocument(${doc.id})" title="删除文档">🗑️</button>
      </div>
    </div>
  `).join('');
}

function renderWsRecent() {
  const list = document.getElementById('wsRecent');
  list.innerHTML = documents.slice(0, 5).map(doc => `
    <div class="ws-recent-item" onclick="selectDoc(${doc.id})">
      <div class="ws-recent-icon" style="background: var(--${doc.type === 'polish' ? 'clarity' : doc.type === 'logic' ? 'term' : 'danger'}-bg); color: var(--${doc.type === 'polish' ? 'clarity' : doc.type === 'logic' ? 'term' : 'danger'});">${typeIcons[doc.type]}</div>
      <div class="ws-recent-info">
        <div class="ws-recent-name">${esc(doc.title)}</div>
        <div class="ws-recent-meta">${esc(doc.date)} · ${doc.words.toLocaleString()}字 · ${esc(typeLabels[doc.type] || '')}</div>
      </div>
      <span class="badge ${doc.status === '已完成' ? 'badge-success' : 'badge-warning'}">${esc(doc.status)}</span>
    </div>
  `).join('');
}

async function selectDoc(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  currentDocId = id;
  document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
  document.querySelector('.doc-item[data-id="' + id + '"]').classList.add('active');
  switchView(doc.type);
  const content = await loadContentFromServer(id);
  if (doc.type === 'polish') {
    clearPolish();
    document.getElementById('polishDocName').textContent = doc.title;
    const input = document.getElementById('polishInput');
    if (input && content) { input.value = content; updateWordCount('polishInput', 'polishWordCount'); }
  } else if (doc.type === 'logic') {
    clearLogic();
    const input = document.getElementById('logicInput');
    if (input && content) { input.value = content; updateWordCount('logicInput', 'logicWordCount'); }
  } else if (doc.type === 'aigc') {
    clearAIGC();
    const input = document.getElementById('aigcInput');
    if (input && content) { input.value = content; updateWordCount('aigcInput', 'aigcWordCount'); }
  }
  showToast('已打开「' + doc.title + '」', 'success');
}

function newDocument() {
  document.getElementById('newdocOverlay').classList.add('show');
}

function hideNewDoc() {
  document.getElementById('newdocOverlay').classList.remove('show');
}

async function createDocument(type) {
  const titles = { polish: '新建润色文档_', logic: '新建逻辑文档_', aigc: '新建AIGC文档_' };
  let doc = { title: titles[type] + (++docIdCounter), type, content: '' };
  try {
    const data = await API.docs.create(doc);
    if (data.doc) doc = data.doc;
  } catch (e) { /* 离线创建 */ }
  doc.id = doc.id || docIdCounter;
  doc.date = doc.date || '刚刚';
  doc.words = doc.words || 0;
  doc.status = doc.status || '草稿';
  documents.unshift(doc);
  // 更新 docIdCounter
  if (doc.id >= docIdCounter) docIdCounter = doc.id + 1;
  currentDocId = doc.id;
  backupDocsLocal();
  hideNewDoc();
  renderDocList();
  renderWsRecent();
  switchView(type);
  if (type === 'polish') { clearPolish(); document.getElementById('polishDocName').textContent = doc.title; }
  else if (type === 'logic') clearLogic();
  else if (type === 'aigc') clearAIGC();
  updateStats();
  document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector('.doc-item[data-id="' + doc.id + '"]');
  if (el) el.classList.add('active');
  showToast('已创建' + (type === 'polish' ? '润色' : type === 'logic' ? '逻辑' : 'AIGC') + '文档', 'success');
}

async function deleteDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  if (!confirm('确认删除「' + doc.title + '」？')) return;
  try { await API.docs.delete(id); } catch (e) {}
  const idx = documents.findIndex(d => d.id === id);
  if (idx >= 0) documents.splice(idx, 1);
  if (currentDocId === id) currentDocId = null;
  backupDocsLocal();
  renderDocList();
  renderWsRecent();
  updateStats();
  showToast('已删除「' + doc.title + '」', '');
}

async function renameDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  const newName = prompt('重命名文档：', doc.title);
  if (!newName || newName.trim() === '' || newName === doc.title) return;
  doc.title = newName.trim();
  try { await API.docs.update(id, { title: doc.title }); } catch (e) {}
  backupDocsLocal();
  renderDocList();
  renderWsRecent();
  showToast('已重命名为「' + doc.title + '」', 'success');
}

function filterDocs(val) {
  renderDocList(val);
}

async function saveAsDoc(module) {
  const labels = { polish: '润色', logic: '逻辑', aigc: 'AIGC检测' };
  const inputMap = { polish: 'polishInput', logic: 'logicInput', aigc: 'aigcInput' };
  const input = document.getElementById(inputMap[module]);
  const text = module === 'aigc'
    ? ((input && input.value.trim()) ? input.value : (aigcOriginalText || ''))
    : (module === 'polish' ? (polishState.currentText || (input ? input.value : ''))
      : ((input && input.value.trim()) ? input.value : (logicState.optimizedText || '')));
  if (!text.trim()) { showToast('没有内容可保存', 'error'); return; }

  if (currentDocId) {
    const doc = documents.find(d => d.id === currentDocId);
    if (doc) {
      doc.words = text.length;
      doc.date = '刚刚';
      doc.status = '已保存';
      doc.type = module;
      // 保存到服务器
      await Promise.all([
        saveDocToServer(currentDocId),
        saveContentToServer(currentDocId, text)
      ]);
      backupDocsLocal();
      renderDocList();
      renderWsRecent();
      updateStats();
      document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
      const el = document.querySelector('.doc-item[data-id="' + currentDocId + '"]');
      if (el) el.classList.add('active');
      showToast('已保存到「' + doc.title + '」', 'success');
      return;
    }
  }

  // 新建保存
  const data = await API.docs.create({ title: labels[module] + '_' + Date.now(), type: module, content: text });
  const id = data.doc ? data.doc.id : ++docIdCounter;
  currentDocId = id;
  const doc = { id, title: data.doc ? data.doc.title : (labels[module] + '_' + id), date: '刚刚', words: text.length, type: module, status: '已保存' };
  documents.unshift(doc);
  await saveContentToServer(id, text);
  backupDocsLocal();
  renderDocList();
  renderWsRecent();
  updateStats();
  document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector('.doc-item[data-id="' + id + '"]');
  if (el) el.classList.add('active');
  showToast('已保存为「' + doc.title + '」', 'success');
}

function exportDoc(module) {
  const labels = { polish: '润色', logic: '逻辑', aigc: 'AIGC检测' };
  const inputMap = { polish: 'polishInput', logic: 'logicInput', aigc: 'aigcInput' };
  const input = document.getElementById(inputMap[module]);
  // 逻辑优化预览态（doc-page）textarea 已移出 DOM：兜底取优化结果
  const text = module === 'logic'
    ? ((input && input.value.trim()) ? input.value : (logicState.optimizedText || ''))
    : (module === 'polish' ? (polishState.currentText || (input ? input.value : '')) : (input ? input.value : ''));
  if (!text.trim()) { showToast('没有内容可导出', 'error'); return; }

  const date = new Date();
  const filename = '琢言_' + labels[module] + '_' + date.getFullYear() +
    String(date.getMonth()+1).padStart(2,'0') + String(date.getDate()).padStart(2,'0') + '.txt';

  // 构建导出内容
  let content = '';
  if (module === 'polish') {
    content = '=== 琢言 · 学术润色结果 ===\n\n';
    content += text + '\n\n';
    content += '--- 修改建议 ---\n';
    polishState.suggestions.forEach((s, i) => {
      const accepted = document.querySelector('span.accepted-replacement[data-sid="' + s.id + '"]');
      content += (i+1) + '. [' + s.typeName + '] ' + s.severity + '优先级\n';
      content += '   原文: ' + s.old + '\n';
      content += '   改为: ' + s.new + '\n';
      content += '   理由: ' + s.reason + '\n';
      content += '   状态: ' + (accepted ? '✓ 已采纳' : (document.querySelector('mark.hl[data-sid="' + s.id + '"]')?.classList.contains('dismissed') ? '✗ 已忽略' : '— 待处理')) + '\n\n';
    });
  } else if (module === 'logic') {
    content = '=== 琢言 · 逻辑优化结果 ===\n\n';
    content += '--- 原文 ---\n' + text + '\n\n';
    content += '--- 论证结构 ---\n';
    if (logicState.nodes && logicState.nodes.length) {
      logicState.nodes.forEach((n, i) => {
        content += (i+1) + '. [' + n.typeName + '] L' + n.level + ' ' + n.text + '\n';
        if (n.warning) content += '   ⚠ ' + n.warning + '\n';
      });
    } else {
      content += '（尚未分析）\n';
    }
  } else if (module === 'aigc') {
    content = '=== 琢言 · AIGC 检测报告 ===\n\n';
    content += '--- 检测文本 ---\n' + text + '\n\n';
    content += '--- 段落分析 ---\n';
    if (aigcDetectionData && aigcDetectionData.length) {
      aigcDetectionData.forEach((p, i) => {
        const inHistory = aigcRewriteHistory.find(h => h.paraIdx === i);
        content += (i+1) + '. AI率 ' + Math.round(p.aiRate * 100) + '% | ' + getRiskName(p.aiRate) + '\n';
        content += '   ' + (inHistory ? inHistory.rewrittenText : p.text).substring(0, 80) + '...\n';
      });
    } else {
      content += '（尚未检测）\n';
    }
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已导出 ' + filename, 'success');
}

