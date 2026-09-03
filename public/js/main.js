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

// ============================================================
// 左下角配额条显示口径：
//   - Pro 会员：不计数、无上限 —— 只显示「无限」，不展示已用数字
//   - 免费用户：显示 已用 / 每日可采纳上限（3,000 字），超限变红并引导升级
//   - 未登录：读 localStorage 本地演示计数（每日 3,000）
// ============================================================

// 纯本地渲染（不发请求）：数据源为 quotaCache；未登录时从 localStorage 读演示计数。
// refreshQuota 拉完接口后调用它；adoptQuota 采纳时本地改 quotaCache 后也调用它，
// 保证「接受几个字，左下角立刻 + 几个字」，无需等待网络往返。
function renderQuota() {
  const fill = document.getElementById('quotaFill');
  const text = document.getElementById('quotaText');
  const hint = document.getElementById('quotaHint');
  if (!fill || !text || !hint) return;
  if (!getToken()) {
    const today = new Date().toISOString().split('T')[0];
    let q = { date: '', count: 0 };
    try { q = JSON.parse(localStorage.getItem('zhuoyan_local_quota') || '{}'); } catch (e) {}
    const count = q.date === today ? (q.count || 0) : 0;
    fill.style.width = '0%';
    fill.style.background = '';
    text.textContent = count.toLocaleString() + ' / 3,000';
    hint.innerHTML = '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 解锁限制';
    return;
  }
  const used = quotaCache.used || 0;
  const limit = quotaCache.limit || 3000;
  const plan = quotaCache.plan || 'free';
  if (plan === 'pro') {
    // Pro 会员：无计数、无限制 —— 不显示 used 数字，直接「无限」
    fill.style.width = '0%';
    fill.style.background = '';
    text.textContent = '无限';
    hint.textContent = '⭐ Pro 会员 · 无限制';
    return;
  }
  const exceeded = used >= limit;
  fill.style.width = (limit > 0 ? Math.min(100, (used / limit) * 100) : 0) + '%';
  fill.style.background = exceeded ? 'var(--danger, #ef4444)' : '';
  text.textContent = used.toLocaleString() + ' / ' + limit.toLocaleString();
  hint.innerHTML = exceeded
    ? '⛔ 今日免费额度已用尽 · <a onclick="showProUpgrade()" style="color:var(--brand);cursor:pointer;text-decoration:underline;font-weight:700;">立即升级 Pro</a>'
    : '⚙️ <a onclick="showSettings()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">配置 API Key</a> 使用 AI · 每日可采纳 ' + limit.toLocaleString() + ' 字 · <a onclick="showProUpgrade()" style="color:var(--brand);cursor:pointer;text-decoration:underline;">升级 Pro</a>';
}

// 拉取 /api/usage 刷新 quotaCache 后本地渲染；refreshQuota 也由各功能「调用成功后」触发，
// 保证左下角显示 = 后端实际扣费。采纳计费的即时刷新不走网络（乐观更新），见 adoptQuota。
async function refreshQuota() {
  if (!getToken()) { renderQuota(); return; }
  try {
    const data = await API.call('GET', '/api/usage');
    if (data) quotaCache = { used: data.used || 0, limit: data.limit || 3000, plan: data.plan || 'free' };
  } catch (e) {}
  renderQuota();
}

// ============================================================
// 采纳/撤销采纳 AI 修改 → 同步每日额度（配额唯一计费口径）
// 规则：分析/生成过程不计费；只有「接受修改」才按采纳内容字数增加；
//       「不做修改」额度不变；撤销采纳（undo）传负数退回。
// 免费用户：本地乐观 +delta 并即时渲染（接受几个字，左下角立刻 + 几个字），
//           接口返回后校准；超出每日限额时本地即拦截并弹出升级 Pro 引导（后端 429 兜底）。
// Pro 会员：不计数、无限制，直接放行（左下角显示「无限」，不参与计数）。
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
    renderQuota();
    return true;
  }
  const isPro = quotaCache.plan === 'pro';
  // 免费用户：乐观本地累加并即时渲染；Pro 不计数，跳过
  if (!isPro) {
    const limit = quotaCache.limit || 3000;
    const next = Math.max(0, (quotaCache.used || 0) + delta);
    if (delta > 0 && next > limit) {
      showToast('今日免费额度不足（每日 ' + limit.toLocaleString() + ' 字），请升级 Pro 后继续', 'error');
      showProUpgrade();
      return false;
    }
    quotaCache.used = next;
    renderQuota();
  }
  try {
    const data = await API.call('POST', '/api/usage/adopt', { delta });
    if (data) quotaCache = { used: data.used || 0, limit: data.limit || 3000, plan: data.plan || 'free' };
  } catch (err) {
    const msg = (err && err.message) || '';
    if (msg.indexOf('QUOTA_EXCEEDED') >= 0 || msg.indexOf('额度') >= 0) {
      // 后端判定超限：回滚乐观值后引导升级
      if (!isPro) { quotaCache.used = Math.max(0, (quotaCache.used || 0) - delta); }
      renderQuota();
      showToast('今日免费额度不足，请升级 Pro 后继续', 'error');
      showProUpgrade();
      return false;
    }
    // 网络等异常：不阻断采纳，但回滚本地乐观值，保持与后端一致（下次 refreshQuota 校准）
    if (!isPro) { quotaCache.used = Math.max(0, (quotaCache.used || 0) - delta); }
  }
  renderQuota();
  return true;
}
