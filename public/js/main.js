/* 琢言 · 初始化与全局事件（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 初始化
// ============================================================
document.addEventListener('input', function(e) {
  if (e.target.id === 'polishInput') updateWordCount('polishInput', 'polishWordCount');
  if (e.target.id === 'logicInput') updateWordCount('logicInput', 'logicWordCount');
  if (e.target.id === 'aigcInput') updateWordCount('aigcInput', 'aigcWordCount');
});

// 每次刷新重置会话计数器
polishState.acceptedCount = 0;
polishState.dismissedCount = 0;

loadSettings();
checkAuth();  // checkAuth 内部会调用 fetchDocsFromServer 加载文档
renderDocList();
renderWsRecent();
updateStats();
// 加载配额：免费 3000 字 / BYOK 无限
setTimeout(async () => {
  const today = new Date().toISOString().split('T')[0];
  let localCount = 0;
  try { const q = JSON.parse(localStorage.getItem('zhuoyan_local_quota') || '{}'); if (q.date === today) localCount = q.count || 0; } catch(e) {}
  document.getElementById('quotaFill').style.width = '0%';
  document.getElementById('quotaText').textContent = localCount.toLocaleString() + ' / ∞';
  if (getToken()) {
    try {
      const data = await API.call('GET', '/api/usage');
      if (data) {
        quotaCache = { used: data.used || 0, limit: data.limit || 3000, plan: data.plan || 'free' };
        const limitStr = data.limit >= 999999 ? '∞' : data.limit.toLocaleString();
        document.getElementById('quotaText').textContent = data.used.toLocaleString() + ' / ' + limitStr;
        if (data.plan === 'pro') {
          document.getElementById('quotaFill').style.width = '0%';
          document.getElementById('quotaHint').textContent = '⭐ Pro 会员 · 无限制';
          return;
        }
        const pct = Math.min(100, (data.used / data.limit) * 100);
        document.getElementById('quotaFill').style.width = pct + '%';
        document.getElementById('quotaHint').innerHTML = '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 使用 AI · 每日 3,000 字 · <a onclick="showProUpgrade()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">升级 Pro</a>';
        return;
      }
    } catch(e) {}
  }
  document.getElementById('quotaFill').style.width = '0%';
  document.getElementById('quotaText').textContent = localCount.toLocaleString() + ' / 3,000';
  document.getElementById('quotaHint').innerHTML = '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 解锁限制';
}, 500);
