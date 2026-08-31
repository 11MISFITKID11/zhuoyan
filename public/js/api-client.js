/* 琢言 · API 设置与后端 API 客户端（自 app.js 拆分，加载顺序见 index.html） */
/* 琢言 · 主脚本（自 index.html 拆分） */
// ============================================================
// API 设置管理
// ============================================================
// 前端由后端 Express 同源提供，使用相对路径（自动适配备用端口）
const API_BASE = '';

// ============================================================
// HTML 转义：防止 XSS
// ============================================================
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// 后端 API 客户端（JWT 认证）
// ============================================================
const API = {
  async call(method, path, body) {
    const token = localStorage.getItem('zhuoyan_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败 (' + res.status + ')');
    return data;
  },
  auth: {
    login: (email, password) => API.call('POST', '/api/auth/login', { email, password }),
    register: (email, password, securityQuestion, securityAnswer) => API.call('POST', '/api/auth/register', { email, password, securityQuestion, securityAnswer }),
    forgot: (email) => API.call('POST', '/api/auth/forgot', { email }),
    me: () => API.call('GET', '/api/auth/me')
  },
  docs: {
    list: () => API.call('GET', '/api/docs'),
    getContent: (id) => API.call('GET', '/api/docs/' + id + '/content'),
    create: (data) => API.call('POST', '/api/docs', data),
    update: (id, data) => API.call('PUT', '/api/docs/' + id, data),
    delete: (id) => API.call('DELETE', '/api/docs/' + id)
  }
};

let apiSettings = {
  apiKey: '',
  customEndpoint: '',
  model: '',
  hasServerKey: false
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('zhuoyan_api_settings');
    if (saved) Object.assign(apiSettings, JSON.parse(saved));
  } catch (e) {}
  document.getElementById('inputApiKey').value = apiSettings.apiKey || '';
  document.getElementById('inputCustomEndpoint').value = apiSettings.customEndpoint || '';
  document.getElementById('inputModel').value = apiSettings.model || '';
  updateAPIStatus();
  loadUserApiKey();
}

async function saveSettings() {
  apiSettings.apiKey = document.getElementById('inputApiKey').value.trim();
  apiSettings.customEndpoint = document.getElementById('inputCustomEndpoint').value.trim();
  apiSettings.model = document.getElementById('inputModel').value.trim();
  localStorage.setItem('zhuoyan_api_settings', JSON.stringify(apiSettings));
  // 同步 API Key 到服务端（持久化 + 鉴权用）
  if (getToken() && apiSettings.apiKey) {
    try {
      await API.call('PUT', '/api/user/apikey', { apiKey: apiSettings.apiKey });
      apiSettings.hasServerKey = true;  // 立即更新本地状态
    } catch (e) {}
  } else if (getToken() && !apiSettings.apiKey) {
    apiSettings.hasServerKey = false;
  }
  updateAPIStatus();
  hideSettings();
  showToast('API 设置已保存', 'success');
}

async function loadUserApiKey() {
  if (!getToken()) return;
  try {
    const data = await API.call('GET', '/api/user/settings');
    if (data.hasApiKey) {
      // 从服务端读取的 Key 仅用于显示是否已配置，实际调用由服务端从用户记录读取
      apiSettings.hasServerKey = true;
      document.getElementById('inputApiKey').placeholder = '已保存到服务器，重新输入可覆盖';
      updateAPIStatus();
    }
  } catch (e) {}
}

function showSettings() { document.getElementById('settingsOverlay').classList.add('show'); }
function hideSettings() { document.getElementById('settingsOverlay').classList.remove('show'); }

function toggleAPIMode() {
  apiSettings.enabled = !apiSettings.enabled;
  document.getElementById('apiSettingsForm').style.display = apiSettings.enabled ? 'block' : 'none';
  updateToggleUI();
  updateAPIStatus();
  saveSettings();
}

function updateToggleUI() {
  const toggle = document.getElementById('apiToggle');
  const label = document.getElementById('apiToggleLabel');
  const badge = document.getElementById('apiModeBadge');
  const sub = document.getElementById('apiToggleSub');
  if (apiSettings.enabled) {
    toggle.classList.add('active');
    label.textContent = '使用真实 API 调用 AI 模型';
    sub.textContent = '需要配置 API Key，数据直接发送到 AI 服务商';
    badge.textContent = '真实 API';
    badge.className = 'settings-badge on';
    document.getElementById('apiSettingsForm').style.display = 'block';
  } else {
    toggle.classList.remove('active');
    label.textContent = '使用模拟数据（演示模式）';
    sub.textContent = '打开后可配置真实 API Key 调用 AI 模型';
    badge.textContent = '模拟';
    badge.className = 'settings-badge off';
    document.getElementById('apiSettingsForm').style.display = 'none';
  }
}

function updateAPIStatus() {
  const dot = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  if (getToken()) {
    if (apiSettings.hasServerKey) {
      dot.className = 'api-dot green';
      text.textContent = 'API Key 已绑定';
    } else {
      dot.className = 'api-dot yellow';
      text.textContent = '已登录但未配置 API Key — 将使用模拟数据';
    }
  } else {
    dot.className = 'api-dot red';
    text.textContent = '未登录 — 请先登录';
  }
}

function getProviderName(key) {
  const names = { openai: 'OpenAI', deepseek: 'DeepSeek', qwen: '通义千问', anthropic: 'Anthropic', custom: '自定义' };
  return names[key] || key;
}

function markDirty() {} // placeholder for unsaved indicator

