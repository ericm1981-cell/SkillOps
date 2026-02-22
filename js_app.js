/**
 * App — Bootstrap, router, sidebar renderer, init.
 *
 * Boot contract:
 *   1. Every async step is wrapped with Boot.step() logging.
 *   2. DB.open() races against a 3-second timeout.
 *   3. App.init() always calls Boot.done() or Boot.fatal() — loader never stranded.
 *   4. All page renders are try/catch guarded.
 */

/* ─── Boot console (writes to #boot-console injected by index.html) ── */
const Boot = (() => {
  let _el = null;
  let _spinnerEl = null;

  function _panel() {
    if (!_el) _el = document.getElementById('boot-console');
    return _el;
  }

  function step(msg) {
    console.log('[Boot]', msg);
    const p = _panel();
    if (!p) return;
    const line = document.createElement('div');
    line.className = 'bc-line';
    line.textContent = '▸ ' + msg;
    p.appendChild(line);
    p.scrollTop = p.scrollHeight;
  }

  function warn(msg) {
    console.warn('[Boot]', msg);
    const p = _panel();
    if (!p) return;
    const line = document.createElement('div');
    line.className = 'bc-line bc-warn';
    line.textContent = '⚠ ' + msg;
    p.appendChild(line);
    p.scrollTop = p.scrollHeight;
  }

  function done() {
    step('App ready ✓');
    _hideLoader();
    // Collapse boot console after 3s
    setTimeout(() => {
      const p = _panel();
      if (p) p.style.display = 'none';
    }, 3000);
  }

  function fatal(msg, stack) {
    console.error('[Boot FATAL]', msg, stack);
    _hideLoader();

    document.getElementById('app').innerHTML = `
      <div style="
        position:fixed;inset:0;background:#0d0f12;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:24px;z-index:99999;font-family:monospace;">
        <div style="max-width:640px;width:100%">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <div style="width:40px;height:40px;background:#ef4444;border-radius:4px;
              display:flex;align-items:center;justify-content:center;font-size:20px">✕</div>
            <div>
              <div style="color:#ef4444;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Boot Failed</div>
              <div style="color:#e8eaf0;font-size:16px;margin-top:2px">${_esc(msg)}</div>
            </div>
          </div>
          ${stack ? `<pre style="background:#1a1d26;color:#94a3b8;font-size:10px;padding:12px;
            border-radius:4px;overflow:auto;max-height:220px;margin-bottom:20px;
            border:1px solid #2a2f3a">${_esc(stack)}</pre>` : ''}
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <button onclick="location.reload()" style="
              padding:10px 20px;background:#f97316;color:#000;border:none;
              border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:700">
              ↺ Reload
            </button>
            <button id="reset-btn" style="
              padding:10px 20px;background:#1a1d26;color:#ef4444;
              border:1px solid #ef4444;border-radius:4px;cursor:pointer;
              font-family:monospace;font-size:12px;font-weight:700">
              🗑 Reset Local Data &amp; Reload
            </button>
          </div>
          <div id="reset-status" style="margin-top:12px;font-size:11px;color:#94a3b8"></div>
        </div>
      </div>`;

    document.getElementById('reset-btn').onclick = async () => {
      const s = document.getElementById('reset-status');
      s.textContent = 'Deleting database…';
      try {
        if (window.indexedDB) {
          const req = indexedDB.deleteDatabase('SkillsMatrixDB');
          await new Promise((res, rej) => { req.onsuccess = res; req.onerror = rej; });
        }
        s.textContent = 'Done. Reloading…';
        setTimeout(() => location.reload(), 600);
      } catch(e) {
        s.textContent = 'Error: ' + e.message + ' — try reloading manually.';
      }
    };
  }

  function _hideLoader() {
    const loader = document.getElementById('app-loading');
    if (!loader) return;
    loader.style.opacity = '0';
    loader.style.transition = 'opacity 0.2s';
    setTimeout(() => { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 250);
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { step, warn, done, fatal };
})();

/* ─────────────────────────────────────────────────────────────────── */

const App = (() => {

  let _deviceRole   = 'authority';
  let _deviceLineId = null;
  let _currentPage  = 'dashboard';
  let _qrLineId     = null;

  /* ── Nav config ───────────────────────────────────────────────── */
  const NAV_AUTHORITY = [
    { section: 'nav_section_overview', items: [
      { id: 'dashboard',    icon: '◈', label: 'nav_dashboard' },
    ]},
    { section: 'nav_section_skills', items: [
      { id: 'matrix',       icon: '⊞', label: 'nav_matrix' },
      { id: 'approvals',    icon: '✓', label: 'nav_approvals', badge: 'pendingCount' },
      { id: 'cross',        icon: '⟷', label: 'nav_cross' },
    ]},
    { section: 'nav_section_ops', items: [
      { id: 'rotation',     icon: '↻', label: 'nav_rotation' },
      { id: 'attendance',   icon: '☑', label: 'nav_attendance' },
      { id: 'audits',       icon: '⊛', label: 'nav_audits' },
    ]},
    { section: 'nav_section_data', items: [
      { id: 'importExport', icon: '⇅', label: 'nav_import_export' },
      { id: 'qr',           icon: '⬛', label: 'nav_qr' },
      { id: 'reports',      icon: '≡',  label: 'nav_reports' },
      { id: 'sync',         icon: '⇌', label: 'nav_sync' },
      { id: 'setup',        icon: '⚙', label: 'nav_setup' },
    ]},
  ];

  const NAV_FIELD = [
    { section: 'nav_section_overview', items: [
      { id: 'qrForm', icon: '✎', label: 'nav_dashboard' },
      { id: 'sync',   icon: '⇌', label: 'nav_sync' },
    ]},
  ];

  /* ── Init ─────────────────────────────────────────────────────── */
  async function init() {
    try {
      Boot.step('Opening database…');
      await DB.open();

      if (DB.isMemoryMode) {
        Boot.warn('IndexedDB unavailable \u2014 using in-memory storage (data will not persist)');
      } else {
        Boot.step('Database opened ✓');
      }

      Boot.step('Loading settings…');
      const lang = await DB.getSetting('language', 'en');
      window._LANG = lang;

      _deviceRole   = await DB.getSetting('deviceRole',   'authority');
      _deviceLineId = await DB.getSetting('deviceLineId', null);
      Boot.step('Settings loaded ✓');

      // QR param
      const params = new URLSearchParams(window.location.search);
      _qrLineId = params.get('qr') ? parseInt(params.get('qr')) : null;

      Boot.step('Loading lines & users…');
      await lineService.loadAll();
      await lineService.loadUsers();
      Boot.step('Data loaded ✓');

      if (_deviceRole === 'field' && _deviceLineId) {
        Boot.step('Loading field line data…');
        await lineService.loadLineData(_deviceLineId);
      }

      Boot.step('Rendering shell…');
      _renderShell();

      if (DB.isMemoryMode) {
        _showMemoryBanner();
      }

      // Route
      if (_deviceRole === 'field') {
        if (!_deviceLineId) {
          Boot.step('Field device — showing provision page');
          _showProvisionPage();
          Boot.done();
          return;
        }
        _currentPage = 'qrForm';
        _renderNav();
        Boot.step('Rendering qrForm…');
        await _renderPage('qrForm');
      } else if (_qrLineId) {
        Boot.step('QR link mode…');
        await lineService.loadLineData(_qrLineId);
        _renderNav();
        _currentPage = 'qrForm';
        await _renderPage('qrForm');
      } else {
        const firstLine = AppState.lines[0];
        if (firstLine) {
          Boot.step(`Loading line: ${firstLine.name}…`);
          await lineService.loadLineData(firstLine.id);
        }
        _renderNav();
        _renderSidebarLineSelector();
        Boot.step('Navigating to dashboard…');
        await navigate('dashboard');
      }

      Boot.done();

    } catch(e) {
      Boot.fatal(e.message, e.stack);
    }
  }

  /* ── Memory-mode banner ───────────────────────────────────────── */
  function _showMemoryBanner() {
    const banner = document.createElement('div');
    banner.id = 'mem-mode-banner';
    banner.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;z-index:9000;
      background:#78350f;color:#fef3c7;
      font-family:monospace;font-size:11px;
      padding:6px 16px;text-align:center;
      border-top:1px solid #92400e;`;
    banner.textContent =
      '⚠ Storage limited in this browser mode. Data will not persist. ' +
      'Open in Chrome or Edge for full functionality.';
    document.body.appendChild(banner);
  }

  /* ── Shell ────────────────────────────────────────────────────── */
  function _renderShell() {
    const xlsxMissing = !window.XLSX;
    const qrMissing   = !window.QRCode;

    document.getElementById('app').innerHTML = `
      <div class="app-shell" id="app-shell">
        <nav class="sidebar" id="sidebar">
          <div class="sidebar-logo">
            <div class="logo-mark">SM</div>
            <span class="logo-text">SkillOps</span>
          </div>
          ${xlsxMissing || qrMissing ? `
          <div style="margin:8px 12px;padding:6px 8px;background:#1c1a14;
            border:1px solid #78350f;border-radius:4px;font-size:9px;
            font-family:monospace;color:#fbbf24;line-height:1.6">
            ${xlsxMissing ? '⚠ Import/Export requires<br>xlsx.full.min.js in libs/<br>' : ''}
            ${qrMissing   ? '⚠ QR codes require<br>qrcode.min.js in libs/' : ''}
          </div>` : ''}
          <div class="sidebar-line-selector" id="line-selector-wrap"></div>
          <nav class="sidebar-nav" id="sidebar-nav"></nav>
          <div class="sidebar-footer">
            <div class="lang-toggle">
              <button class="lang-btn ${window._LANG==='en'?'active':''}" data-lang="en">EN</button>
              <button class="lang-btn ${window._LANG==='es'?'active':''}" data-lang="es">ES</button>
            </div>
            <div class="session-info" id="session-info-footer"></div>
          </div>
        </nav>

        <header class="topbar" id="topbar">
          <span class="topbar-title" id="topbar-title">SkillOps</span>
          <div class="topbar-actions">
            <span class="device-badge ${_deviceRole}" id="device-badge">${t(_deviceRole)}</span>
          </div>
        </header>

        <main class="main-content" id="main">
          <div id="page-content"></div>
        </main>
      </div>
      <div id="toast-container"></div>`;

    document.getElementById('sidebar').addEventListener('click', e => {
      const btn = e.target.closest('[data-lang]');
      if (!btn) return;
      const lang = btn.dataset.lang;
      window._LANG = lang;
      DB.setSetting('language', lang);
      document.querySelectorAll('.lang-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.lang === lang));
      _renderNav();
      _renderSidebarLineSelector();
      _refreshPageTitle();
      _reloadCurrentPage();
    });
  }

  /* ── Sidebar ──────────────────────────────────────────────────── */
  function renderSidebar() {
    _renderNav();
    _renderSidebarLineSelector();
    _updateSessionFooter();
  }

  function _renderNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    const navConfig    = _deviceRole === 'field' ? NAV_FIELD : NAV_AUTHORITY;
    const pendingCount = AppState.skillRecords.filter(r => r.status === 'pending_dual').length;

    let html = '';
    navConfig.forEach(group => {
      html += `<div class="nav-section-label">${t(group.section)}</div>`;
      group.items.forEach(item => {
        const badge = item.badge === 'pendingCount' && pendingCount > 0
          ? `<span class="nav-badge">${pendingCount}</span>` : '';
        html += `<a class="nav-item${_currentPage === item.id ? ' active' : ''}"
          data-page="${item.id}" href="#" role="button">
          <span class="nav-icon">${item.icon}</span>
          <span>${t(item.label)}</span>${badge}
        </a>`;
      });
    });
    nav.innerHTML = html;

    nav.addEventListener('click', e => {
      const link = e.target.closest('[data-page]');
      if (!link) return;
      e.preventDefault();
      navigate(link.dataset.page);
    });
  }

  function _renderSidebarLineSelector() {
    const wrap = document.getElementById('line-selector-wrap');
    if (!wrap || _deviceRole === 'field') { if (wrap) wrap.style.display = 'none'; return; }

    const lines = AppState.lines;
    if (!lines.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = `<select id="line-selector">
      <option value="">${t('select_line')}…</option>
      ${lines.map(l =>
        `<option value="${l.id}"${l.id === AppState.currentLineId ? ' selected' : ''}>${l.name}</option>`
      ).join('')}
    </select>`;

    document.getElementById('line-selector').addEventListener('change', async e => {
      const lineId = parseInt(e.target.value);
      if (!lineId) return;
      Boot.step(`Switching to line ${lineId}…`);
      await lineService.loadLineData(lineId);
      _renderNav();
      _reloadCurrentPage();
    });
  }

  function _updateSessionFooter() {
    const el = document.getElementById('session-info-footer');
    if (!el) return;
    const session = Session.get();
    el.innerHTML = session
      ? `<span class="session-name">${session.name}</span>
         <span style="font-size:9px;color:var(--text-3)">${t('role_'+session.role)}</span>`
      : '';
  }

  /* ── Router ───────────────────────────────────────────────────── */
  async function navigate(page) {
    _currentPage = page;
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page));
    _refreshPageTitle();
    await _renderPage(page);
    _updateSessionFooter();
    document.getElementById('main')?.scrollTo(0, 0);
  }

  async function _renderPage(page) {
    const contentEl = document.getElementById('page-content');
    if (!contentEl) return;
    contentEl.innerHTML =
      `<div style="padding:var(--sp-6);color:var(--text-3);font-family:var(--font-mono);font-size:12px">${t('loading')}</div>`;

    try {
      if (page === 'qrForm') {
        const lineId = _qrLineId || _deviceLineId || AppState.currentLineId;
        if (!lineId) { contentEl.innerHTML = _noLine(); return; }
        const [employees, positions] = await Promise.all([
          DB.getAllByIndex('employees', 'lineId', lineId),
          DB.getAllByIndex('positions', 'lineId', lineId),
        ]);
        await Pages.qrForm(lineId, {
          employees: employees.filter(e => e.active !== false),
          positions
        });
      } else if (page === 'importExport' && !window.XLSX) {
        contentEl.innerHTML = `
          <div class="card" style="max-width:560px;margin:var(--sp-8) auto">
            <div class="card-header"><span class="card-title">Import / Export</span></div>
            <div class="card-body">
              <div class="info-box warn" style="margin-bottom:var(--sp-4)">
                <strong>xlsx.full.min.js</strong> is required for Import/Export.<br>
                Download it from cdnjs.cloudflare.com and place it in the <code>libs/</code> folder,
                then reload.
              </div>
              <a href="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
                target="_blank" rel="noopener" class="btn btn-secondary">
                Download xlsx.full.min.js ↗
              </a>
            </div>
          </div>`;
      } else if (page === 'qr' && !window.QRCode) {
        // QR page still renders — it shows text fallback; Pages.qr handles it
        await Pages[page]();
      } else if (Pages[page]) {
        await Pages[page]();
      } else {
        contentEl.innerHTML = `<div class="empty-state">Page not found: ${page}</div>`;
      }
    } catch(e) {
      console.error(`[page:${page}]`, e);
      contentEl.innerHTML = `
        <div class="info-box error" style="margin:var(--sp-5)">
          <strong>Error loading page: ${_esc(page)}</strong><br>
          ${_esc(e.message)}
          <pre style="font-size:10px;margin-top:8px;color:var(--text-3);
            overflow:auto;max-height:200px">${_esc(e.stack || '')}</pre>
          <button onclick="App.navigate('${page}')" class="btn btn-secondary"
            style="margin-top:12px">Retry</button>
        </div>`;
    }
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _refreshPageTitle() {
    const titleMap = {
      dashboard:'page_dashboard', matrix:'page_matrix', approvals:'page_approvals',
      cross:'page_cross', rotation:'page_rotation', attendance:'page_attendance',
      audits:'page_audits', importExport:'page_import_export', qr:'page_qr',
      reports:'page_reports', sync:'page_sync', setup:'page_setup', qrForm:'log_training'
    };
    const el = document.getElementById('topbar-title');
    if (el) el.textContent = t(titleMap[_currentPage] || 'app_name');
  }

  function _reloadCurrentPage() { navigate(_currentPage); }

  /* ── Provision page ───────────────────────────────────────────── */
  function _showProvisionPage() {
    document.getElementById('app').innerHTML = `
      <div class="overlay-page">
        <div class="overlay-logo">
          <div class="logo-mark-lg">SM</div>
          <div>
            <div class="logo-text-lg">SkillOps</div>
            <div style="font-size:12px;color:var(--text-3);font-family:var(--font-mono)">${t('field')}</div>
          </div>
        </div>
        <div class="card" style="max-width:460px;width:100%">
          <div class="card-header"><span class="card-title">${t('provision_title')}</span></div>
          <div class="card-body">
            <p style="color:var(--text-2);margin-bottom:var(--sp-5)">${t('provision_desc')}</p>
            <div class="upload-zone" id="seed-zone">
              <input type="file" id="seed-file" accept=".json">
              <div class="upload-icon">📱</div>
              <span class="upload-label">${t('provision_load')}</span>
              <span class="upload-hint">${t('provision_hint')}</span>
            </div>
            <div id="prov-status" style="margin-top:var(--sp-4)"></div>
          </div>
        </div>
      </div>
      <div id="toast-container"></div>`;

    const zone  = document.getElementById('seed-zone');
    const input = document.getElementById('seed-file');
    zone.onclick = () => input.click();
    input.onchange = async e => { if (e.target.files[0]) await _doProvision(e.target.files[0]); };
    zone.ondragover  = e => { e.preventDefault(); zone.classList.add('drag-over'); };
    zone.ondragleave = () => zone.classList.remove('drag-over');
    zone.ondrop = e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) _doProvision(e.dataTransfer.files[0]);
    };
  }

  async function _doProvision(file) {
    const status = document.getElementById('prov-status');
    status.innerHTML = `<div class="info-box">${t('loading')}</div>`;
    try {
      const seed = JSON.parse(await file.text());
      await syncService.importSeed(seed);
      status.innerHTML = `<div class="info-box success">${t('provision_success')}</div>`;
      setTimeout(() => location.reload(), 1200);
    } catch(e) {
      status.innerHTML = `<div class="info-box error">${t('provision_error')}: ${e.message}</div>`;
    }
  }

  /* ── Public ───────────────────────────────────────────────────── */
  function setLogger(id, role, name) {
    Session.set(id, role, name);
    _updateSessionFooter();
    _reloadCurrentPage();
  }

  return { init, navigate, renderSidebar, setLogger };
})();

/* ── Shared helpers (must be global for pages.js) ─────────────────── */
function _noLine() {
  return `<div class="empty-state"><div class="empty-icon">⚙</div><p>${t('no_line_selected')}</p></div>`;
}

/* ── Entry point ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  Boot.step('DOMContentLoaded — starting App.init()');
  App.init(); // errors handled internally by Boot.fatal()
});
