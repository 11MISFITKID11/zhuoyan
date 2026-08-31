/* 琢言 · 认证系统（自 app.js 拆分，加载顺序见 index.html） */
// ============================================================
// 认证系统
// ============================================================
function showAuthForm(form) {
  document.querySelectorAll('.auth-form-inner').forEach(f => f.classList.remove('active'));
  document.getElementById('authForm' + form.charAt(0).toUpperCase() + form.slice(1)).classList.add('active');
  document.querySelectorAll('.auth-error, .auth-success').forEach(e => e.style.display = 'none');
}

function storeToken(token) {
  if (token) localStorage.setItem('zhuoyan_token', token);
  else localStorage.removeItem('zhuoyan_token');
}
function getToken() { return localStorage.getItem('zhuoyan_token'); }

async function checkAuth() {
  const token = getToken();
  if (!token) { document.getElementById('authOverlay').classList.remove('hidden'); return; }
  try {
    const data = await API.auth.me();
    if (data.user) {
      document.getElementById('authOverlay').classList.add('hidden');
      document.getElementById('authAvatar').textContent = data.user.email.charAt(0).toUpperCase();
      // 加载当前用户的独立 API 设置（非共用 localStorage）
      apiSettings.hasServerKey = false;
      apiSettings.apiKey = '';
      await loadUserApiKey();
      updateAPIStatus();
      await fetchDocsFromServer();
    }
  } catch (e) {
    storeToken(null);
    document.getElementById('authOverlay').classList.remove('hidden');
  }
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!email || !pwd) { errEl.textContent = '请填写邮箱和密码'; errEl.style.display = 'block'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = '邮箱格式不正确'; errEl.style.display = 'block'; return; }
  if (pwd.length < 8) { errEl.textContent = '密码至少8位'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  btn.textContent = '登录中...';

  try {
    const data = await API.auth.login(email, pwd);
    storeToken(data.token);
    document.getElementById('loginPassword').value = '';
    errEl.textContent = '';
    errEl.style.display = 'none';
    await checkAuth();
    showToast('欢迎回来，' + email, 'success');
  } catch (err) {
    if (err.message.includes('423')) {
      const match = err.message.match(/锁定 (\d+) 分钟/);
      errEl.textContent = match ? `账号已锁定，请 ${match[1]} 分钟后再试` : '账号已被锁定';
    } else {
      errEl.textContent = err.message.replace('Error: ', '');
    }
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
  }
}

async function doRegister() {
  const email = document.getElementById('regEmail').value.trim();
  const pwd = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  const sq = document.getElementById('regSecurityQuestion').value.trim();
  const sa = document.getElementById('regSecurityAnswer').value.trim();
  const errEl = document.getElementById('registerError');

  if (!email || !pwd || !confirm) { errEl.textContent = '请填写所有字段'; errEl.style.display = 'block'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = '邮箱格式不正确'; errEl.style.display = 'block'; return; }
  if (pwd.length < 8) { errEl.textContent = '密码至少8位'; errEl.style.display = 'block'; return; }
  if (pwd !== confirm) { errEl.textContent = '两次密码输入不一致'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  btn.textContent = '注册中...';

  try {
    const data = await API.auth.register(email, pwd, sq, sa);
    storeToken(data.token);
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('regConfirm').value = '';
    document.getElementById('regSecurityQuestion').value = '';
    document.getElementById('regSecurityAnswer').value = '';
    errEl.textContent = '';
    errEl.style.display = 'none';
    await checkAuth();
    showToast('注册成功，欢迎使用琢言！', 'success');
  } catch (err) {
    errEl.textContent = err.message.replace('Error: ', '');
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '注 册';
  }
}

// 忘记密码：两步流程
let forgotEmail = '';

async function doForgotStep1() {
  const email = document.getElementById('forgotEmail').value.trim();
  const errEl = document.getElementById('forgotError');
  const sucEl = document.getElementById('forgotSuccess');
  sucEl.style.display = 'none';
  if (!email) { errEl.textContent = '请输入邮箱地址'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('forgotBtn');
  btn.textContent = '验证中...'; btn.disabled = true;
  try {
    const data = await API.auth.forgot(email);
    if (data.needSecurityQuestion) {
      // 显示安全问题
      forgotEmail = email;
      document.getElementById('forgotSecurityQuestion').value = '❓ ' + data.question;
      document.getElementById('forgotSecuritySection').style.display = 'block';
      btn.textContent = '重置密码';
      btn.onclick = doForgotStep2;
      errEl.style.display = 'none';
    } else {
      errEl.style.display = 'none';
      sucEl.textContent = data.message || '密码已重置'; sucEl.style.display = 'block';
      btn.textContent = '完成'; btn.disabled = false;
    }
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
    btn.textContent = '下一步'; btn.disabled = false;
  }
}

async function doForgotStep2() {
  const answer = document.getElementById('forgotSecurityAnswer').value.trim();
  const newPwd = document.getElementById('forgotNewPassword').value;
  const errEl = document.getElementById('forgotError');
  const sucEl = document.getElementById('forgotSuccess');
  sucEl.style.display = 'none';
  if (!answer) { errEl.textContent = '请回答安全问题'; errEl.style.display = 'block'; return; }
  if (!newPwd || newPwd.length < 8) { errEl.textContent = '密码至少8位'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('forgotBtn');
  btn.textContent = '重置中...'; btn.disabled = true;
  try {
    const data = await API.call('POST', '/api/auth/forgot', { email: forgotEmail, securityAnswer: answer, newPassword: newPwd });
    errEl.style.display = 'none';
    sucEl.textContent = data.message + '，请用新密码登录'; sucEl.style.display = 'block';
    // 重置表单
    document.getElementById('forgotSecuritySection').style.display = 'none';
    document.getElementById('forgotSecurityAnswer').value = '';
    document.getElementById('forgotNewPassword').value = '';
    btn.textContent = '下一步'; btn.onclick = doForgotStep1;
    btn.disabled = false;
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
    btn.textContent = '重置密码'; btn.disabled = false;
  }
}

function doLogout() {
  storeToken(null);
  documents.length = 0;
  apiSettings.hasServerKey = false;  // 清除用户 API 状态
  apiSettings.apiKey = '';
  renderDocList(); renderWsRecent(); updateStats();
  checkAuth();
  showToast('已退出登录', '');
}

function showProUpgrade() { document.getElementById('proOverlay').classList.add('show'); }
function closePro() { document.getElementById('proOverlay').classList.remove('show'); document.getElementById('paymentOverlay').classList.remove('show'); }
function showPayment() { closePro(); document.getElementById('paymentOverlay').classList.add('show'); }
async function confirmPayment() {
  const btn = document.querySelector('#paymentOverlay .pro-btn');
  btn.textContent = '处理中...'; btn.disabled = true;
  try {
    await API.call('POST', '/api/upgrade', { plan: 'pro' });
    document.getElementById('paymentOverlay').classList.remove('show');
    showToast('🎉 恭喜升级为 Pro 会员！', 'success');
    const data = await API.call('GET', '/api/usage');
    if (data) {
      document.getElementById('quotaFill').style.width = '0%';
      document.getElementById('quotaText').textContent = data.used + ' / ∞';
      document.getElementById('quotaHint').innerHTML = '⭐ Pro 会员 · 无限制';
    }
  } catch (e) { showToast('升级失败: ' + e.message, 'error'); }
  btn.textContent = '确认支付 ¥29/月'; btn.disabled = false;
}

