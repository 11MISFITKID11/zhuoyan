/* 琢言 · 工具函数与字数统计（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 工具函数
// ============================================================
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 4); }

let importTargetModule = 'polish';

function importWord(module) {
  importTargetModule = module;
  document.getElementById('wordFileInput').click();
}

function handleWordImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.name.endsWith('.docx')) {
    showToast('请选择 .docx 格式的 Word 文档', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const arrayBuffer = e.target.result;
    try {
      if (typeof mammoth === 'undefined' || !mammoth.extractRawText) {
        showToast('Word 解析组件加载失败，请刷新页面后重试', 'error');
        return;
      }
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      const text = result.value.trim();
      if (!text) {
        showToast('未能从文档中提取到文本', 'error');
        return;
      }

      const module = importTargetModule;
      if (module === 'polish') {
        clearPolish();
        const polishInput = document.getElementById('polishInput');
        if (polishInput) {
          polishInput.value = text;
          updateWordCount('polishInput', 'polishWordCount');
        }
      } else if (module === 'logic') {
        clearLogic();
        const logicInput = document.getElementById('logicInput');
        if (logicInput) {
          logicInput.value = text;
          updateWordCount('logicInput', 'logicWordCount');
        }
      } else if (module === 'aigc') {
        clearAIGC();
        const aigcInput = document.getElementById('aigcInput');
        if (aigcInput) {
          aigcInput.value = text;
          updateWordCount('aigcInput', 'aigcWordCount');
        }
      } else if (module === 'agent') {
        clearAgent();
        const agentInput = document.getElementById('agentInput');
        if (agentInput) {
          agentInput.value = text;
          updateWordCount('agentInput', 'agentWordCount');
        }
      }

      showToast('已导入「' + file.name + '」（' + text.length + '字）', 'success');
    } catch (err) {
      showToast('解析 Word 文档失败: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelector('.nav-tab[data-view="' + view + '"]').classList.add('active');
  if (view !== 'workspace') document.getElementById('btnAcceptAll').style.display = 'none';
}

function switchPanel(view, panel) {
  document.querySelectorAll('#view-' + view + ' .panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('#view-' + view + ' .panel-tab[data-panel="' + panel + '"]').classList.add('active');
  if (view === 'polish') {
    if (panel === 'suggestions') renderPolishSuggestions();
    else renderPolishSummary();
  } else if (view === 'logic') {
    if (panel === 'structure') renderLogicStructure();
    else renderLogicIssues();
  } else if (view === 'aigc') {
    if (panel === 'report') renderAIGCReport();
    else renderAIGCParagraphs();
  } else if (view === 'agent') {
    renderAgentPanel(panel);
  }
}

function showToast(msg, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + (type || '');
  toast.innerHTML = (type === 'success' ? '✓ ' : type === 'error' ? '⚠ ' : 'ℹ ') + esc(msg);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(120%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function updateStats() {
  // 统计面板已移除，仅保留左下角额度由服务端控制
}


// ============================================================
// 字数统计
// ============================================================
function updateWordCount(inputId, counterId) {
  const ta = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  const count = ta ? ta.value.length : 0;
  if (counter) counter.textContent = count.toLocaleString() + ' 字';
}

