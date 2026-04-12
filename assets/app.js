(() => {
  const rawPath = window.location.pathname;
  const path = decodeURIComponent(rawPath);

  function buildHttpUrlFromFile() {
    const decodedPath = decodeURIComponent(path).replace(/^\/+/, '');
    const htdocsMarker = 'xampp/htdocs/';
    const markerIndex = decodedPath.toLowerCase().indexOf(htdocsMarker);

    if (markerIndex === -1) {
      return null;
    }

    const relativePath = decodedPath.slice(markerIndex + htdocsMarker.length).replace(/\\/g, '/');
    const segments = relativePath.split('/');
    const projectName = segments.shift();

    if (!projectName) {
      return null;
    }

    const remainder = segments.map(encodeURIComponent).join('/');
    return `http://localhost/${encodeURIComponent(projectName)}/${remainder}${window.location.search}${window.location.hash}`;
  }

  if (window.location.protocol === 'file:') {
    const redirectUrl = buildHttpUrlFromFile();
    if (redirectUrl) {
      window.location.replace(redirectUrl);
      return;
    }
  }

  const PROD_API_ROOT = 'https://plagiarismapi.ccsblock2.com/api';
  const isGithubPages = window.location.hostname.endsWith('github.io');
  const githubPathParts = path.split('/').filter(Boolean);
  const githubRepoBase = isGithubPages && githubPathParts.length > 0
    ? `/${githubPathParts[0]}`
    : '';
  const APP_ROOT = rawPath.includes('/frontend')
    ? rawPath.split('/frontend')[0]
    : '';
  const FRONTEND_ROOT = isGithubPages
    ? githubRepoBase
    : `${APP_ROOT}/frontend`;
  const API_ROOT = isGithubPages
    ? PROD_API_ROOT
    : `${APP_ROOT}/api`;

  const AUTH_TOKEN_KEY = 'plagicheck:accessToken';

  const state = {
    currentUser: null,
    currentReport: null,
  };

  function normalizePage() {
    return path.split('/').pop() || 'index.html';
  }

  function isUserPage() {
    return path.includes('/frontend/User Side/') || path.includes('/User Side/');
  }

  function isAdminPage() {
    return path.includes('/frontend/Admin Side/') || path.includes('/Admin Side/');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  function formatDate(value, withTime = false) {
    if (!value) return 'N/A';
    const date = new Date(value);
    return withTime ? date.toLocaleString() : date.toLocaleDateString();
  }

  function showMessage(text, type = 'info') {
    let box = document.querySelector('.app-message');
    if (!box) {
      box = document.createElement('div');
      box.className = 'app-message';
      box.style.margin = '1rem auto';
      box.style.maxWidth = '760px';
      box.style.padding = '12px 16px';
      box.style.borderRadius = '12px';
      box.style.fontWeight = '700';
      box.style.fontFamily = 'Nunito, sans-serif';
      const anchor = document.querySelector('.auth-container, .container, .main-content, .page-content, .welcome-screen') || document.body;
      anchor.parentNode.insertBefore(box, anchor);
    }

    const palette = {
      success: ['#dcfce7', '#166534'],
      error: ['#fee2e2', '#991b1b'],
      info: ['#e0f2fe', '#0f4c81'],
    };

    const [background, color] = palette[type] || palette.info;
    box.style.background = background;
    box.style.color = color;
    box.textContent = text;
  }

  function clearMessage() {
    document.querySelector('.app-message')?.remove();
  }

  function markAppReady() {
    document.body?.classList.remove('app-loading');
  }

  function upsertAuthActionBox(html = '') {
    let box = document.querySelector('.auth-helper-box');
    const anchor = document.querySelector('.auth-form');
    if (!anchor) return null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'auth-helper-box';
      box.style.marginTop = '1rem';
      box.style.padding = '14px 16px';
      box.style.borderRadius = '14px';
      box.style.background = '#f5f7fb';
      box.style.color = '#0f172a';
      box.style.fontFamily = 'Nunito, sans-serif';
      box.style.fontWeight = '700';
      anchor.appendChild(box);
    }
    box.innerHTML = html;
    if (!html) {
      box.remove();
      return null;
    }
    return box;
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({ ok: false, message: 'Invalid server response.' }));
    if (response.status === 401) {
      clearAuthState();
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || 'Request failed.');
    }
    return data;
  }

  function getAccessToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  }

  function setAccessToken(token) {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    }
  }

  function clearAuthState() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('plagicheck:lastReportId');
    state.currentUser = null;
    state.currentReport = null;
  }

  function formBody(payload) {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      params.append(key, String(value));
    });
    return params.toString();
  }

  async function fetchCurrentUser() {
    if (!getAccessToken()) {
      state.currentUser = null;
      return null;
    }

    try {
      const data = await request(`${API_ROOT}/auth/me.php`);
      state.currentUser = data.user || null;
      return state.currentUser;
    } catch (error) {
      state.currentUser = null;
      if (/auth|token|login/i.test(error.message || '')) {
        return null;
      }
      throw error;
    }
  }

  function userHomePath(role) {
    return role === 'admin'
      ? `${FRONTEND_ROOT}/Admin Side/index.html`
      : `${FRONTEND_ROOT}/User Side/home.html`;
  }

  async function ensureRole(expectedRole) {
    const user = await fetchCurrentUser();
    if (!user) {
      window.location.href = `${FRONTEND_ROOT}/login.html`;
      throw new Error('Authentication required.');
    }
    if (expectedRole && user.role !== expectedRole) {
      window.location.href = userHomePath(user.role);
      throw new Error('Redirecting.');
    }
    return user;
  }

  function saveLastReportId(id) {
    if (id) localStorage.setItem('plagicheck:lastReportId', String(id));
  }

  function getLastReportId() {
    return new URLSearchParams(window.location.search).get('id') || localStorage.getItem('plagicheck:lastReportId');
  }

  function attachSharedLogout() {
    window.handleLogout = async function handleLogout(event) {
      if (event) event.preventDefault();
      try {
        await request(`${API_ROOT}/auth/logout.php`, { method: 'POST' });
      } catch (_) {
      } finally {
        clearAuthState();
      }
      window.location.href = `${FRONTEND_ROOT}/login.html`;
    };

    const logoutSelectors = [
      '.logout-btn-mobile',
      '.logout-btn-desktop',
      '[onclick*="handleLogout"]',
      '[onclick*="../login.html"]',
      'a.btn.btn-red'
    ];

    document.querySelectorAll(logoutSelectors.join(',')).forEach((el) => {
      el.onclick = window.handleLogout;
      el.addEventListener('click', window.handleLogout);
    });
  }

  async function handleLoginPage() {
    try {
      const user = await fetchCurrentUser();
      if (user) {
        window.location.href = userHomePath(user.role);
        return;
      }
    } catch (_) {}

    const form = document.querySelector('.auth-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const email = document.getElementById('emailInput')?.value.trim() || '';
      const password = document.getElementById('passwordInput')?.value || '';

      try {
        const data = await request(`${API_ROOT}/auth/login.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody({ email, password }),
        });
        setAccessToken(data.token || '');
        state.currentUser = data.user || null;
        showMessage(data.message, 'success');
        setTimeout(() => { window.location.href = userHomePath(data.user.role); }, 250);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  }

  async function handleRegisterPage() {
    try {
      const user = await fetchCurrentUser();
      if (user) {
        window.location.href = userHomePath(user.role);
        return;
      }
    } catch (_) {}

    const form = document.querySelector('.auth-form');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const inputs = form.querySelectorAll('.form-input');
      const payload = {
        first_name: inputs[0]?.value.trim() || '',
        last_name: inputs[1]?.value.trim() || '',
        email: inputs[2]?.value.trim() || '',
        password: inputs[3]?.value || '',
        confirm_password: inputs[4]?.value || '',
      };

      try {
        const data = await request(`${API_ROOT}/auth/register.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody(payload),
        });
        showMessage(data.message, 'success');
        if (data.requires_verification) {
          setTimeout(() => {
            window.location.href = `${FRONTEND_ROOT}/verify-email.html?email=${encodeURIComponent(payload.email)}`;
          }, 350);
          return;
        }
        setTimeout(() => { window.location.href = userHomePath(data.user.role); }, 250);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  }

  async function handleVerifyEmailPage() {
    try {
      const user = await fetchCurrentUser();
      if (user) {
        window.location.href = userHomePath(user.role);
        return;
      }
    } catch (_) {}

    const params = new URLSearchParams(window.location.search);
    const email = params.get('email') || '';
    const card = document.querySelector('.auth-card');
    if (!card) return;

    card.innerHTML = `
      <div class="auth-header">
        <div class="auth-logo">
          <img src="User Side/images/logo.png" alt="PlagiCheck Logo">
          <span class="auth-logo-text">Plagi<span>Check</span></span>
        </div>
        <h2 class="auth-title">Verify Email</h2>
      </div>
      <form class="auth-form" id="verify-email-form" style="display:flex;flex-direction:column;gap:14px;">
        <p style="margin:0;color:#334155;font-weight:700;">Enter the 6-digit verification code we sent to your email address. If it did not arrive, you can resend it below.</p>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input type="email" class="form-input" id="verifyEmailInput" placeholder="Enter your email address" value="${escapeHtml(email)}">
        </div>
        <div class="form-group">
          <label class="form-label">Verification Code</label>
          <input type="text" class="form-input" id="verifyCodeInput" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code">
        </div>
        <button type="submit" class="btn btn-primary btn-full btn-lg" id="verifyCodeSubmitButton">Verify Email</button>
        <button type="button" class="btn btn-secondary btn-full btn-lg" id="resendVerificationPageButton">Resend Verification Code</button>
        <a href="login.html" class="btn btn-secondary btn-full btn-lg">Back to login</a>
      </form>
    `;

    const form = document.getElementById('verify-email-form');
    const emailInput = document.getElementById('verifyEmailInput');
    const codeInput = document.getElementById('verifyCodeInput');
    const resendButton = document.getElementById('resendVerificationPageButton');

    codeInput?.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D+/g, '').slice(0, 6);
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage();
      const submittedEmail = emailInput?.value.trim() || '';
      const submittedCode = codeInput?.value.trim() || '';

      try {
        const data = await request(`${API_ROOT}/auth/verify_email.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody({ email: submittedEmail, code: submittedCode }),
        });
        setAccessToken(data.token || '');
        state.currentUser = data.user || null;
        showMessage(data.message, 'success');
        setTimeout(() => { window.location.href = userHomePath(data.user.role); }, 400);
      } catch (error) {
        showMessage(error.message || 'Unable to verify this code.', 'error');
      }
    });

    resendButton?.addEventListener('click', async () => {
      clearMessage();
      const submittedEmail = emailInput?.value.trim() || '';
      try {
        const data = await request(`${API_ROOT}/auth/resend_verification.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody({ email: submittedEmail }),
        });
        showMessage(data.message, 'success');
      } catch (error) {
        showMessage(error.message || 'Unable to resend verification code.', 'error');
      }
    });
  }

  async function handleUserHome() {
    const user = await ensureRole('user');
    const data = await request(`${API_ROOT}/scans/list.php`);
    const reports = data.reports || [];

    document.querySelector('.dashboard-greeting')?.replaceChildren(document.createTextNode(`Welcome back, ${user.first_name}!`));
    const stats = document.querySelectorAll('.dashboard-stats .stat-value');
    if (stats[0]) stats[0].textContent = String(reports.length);
    if (stats[1]) stats[1].textContent = reports[0] ? `${Math.round(reports[0].highest_similarity)}%` : '0%';

    const recentList = document.querySelector('.history-list');
    if (recentList) {
      recentList.innerHTML = reports.length
        ? reports.slice(0, 3).map((report) => `
            <div class="history-item" data-report-id="${report.id}">
              <div class="history-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
              <div class="history-content">
                <div class="history-title">${escapeHtml(report.checked_filename)}</div>
                <div class="history-similarity">Similarity: ${Math.round(report.highest_similarity)}%</div>
                <div class="history-date">Date: ${formatDate(report.checked_at, true)}</div>
              </div>
            </div>`).join('')
        : '<p>No scans yet. Start your first plagiarism check from the Scan page.</p>';
      recentList.querySelectorAll('[data-report-id]').forEach((item) => {
        item.addEventListener('click', () => {
          saveLastReportId(item.dataset.reportId);
          window.location.href = `results.html?id=${item.dataset.reportId}`;
        });
      });
    }
  }

  async function handleUserScan() {
    await ensureRole('user');
    const scanButton = document.getElementById('scan-button');
    const textArea = document.getElementById('scan-text');
    const fileInput = document.getElementById('file-input');
    const uploadButton = document.getElementById('upload-file-button');
    const scanModal = document.getElementById('scan-results-modal');
    const cancelButton = document.getElementById('cancel-scan');
    const viewDetailsButton = document.getElementById('view-details');

    if (uploadButton && fileInput) {
      uploadButton.onclick = (event) => {
        event.preventDefault();
        fileInput.click();
      };
    }

    if (!scanButton) return;
    let activeReportId = null;

    fileInput?.addEventListener('change', () => {
      clearMessage();
      if (fileInput.files?.[0]) {
        if (!(textArea?.value.trim() || '')) {
          showMessage(`Uploading ${fileInput.files[0].name} and running the plagiarism check.`, 'info');
          scanButton.click();
          return;
        }
        showMessage(`Selected ${fileInput.files[0].name}. Click "Scan Text" to scan the uploaded file together with your pasted text.`, 'info');
      }
    });

    cancelButton?.addEventListener('click', () => scanModal?.classList.remove('active'));
    viewDetailsButton?.addEventListener('click', () => {
      if (activeReportId) {
        window.location.href = `results.html?id=${activeReportId}`;
      }
    });

    scanButton.addEventListener('click', async (event) => {
      event.preventDefault();
      clearMessage();
      const formData = new FormData();
      const text = textArea?.value.trim() || '';
      const file = fileInput?.files?.[0] || null;

      if (!text && !file) {
        showMessage('Please type text or upload a file before scanning.', 'error');
        return;
      }

      if (text) formData.append('text', text);
      if (file) formData.append('check_document', file);

      try {
        const data = await request(`${API_ROOT}/scans/create.php`, { method: 'POST', body: formData });
        const report = data.report;
        activeReportId = report.id;
        saveLastReportId(report.id);
        state.currentReport = report;

        const plagiarized = Math.round(report.plagiarized_percent);
        const unique = Math.max(0, 100 - plagiarized);
        document.querySelectorAll('.progress-percentage, .plagiarized-score .score-value').forEach((el) => { el.textContent = `${plagiarized}%`; });
        document.querySelector('.unique-score .score-value')?.replaceChildren(document.createTextNode(`${unique}%`));
        document.querySelector('.progress-label')?.replaceChildren(document.createTextNode(plagiarized >= 50 ? 'High Similarity' : 'Originality Check'));

        const circle = document.querySelector('.progress-ring-circle');
        if (circle) {
          const radius = 70;
          const circumference = 2 * Math.PI * radius;
          circle.style.strokeDasharray = `${circumference}`;
          circle.style.strokeDashoffset = `${circumference - (plagiarized / 100) * circumference}`;
        }

        if (fileInput) {
          fileInput.value = '';
        }
        showMessage(data.message, 'success');
        scanModal?.classList.add('active');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  }

  async function handleHistory() {
    await ensureRole('user');
    const body = document.querySelector('.card-body');
    if (!body) return;
    const data = await request(`${API_ROOT}/scans/list.php`);
    const reports = data.reports || [];

    body.innerHTML = reports.length
      ? reports.map((report, index) => `
          ${index === 0 ? '<h3 style="font-size: 1.125rem; font-weight: 800; margin-bottom: 1rem;">Recent</h3>' : ''}
          <div class="history-list">
            <div class="history-item" data-report-id="${report.id}">
              <div class="history-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
              <div class="history-content">
                <div class="history-title">${escapeHtml(report.checked_filename)}</div>
                <div class="history-similarity">Similarity: ${Math.round(report.highest_similarity)}%</div>
                <div class="history-date">Date: ${formatDate(report.checked_at, true)}</div>
              </div>
            </div>
          </div>`).join('')
      : '<p>No scan history yet.</p>';

    body.querySelectorAll('[data-report-id]').forEach((item) => {
      item.addEventListener('click', () => {
        saveLastReportId(item.dataset.reportId);
        window.location.href = `results.html?id=${item.dataset.reportId}`;
      });
    });
  }

  function buildReportDownload(report) {
    const lines = [
      `Filename: ${report.checked_filename}`,
      `Checked at: ${formatDate(report.checked_at, true)}`,
      `Highest similarity: ${Math.round(report.highest_similarity || 0)}%`,
      `Word count: ${report.word_count}`,
      '',
      'Matched sources:',
      ...(report.results || []).map((item, index) => `${index + 1}. ${item.filename} - ${Math.round(item.similarity_percent)}% (${item.file_type})`),
      '',
      'Scanned text:',
      report.raw_text || '',
    ].join('\r\n');

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(report.checked_filename || 'scan-report').replace(/[^a-z0-9._-]+/gi, '_')}_report.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleResults() {
    await ensureRole('user');
    const reportId = getLastReportId();
    if (!reportId) {
      showMessage('No scan result is available yet. Run a scan first.', 'error');
      return;
    }

    const data = await request(`${API_ROOT}/scans/show.php?id=${encodeURIComponent(reportId)}`);
    const report = data.report;
    state.currentReport = report;
    saveLastReportId(report.id);

    const plagiarized = Math.round(report.highest_similarity || 0);
    const unique = Math.max(0, 100 - plagiarized);
    document.querySelectorAll('.result-stat.plagiarized .result-stat-value').forEach((el) => { el.textContent = `${plagiarized}%`; });
    document.querySelectorAll('.result-stat.unique .result-stat-value').forEach((el) => { el.textContent = `${unique}%`; });
    document.querySelectorAll('.highlighted-text').forEach((el) => {
      el.innerHTML = renderHighlightedText(report.raw_text || '', report.highlights || []);
    });
    document.querySelectorAll('.word-count').forEach((el) => { el.textContent = `${report.word_count}/25000 words`; });
    document.querySelector('.document-name')?.replaceChildren(document.createTextNode(report.checked_filename));

    const sources = document.querySelector('.matched-sources');
    if (sources) {
      const items = report.results || [];
      sources.innerHTML = `<h3>Matched Sources</h3>${items.length ? items.map((item, index) => `
        <div class="source-item" data-document-id="${item.document_id}">
          <div class="source-header">
            <div class="source-title">${index + 1}. ${escapeHtml(item.filename)}</div>
            <div class="source-percentage">${Math.round(item.similarity_percent)}%</div>
          </div>
          <div class="source-match">${escapeHtml(item.file_type.toUpperCase())} source uploaded ${formatDate(item.uploaded_at)}</div>
          <a href="#" class="source-url">Document ID: ${item.document_id}</a>
        </div>`).join('') : '<p>No source documents met the minimum similarity threshold.</p>'}`;
    }

    const actionButtons = document.querySelectorAll('.results-actions .btn.btn-outline');
    if (actionButtons[0]) {
      actionButtons[0].onclick = async (event) => {
        event.preventDefault();
        const shareUrl = window.location.href;
        if (navigator.share) {
          await navigator.share({ title: 'PlagiCheck Report', text: `Similarity: ${plagiarized}%`, url: shareUrl });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl);
          showMessage('Report link copied to clipboard.', 'success');
        }
      };
    }
    if (actionButtons[1]) {
      actionButtons[1].onclick = (event) => {
        event.preventDefault();
        buildReportDownload(report);
      };
    }
  }

  async function handleUserProfile() {
    const user = await ensureRole('user');
    document.querySelector('.profile-name')?.replaceChildren(document.createTextNode(`Hi, ${user.first_name}!`));
    document.querySelector('.profile-email')?.replaceChildren(document.createTextNode(user.email));
    const values = document.querySelectorAll('.profile-info-value');
    if (values[0]) values[0].textContent = user.first_name;
    if (values[1]) values[1].textContent = user.last_name;
    if (values[2]) values[2].textContent = user.email;

    const form = document.querySelector('#change-password-modal form');
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.onclick = null;
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const inputs = form.querySelectorAll('input');
        try {
          const data = await request(`${API_ROOT}/auth/change_password.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: formBody({ new_password: inputs[0]?.value || '', confirm_password: inputs[1]?.value || '' }),
          });
          document.getElementById('change-password-modal')?.classList.remove('active');
          document.getElementById('success-modal')?.classList.add('active');
          showMessage(data.message, 'success');
          form.reset();
        } catch (error) {
          showMessage(error.message, 'error');
        }
      });
    }
  }

  async function handleAdminDashboard() {
    const user = await ensureRole('admin');
    const data = await request(`${API_ROOT}/admin/dashboard.php`);
    document.querySelector('.sidebar-uname')?.replaceChildren(document.createTextNode(user.full_name));
    document.querySelector('.topbar-badge')?.replaceChildren(document.createTextNode(`${data.stats.total_scans} Scans`));
    const stats = document.querySelectorAll('.stat-value');
    if (stats[0]) stats[0].textContent = formatNumber(data.stats.total_users);
    if (stats[1]) stats[1].textContent = formatNumber(data.stats.total_scans);
    if (stats[2]) stats[2].textContent = formatNumber(data.stats.high_risk);

    const logsLists = document.querySelectorAll('.logs-list');
    logsLists.forEach((list) => {
      list.innerHTML = data.logs.map((log) => `
        <div class="log-card">
          <div class="log-body">
            <div class="log-action">${escapeHtml(log.action)}</div>
            <div class="log-desc">${escapeHtml(log.description)}</div>
            <div class="log-meta">${formatDate(log.created_at, true)} - IP: ${escapeHtml(log.ip_address || 'n/a')}</div>
          </div>
          <span class="log-badge badge-green">${escapeHtml(log.status)}</span>
        </div>`).join('');
    });
  }

  async function handleAdminUsers() {
    await ensureRole('admin');
    const userState = {
      users: [],
      filter: 'all',
      query: '',
    };

    const topbarBadge = document.querySelector('.topbar-badge');
    const pageHeading = document.querySelector('.page-heading > div');
    const searchInput = document.getElementById('searchInput');
    const chips = document.querySelectorAll('.chip');
    const tableWrap = document.querySelector('.users-table-wrap');
    const mobileList = document.getElementById('mobileList');

    searchInput?.addEventListener('input', () => {
      userState.query = searchInput.value.trim().toLowerCase();
      renderUsers();
    });

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((item) => item.classList.remove('active'));
        chip.classList.add('active');
        userState.filter = chip.dataset.filter || 'all';
        renderUsers();
      });
    });

    await refreshUsers();

    async function refreshUsers() {
      const data = await request(`${API_ROOT}/admin/users.php`);
      userState.users = data.users || [];
      renderUsers();
    }

    function getFilteredUsers() {
      return userState.users.filter((user) => {
        const matchesFilter = userState.filter === 'all'
          || (userState.filter === 'online' ? !!user.last_login : user.role === userState.filter);
        const haystack = `${user.full_name} ${user.email} ${user.role}`.toLowerCase();
        const matchesQuery = userState.query === '' || haystack.includes(userState.query);
        return matchesFilter && matchesQuery;
      });
    }

    function renderUsers() {
      const users = getFilteredUsers();
      if (topbarBadge) topbarBadge.textContent = `${formatNumber(userState.users.length)} Total`;
      if (pageHeading) pageHeading.innerHTML = `Users <span>${formatNumber(userState.users.length)} registered</span>`;

      if (tableWrap) {
        tableWrap.innerHTML = `
          <div class="table-head"><span></span><span>Name</span><span>Email</span><span>Role</span><span>Status</span><span>Actions</span></div>
          ${users.map((user) => `
            <div class="table-row" data-role="${user.role}" data-status="${user.is_active ? 'active' : 'inactive'}">
              <div class="table-avatar">${escapeHtml(user.first_name.charAt(0) + user.last_name.charAt(0))}</div>
              <div>
                <div class="table-name">${escapeHtml(user.full_name)}</div>
                <div class="table-sub">user_id:${user.id} - ${user.last_login ? `last login ${formatDate(user.last_login, true)}` : `joined ${formatDate(user.created_at)}`}</div>
              </div>
              <div class="table-cell">${escapeHtml(user.email)}</div>
              <div><span class="role-badge ${user.role === 'admin' ? 'role-admin' : 'role-user'}">${escapeHtml(user.role)}</span></div>
              <div><span class="status-badge ${user.is_active ? 'status-active' : 'status-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></div>
              <div class="table-actions">
                <button class="tbl-btn role" title="View" data-action="view" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
                <button class="tbl-btn edit" title="Edit" data-action="edit" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="tbl-btn del" title="Delete" data-action="delete" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
              </div>
            </div>`).join('') || '<div class="table-row"><div></div><div class="table-name">No users found</div><div></div><div></div><div></div><div></div></div>'}`;

        tableWrap.querySelectorAll('[data-action]').forEach((button) => {
          button.addEventListener('click', () => handleUserAction(button.dataset.action || '', Number(button.dataset.userId || 0)));
        });
      }

      if (mobileList) {
        mobileList.innerHTML = users.map((user) => `
          <div class="user-card" data-role="${user.role}" data-status="${user.is_active ? 'active' : 'inactive'}">
            <div class="user-avatar">${escapeHtml(user.first_name.charAt(0) + user.last_name.charAt(0))}</div>
            <div class="user-info">
              <div class="user-name">${escapeHtml(user.full_name)}</div>
              <div class="user-email">${escapeHtml(user.email)}</div>
              <div class="user-meta">user_id:${user.id} - role:${escapeHtml(user.role)} - ${user.is_active ? 'active' : 'inactive'}</div>
            </div>
            <div class="user-actions">
              <button class="action-btn" title="View" data-action="view" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
              <button class="action-btn" title="Edit" data-action="edit" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="action-btn danger" title="Delete" data-action="delete" data-user-id="${user.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
            </div>
          </div>`).join('') || '<div class="user-card"><div class="user-info"><div class="user-name">No users found</div></div></div>';

        mobileList.querySelectorAll('[data-action]').forEach((button) => {
          button.addEventListener('click', () => handleUserAction(button.dataset.action || '', Number(button.dataset.userId || 0)));
        });
      }
    }

    async function handleUserAction(action, userId) {
      if (!userId) return;

      if (action === 'view') {
        const data = await request(`${API_ROOT}/admin/users.php?id=${userId}`);
        openUserModal('view', data.user);
        return;
      }

      if (action === 'edit') {
        const data = await request(`${API_ROOT}/admin/users.php?id=${userId}`);
        openUserModal('edit', data.user);
        return;
      }

      if (action === 'delete') {
        const user = userState.users.find((item) => item.id === userId);
        if (!user) return;
        if (!window.confirm(`Delete ${user.full_name}? This cannot be undone.`)) return;
        await request(`${API_ROOT}/admin/users.php`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({ id: userId }),
        });
        showMessage(`${user.full_name} was deleted.`, 'success');
        await refreshUsers();
      }
    }

    function openUserModal(mode, user) {
      document.getElementById('admin-user-modal')?.remove();
      const isView = mode === 'view';
      const modal = document.createElement('div');
      modal.id = 'admin-user-modal';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.background = 'rgba(0, 0, 0, 0.45)';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.zIndex = '1000';
      modal.innerHTML = `
        <div style="width:min(92vw,560px);background:#fff;border-radius:16px;padding:24px;font-family:Nunito,sans-serif;box-shadow:0 18px 48px rgba(0,0,0,0.18);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:20px;font-weight:900;color:#1e2a1f;">${isView ? 'View User' : 'Edit User'}</h3>
            <button type="button" id="user-modal-close" style="border:none;background:none;font-size:22px;cursor:pointer;color:#6b7c6d;">x</button>
          </div>
          <form id="admin-user-form" style="display:grid;gap:12px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <input name="first_name" placeholder="First name" value="${escapeHtml(user.first_name || '')}" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:600 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;' : ''}" ${isView ? 'readonly' : ''} required>
              <input name="last_name" placeholder="Last name" value="${escapeHtml(user.last_name || '')}" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:600 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;' : ''}" ${isView ? 'readonly' : ''} required>
            </div>
            <input name="email" type="email" placeholder="Email" value="${escapeHtml(user.email || '')}" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:600 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;' : ''}" ${isView ? 'readonly' : ''} required>
            <input name="password" type="password" placeholder="${isView ? 'Password hidden' : 'New password (optional)'}" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:600 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;' : ''}" ${isView ? 'readonly' : ''}>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <select name="role" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:700 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;pointer-events:none;' : ''}">
                <option value="user" ${user.role !== 'admin' ? 'selected' : ''}>User</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
              <select name="is_active" style="padding:12px 14px;border:1px solid #d0d7d2;border-radius:10px;font:700 13px Nunito,sans-serif;${isView ? 'background:#f3f4f6;pointer-events:none;' : ''}">
                <option value="1" ${user.is_active ? 'selected' : ''}>Active</option>
                <option value="0" ${!user.is_active ? 'selected' : ''}>Inactive</option>
              </select>
            </div>
            <div style="padding:12px 14px;border-radius:10px;background:#f7faf7;color:#4b5563;font:700 12px Nunito,sans-serif;line-height:1.5;">
              User ID: ${user.id}<br>
              Last Login: ${user.last_login ? formatDate(user.last_login, true) : 'Never'}<br>
              Created: ${formatDate(user.created_at, true)}
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px;">
              <button type="button" id="user-modal-cancel" style="border:none;border-radius:10px;padding:10px 16px;background:#e5e7eb;color:#1f2937;font:800 12px Nunito,sans-serif;cursor:pointer;">Close</button>
              ${isView ? '<button type="button" id="user-modal-edit" style="border:none;border-radius:10px;padding:10px 16px;background:#3d7042;color:#fff;font:800 12px Nunito,sans-serif;cursor:pointer;">Edit User</button>' : '<button type="submit" style="border:none;border-radius:10px;padding:10px 16px;background:#3d7042;color:#fff;font:800 12px Nunito,sans-serif;cursor:pointer;">Save Changes</button>'}
            </div>
          </form>
        </div>`;
      document.body.appendChild(modal);

      const close = () => modal.remove();
      modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
      modal.querySelector('#user-modal-close')?.addEventListener('click', close);
      modal.querySelector('#user-modal-cancel')?.addEventListener('click', close);
      modal.querySelector('#user-modal-edit')?.addEventListener('click', () => {
        close();
        openUserModal('edit', user);
      });
      modal.querySelector('#admin-user-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        try {
          const result = await request(`${API_ROOT}/admin/users.php`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({
              id: user.id,
              first_name: String(formData.get('first_name') || '').trim(),
              last_name: String(formData.get('last_name') || '').trim(),
              email: String(formData.get('email') || '').trim(),
              password: String(formData.get('password') || ''),
              role: String(formData.get('role') || 'user'),
              is_active: String(formData.get('is_active') || '1'),
            }),
          });
          showMessage(result.message || 'User updated successfully.', 'success');
          close();
          await refreshUsers();
        } catch (error) {
          showMessage(error.message, 'error');
        }
      });
    }
  }
  async function handleAdminScan() {
    await ensureRole('admin');
    const [reportsData, documentsData] = await Promise.all([
      request(`${API_ROOT}/scans/list.php`),
      request(`${API_ROOT}/admin/documents.php`),
    ]);
    const reports = reportsData.reports || [];
    const documents = documentsData.documents || [];
    const stats = document.querySelectorAll('.stat-mini-value');
    if (stats[0]) stats[0].textContent = formatNumber(reports.length);
    if (stats[1]) stats[1].textContent = formatNumber(reports.filter((item) => item.highest_similarity >= 50).length);
    if (stats[2]) stats[2].textContent = reports.length ? formatNumber(Math.round(reports.reduce((sum, item) => sum + item.word_count, 0) / reports.length)) : '0';
    if (stats[3]) stats[3].textContent = formatNumber(documents.length);

    const desktopTable = document.querySelector('.scan-table-wrap.desktop-only');
    if (desktopTable) {
      desktopTable.innerHTML = `
        <div class="scan-table-head"><span></span><span>File</span><span>Type</span><span>Checked At</span><span>Word / Char Count</span><span>Risk</span></div>
        ${reports.map((report) => `
          <div class="scan-table-row">
            <div class="file-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div><div class="scan-filename">${escapeHtml(report.checked_filename)}</div><div class="scan-sub">${escapeHtml(report.user.email)}</div></div>
            <div><span class="type-badge ${report.input_type === 'file' ? 'type-file' : 'type-text'}">${escapeHtml(report.input_type)}</span></div>
            <div class="scan-cell">${formatDate(report.checked_at, true)}</div>
            <div class="scan-cell">${formatNumber(report.word_count)} words - ${formatNumber(report.char_count)} chars</div>
            <div><span class="risk-badge ${report.highest_similarity >= 50 ? 'risk-high' : report.highest_similarity >= 20 ? 'risk-medium' : 'risk-low'}">${Math.round(report.highest_similarity)}%</span></div>
          </div>`).join('')}`;
    }

    const mobileCards = document.querySelector('.scan-cards.mobile-only');
    if (mobileCards) {
      mobileCards.innerHTML = reports.map((report) => `
        <div class="scan-card">
          <div class="scan-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div class="scan-card-body"><div class="scan-card-name">${escapeHtml(report.checked_filename)}</div><div class="scan-card-meta">${escapeHtml(report.user.email)} - ${Math.round(report.highest_similarity)}% similarity</div></div>
        </div>`).join('');
    }

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = '.txt,.doc,.docx,.pdf';
    uploadInput.style.display = 'none';
    document.body.appendChild(uploadInput);
    document.querySelector('.new-scan-btn')?.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('source_document', file);
      try {
        await request(`${API_ROOT}/admin/documents.php`, { method: 'POST', body: formData });
        showMessage('Source document uploaded successfully.', 'success');
        setTimeout(() => window.location.reload(), 300);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  }

  async function handleAdminProfile() {
    const user = await ensureRole('admin');
    const dash = await request(`${API_ROOT}/admin/dashboard.php`);
    document.querySelector('.profile-name')?.replaceChildren(document.createTextNode(user.full_name));
    document.querySelector('.profile-email')?.replaceChildren(document.createTextNode(user.email));
    document.querySelector('.mobile-profile-name')?.replaceChildren(document.createTextNode(`Hi, ${user.first_name}!`));
    document.querySelector('.mobile-profile-sub')?.replaceChildren(document.createTextNode(user.email));
    const statVals = document.querySelectorAll('.profile-stat-val');
    if (statVals[0]) statVals[0].textContent = formatNumber(dash.stats.total_scans);
    if (statVals[1]) statVals[1].textContent = formatNumber(dash.stats.total_users);
    if (statVals[2]) statVals[2].textContent = formatNumber(dash.stats.high_risk);

    const mobileInputs = document.querySelectorAll('.mobile-field-input');
    if (mobileInputs[0]) mobileInputs[0].value = user.first_name;
    if (mobileInputs[1]) mobileInputs[1].value = user.last_name;
    if (mobileInputs[2]) mobileInputs[2].value = user.email;
  }

  async function handleAdminMaintenance() {
    await ensureRole('admin');
    const [maintenanceData, documentsData] = await Promise.all([
      request(`${API_ROOT}/admin/maintenance.php`),
      request(`${API_ROOT}/admin/documents.php`),
    ]);
    const maintenance = maintenanceData.maintenance;
    const documents = documentsData.documents || [];

    const apiPercent = Math.max(0, Math.min(100, Number(maintenance.health.api_response?.percent || 0)));
    const userCount = Number(maintenance.counts.users || 0);
    const userPercent = Math.max(0, Math.min(100, userCount));
    const documentCount = documents.length;
    const documentPercent = Math.max(0, Math.min(100, documentCount));

    const metrics = [
      {
        label: 'API Response',
        percent: apiPercent,
        status: maintenance.health.api_response?.status || 'Unknown',
        tone: maintenance.health.api_response?.tone || 'yellow',
        detail: maintenance.health.api_response?.detail || 'API telemetry unavailable',
        description: maintenance.health.api_response?.description || 'Measures API responsiveness and stability.',
      },
      {
        label: 'DB Users',
        percent: userPercent,
        status: userCount >= 100 ? 'Full' : 'Active',
        tone: userCount >= 100 ? 'red' : userCount >= 75 ? 'yellow' : 'green',
        detail: `${formatNumber(userCount)} users in database`,
        description: 'Shows the current number of user accounts stored in the database, capped at 100% for the dashboard gauge.',
      },
      {
        label: 'Source Files',
        percent: documentPercent,
        status: documentCount >= 100 ? 'Capacity Reached' : documentCount >= 80 ? 'Near Limit' : 'Available',
        tone: documentCount >= 100 ? 'red' : documentCount >= 80 ? 'yellow' : 'green',
        detail: `${formatNumber(documentCount)} / 100 source files`,
        description: 'Shows how many source documents admins have uploaded into the detector library out of the 100-file dashboard limit.',
      },
    ];

    const toneClass = (tone) => tone === 'green' ? 'dot-green' : tone === 'yellow' ? 'dot-yellow' : 'dot-red';
    const formatRelative = (value) => {
      if (!value) return 'No recent activity';
      const date = new Date(String(value).replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) return formatDate(value, true);
      const diffMs = Date.now() - date.getTime();
      const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
      if (diffMinutes < 1) return 'Just now';
      if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
      const diffHours = Math.round(diffMinutes / 60);
      if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
      const diffDays = Math.round(diffHours / 24);
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    };
    const setDonut = (index, metric) => {
      const wrap = document.querySelectorAll('.health-item')[index];
      if (!wrap || !metric) return;
      const pctNode = wrap.querySelector('.donut-pct');
      if (pctNode) pctNode.textContent = `${metric.percent}%`;
      const labelNode = wrap.querySelector('.health-label');
      if (labelNode) labelNode.textContent = metric.label;
      const sub = wrap.querySelector('.health-sublabel');
      if (sub) sub.textContent = metric.detail;
      const tracks = wrap.querySelectorAll('.donut-track');
      const radius = 31;
      const circumference = 2 * Math.PI * radius;
      if (tracks[0]) {
        tracks[0].setAttribute('stroke', metric.tone === 'green' ? '#4caf50' : metric.tone === 'yellow' ? '#e0a020' : '#e84040');
        tracks[0].setAttribute('stroke-dasharray', `${(metric.percent / 100) * circumference} ${circumference}`);
        tracks[0].setAttribute('stroke-dashoffset', '0');
      }
      if (tracks[1]) {
        tracks[1].setAttribute('stroke', '#e5e7eb');
        tracks[1].setAttribute('stroke-dasharray', `${Math.max(0, circumference - ((metric.percent / 100) * circumference))} ${circumference}`);
        tracks[1].setAttribute('stroke-dashoffset', `${-((metric.percent / 100) * circumference)}`);
      }
    };

    const pills = document.querySelectorAll('.status-pill');
    pills.forEach((pill, index) => {
      const metric = metrics[index];
      if (!pill || !metric) return;
      pill.innerHTML = `<span class="status-dot ${toneClass(metric.tone)}"></span>${metric.label} - ${metric.status} ${metric.percent}%`;
      pill.title = metric.description;
    });

    const topbarBadge = document.querySelector('.topbar-badge');
    if (topbarBadge) {
      topbarBadge.textContent = `${maintenance.overall.status} - ${maintenance.overall.percent}%`;
      topbarBadge.style.background = maintenance.overall.tone === 'green' ? '#3d7042' : maintenance.overall.tone === 'yellow' ? '#c58a16' : '#b42318';
    }

    metrics.forEach((metric, index) => setDonut(index, metric));

    const issueCount = document.getElementById('maint-issue-count');
    const issueSummary = document.getElementById('maint-issue-summary');
    const latestScan = document.getElementById('maint-latest-scan');
    const scanVolume = document.getElementById('maint-scan-volume');
    const lastAction = document.getElementById('maint-last-action');
    const lastActionDesc = document.getElementById('maint-last-action-desc');

    if (issueCount) issueCount.textContent = String(maintenance.issues.length);
    if (issueSummary) issueSummary.textContent = maintenance.issues[0] || maintenance.overall.summary;
    if (latestScan) latestScan.textContent = maintenance.recent.latest_scan_at ? formatRelative(maintenance.recent.latest_scan_at) : 'No scans yet';
    if (scanVolume) scanVolume.textContent = `${formatNumber(maintenance.counts.today_scans)} today - ${formatNumber(maintenance.counts.week_scans)} in the last 7 days - ${formatNumber(maintenance.counts.recent_active_users)} active users`;
    if (lastAction) lastAction.textContent = maintenance.recent.latest_maintenance ? formatRelative(maintenance.recent.latest_maintenance.created_at) : 'No actions yet';
    if (lastActionDesc) lastActionDesc.textContent = maintenance.recent.latest_maintenance ? maintenance.recent.latest_maintenance.description : 'Refresh, purge, and index actions will appear here once admins run them.';

    const activityList = document.getElementById('maintenance-activity-list');
    if (activityList) {
      const actions = maintenance.recent.actions || [];
      activityList.innerHTML = actions.length
        ? actions.map((item) => `
            <div class="activity-item">
              <div class="activity-main">
                <div class="activity-title">${escapeHtml(String(item.action || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()))}</div>
                <div class="activity-desc">${escapeHtml(item.description || '')}</div>
              </div>
              <div class="activity-meta">${escapeHtml(formatRelative(item.created_at))}</div>
            </div>`).join('')
        : `
            <div class="activity-item">
              <div class="activity-main">
                <div class="activity-title">No recent maintenance actions</div>
                <div class="activity-desc">Run a refresh or cleanup task to populate this activity stream.</div>
              </div>
              <div class="activity-meta">Waiting</div>
            </div>`;
    }

    const cards = document.querySelectorAll('.maint-card');
    const configureActionButton = (button, label, action, type = 'default') => {
      if (!button) return;
      button.textContent = label;
      button.classList.remove('btn-secondary', 'btn-danger', 'btn-warning');
      if (type === 'danger') button.classList.add('btn-danger');
      if (type === 'secondary') button.classList.add('btn-secondary');
      button.onclick = () => runMaintenanceAction(action, button);
    };

    if (cards[0]) {
      cards[0].querySelector('.maint-title').textContent = 'Refresh Detection Snapshot';
      cards[0].querySelector('.maint-count').textContent = `${formatNumber(documentCount)} source files loaded`;
      cards[0].querySelector('.maint-desc').textContent = `Refreshes the current detector inventory, including ${formatNumber(maintenance.counts.fingerprints)} fingerprints and ${formatNumber(maintenance.counts.scan_reports)} stored scan reports.`;
      const buttons = cards[0].querySelectorAll('.maint-btn');
      configureActionButton(buttons[0], 'Refresh Summary', 'refresh');
      if (buttons[1]) {
        buttons[1].textContent = 'View Issues';
        buttons[1].classList.add('btn-secondary');
        buttons[1].onclick = () => showMessage(maintenance.issues.join(' '), maintenance.overall.tone === 'red' ? 'error' : 'info');
      }
    }
    if (cards[1]) {
      cards[1].querySelector('.maint-title').textContent = 'Find Orphaned Scan Records';
      cards[1].querySelector('.maint-count').textContent = `${formatNumber(maintenance.counts.orphaned)} found`;
      cards[1].querySelector('.maint-desc').textContent = 'Checks for scan reports that no longer point to an existing user account and removes stale data safely.';
      const buttons = cards[1].querySelectorAll('.maint-btn');
      configureActionButton(buttons[0], 'Recheck', 'refresh');
      if (buttons[1]) configureActionButton(buttons[1], 'Purge Orphans', 'purge_orphans', 'danger');
    }
    if (cards[2]) {
      cards[2].querySelector('.maint-title').textContent = 'Purge Expired Scan Data';
      cards[2].querySelector('.maint-count').textContent = `${formatNumber(maintenance.counts.expired)} eligible`;
      cards[2].querySelector('.maint-desc').textContent = `Deletes scan reports older than ${maintenance.counts.retention_days} days while keeping your indexed source documents intact.`;
      const buttons = cards[2].querySelectorAll('.maint-btn');
      configureActionButton(buttons[0], 'Purge Now', 'purge_expired_scans', 'danger');
    }
    if (cards[3]) {
      cards[3].querySelector('.maint-title').textContent = 'Analyze Search Indexes';
      cards[3].querySelector('.maint-count').textContent = `${formatNumber(maintenance.counts.fingerprints)} fingerprints`;
      cards[3].querySelector('.maint-desc').textContent = 'Runs database index analysis for documents, fingerprints, and scan reports so search and comparisons stay responsive.';
      const buttons = cards[3].querySelectorAll('.maint-btn');
      configureActionButton(buttons[0], 'Analyze Indexes', 'analyze_indexes');
      if (buttons[1]) {
        buttons[1].textContent = 'Show Capacity';
        buttons[1].classList.add('btn-secondary');
        buttons[1].onclick = () => showMessage(`${formatNumber(documentCount)} of 100 source-file slots are currently in use.`, 'info');
      }
    }

    async function runMaintenanceAction(action, button) {
      const actionLabels = {
        refresh: 'Refreshing...',
        purge_orphans: 'Purging...',
        purge_expired_scans: 'Purging...',
        analyze_indexes: 'Analyzing...',
      };
      const confirmMessages = {
        purge_orphans: `Purge ${formatNumber(maintenance.counts.orphaned)} orphaned scan reports? This cannot be undone.`,
        purge_expired_scans: `Purge ${formatNumber(maintenance.counts.expired)} expired scan reports? This cannot be undone.`,
      };

      if (confirmMessages[action] && !window.confirm(confirmMessages[action])) {
        return;
      }

      const originalText = button ? button.textContent : '';
      if (button) {
        button.textContent = actionLabels[action] || 'Working...';
        button.classList.add('is-loading');
        button.disabled = true;
      }

      try {
        const result = await request(`${API_ROOT}/admin/maintenance.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody({ action }),
        });
        showMessage(result.message || 'Maintenance action completed.', 'success');
        await handleAdminMaintenance();
      } catch (error) {
        showMessage(error.message, 'error');
      } finally {
        if (button) {
          button.textContent = originalText;
          button.classList.remove('is-loading');
          button.disabled = false;
        }
      }
    }
  }
  async function handleAdminSettings() {
    await ensureRole('admin');
    const data = await request(`${API_ROOT}/admin/settings.php`);
    const settings = data.settings;
    const toggles = document.querySelectorAll('.settings-panel .toggle input');
    const order = [
      'allow_self_registration', 'require_email_verification', 'notify_on_scan_complete', 'high_risk_alert', 'auto_purge_scans', 'keep_reports',
      'allow_self_registration', 'require_email_verification', 'notify_on_scan_complete', 'high_risk_alert', 'auto_purge_scans', 'keep_reports',
    ];
    toggles.forEach((input, index) => {
      const key = order[index];
      if (key) input.checked = !!settings[key];
    });

    document.querySelectorAll('.danger-btn').forEach((btn) => btn.remove());
    document.querySelector('.danger-zone')?.insertAdjacentHTML('beforeend', '<p style="margin-top:14px;font-size:12px;font-weight:700;color:#7f1d1d;">Destructive controls were removed until matching backend workflows exist.</p>');

    const saveButton = document.querySelector('.save-btn');
    const resetButton = document.querySelector('.reset-btn');

    saveButton && (saveButton.onclick = async () => {
      try {
        const desktop = Array.from(document.querySelectorAll('.desktop-only .settings-panel .toggle input'));
        const payload = {
          allow_self_registration: desktop[0]?.checked ? 1 : 0,
          require_email_verification: desktop[1]?.checked ? 1 : 0,
          notify_on_scan_complete: desktop[2]?.checked ? 1 : 0,
          high_risk_alert: desktop[3]?.checked ? 1 : 0,
          auto_purge_scans: desktop[4]?.checked ? 1 : 0,
          keep_reports: desktop[5]?.checked ? 1 : 0,
          scan_retention_days: settings.scan_retention_days || 90,
        };
        await request(`${API_ROOT}/admin/settings.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody(payload),
        });
        showMessage('Settings saved successfully.', 'success');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });

    resetButton && (resetButton.onclick = async () => {
      try {
        await request(`${API_ROOT}/admin/settings.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: formBody({ allow_self_registration: 1, require_email_verification: 0, notify_on_scan_complete: 1, high_risk_alert: 1, auto_purge_scans: 0, keep_reports: 1, scan_retention_days: 90 }),
        });
        showMessage('Settings reset to defaults.', 'success');
        await handleAdminSettings();
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  }

  async function init() {
    attachSharedLogout();
    const page = normalizePage();

    try {
      if (page === 'login.html') return await handleLoginPage();
      if (page === 'register.html') return await handleRegisterPage();
      if (page === 'verify-email.html') return await handleVerifyEmailPage();
      if (page === 'index.html' && !isAdminPage() && !isUserPage()) return;
      if (page === 'home.html') return await handleUserHome();
      if (page === 'scan.html' && isUserPage()) return await handleUserScan();
      if (page === 'history.html') return await handleHistory();
      if ((page === 'results.html' || page === 'results2.html') && isUserPage()) return await handleResults();
      if (page === 'profile.html' && isUserPage()) return await handleUserProfile();
      if (page === 'index.html' && isAdminPage()) return await handleAdminDashboard();
      if (page === 'User.html') return await handleAdminUsers();
      if (page === 'Scan.html') return await handleAdminScan();
      if (page === 'Admin_profil.html') return await handleAdminProfile();
      if (page === 'Maintain.html') return await handleAdminMaintenance();
      if (page === 'Settings.html') return await handleAdminSettings();
      if (isAdminPage()) return await ensureRole('admin');
      if (isUserPage()) return await ensureRole('user');
    } catch (error) {
      if (error.message !== 'Redirecting.' && error.message !== 'Authentication required.') {
        showMessage(error.message || 'Unable to load this page.', 'error');
      }
    } finally {
      markAppReady();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(markAppReady, 4000);
    void init();
  });
})();






