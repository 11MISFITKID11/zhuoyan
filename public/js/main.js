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
// 加载配额：免费每日 N 字（.env FREE_QUOTA）/ Pro 无限
// refreshQuota 也由各功能「调用成功后」触发，保证左下角显示 = 后端实际扣费，二者始终一致
setTimeout(refreshQuota, 500);

// 拉取 /api/usage 并刷新左下角配额条 + 前端 quotaCache（供入口上限预检与采纳计费刷新）
async function refreshQuota() {
  const today = new Date().toISOString().split('T')[0];
  let localCount = 0;
  try { const q = JSON.parse(localStorage.getItem('zhuoyan_local_quota') || '{}'); if (q.date === today) localCount = q.count || 0; } catch (e) {}
  const fill = document.getElementById('quotaFill');
  const text = document.getElementById('quotaText');
  const hint = document.getElementById('quotaHint');
  if (!fill || !text || !hint) return;
  fill.style.width = '0%';
  fill.style.background = '';
  if (!getToken()) {
    // 未登录：显示本地演示计数，配置 API Key 解锁
    text.textContent = localCount.toLocaleString() + ' / 3,000';
    hint.innerHTML = '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 解锁限制';
    return;
  }
  try {
    const data = await API.call('GET', '/api/usage');
    if (!data) return;
    quotaCache = { used: data.used || 0, limit: data.limit || 3000, plan: data.plan || 'free' };
    const limitStr = data.limit >= 999999 ? '∞' : data.limit.toLocaleString();
    text.textContent = data.used.toLocaleString() + ' / ' + limitStr;
    if (data.plan === 'pro') {
      fill.style.width = '0%';
      hint.textContent = '⭐ Pro 会员 · 无限制';
      return;
    }
    const exceeded = data.used >= data.limit;
    fill.style.width = (data.limit > 0 ? Math.min(100, (data.used / data.limit) * 100) : 0) + '%';
    if (exceeded) fill.style.background = 'var(--danger, #ef4444)';
    hint.innerHTML = exceeded
      ? '⛔ 今日免费额度已用尽 · <a onclick="showProUpgrade()" style="color:var(--brand);cursor:pointer;text-decoration:underline;font-weight:700;">立即升级 Pro</a>'
      : '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 使用 AI · 每日可采纳 ' + limitStr + ' 字 · <a onclick="showProUpgrade()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">升级 Pro</a>';
  } catch (e) {}
}

// ============================================================
// 采纳/撤销采纳 AI 修改 → 同步每日额度（配额唯一计费口径）
// 规则：分析/生成过程不计费；只有「接受修改」才按采纳内容字数增加；
//       「不做修改」额度不变；撤销采纳（undo）传负数退回。
// 免费用户超出每日限额时返回 false 并弹出升级 Pro 引导（后端 429 兜底）。
// ============================================================
async function adoptQuota(delta) {
  delta = Math.trunc(Number(delta) || 0);
  if (!delta) return true;
  if (!getToken()) {
    // 纯演示（未登录）：写入 localStorage 本地计数，口径与后端一致（每日 3,000）
    const today = new Date().toISOString().split('T')[0];
    let q = { date: today, count: 0 };
    try { q = JSON.parse(localStorage.getItem('zhuoyan_local_quota') || '{}'); } catch (e) {}
    if (q.date !== today) q = { date: today, count: 0 };
    const used = q.count || 0;
    if (delta > 0 && used + delta > 3000) {
      showToast('免费演示额度不足（每日 3,000 字），请注册并升级 Pro', 'error');
      showProUpgrade();
      return false;
    }
    q.count = Math.max(0, used + delta);
    localStorage.setItem('zhuoyan_local_quota', JSON.stringify(q));
    refreshQuota();
    return true;
  }
  try {
    const data = await API.call('POST', '/api/usage/adopt', { delta });
    if (data) quotaCache = { used: data.used || 0, limit: data.limit || 3000, plan: data.plan || 'free' };
    refreshQuota();
    return true;
  } catch (err) {
    const msg = (err && err.message) || '';
    if (msg.indexOf('QUOTA_EXCEEDED') >= 0 || msg.indexOf('额度') >= 0) {
      showToast('今日免费额度不足，请升级 Pro 后继续', 'error');
      showProUpgrade();
      refreshQuota();
      return false;
    }
    refreshQuota(); // 网络等异常不阻断采纳，仅刷新显示
    return true;
  }
}
