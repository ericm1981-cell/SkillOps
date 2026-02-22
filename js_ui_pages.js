/**
 * Pages — All UI page renderers.
 */

const Pages = {};

/* ─── Shared helpers ─────────────────────────────────────────── */
function _today() { return new Date().toISOString().slice(0, 10); }
function _fmtDate(d) { return d ? new Date(d).toLocaleDateString() : t('na'); }
function _fmtTs(ts) { return ts ? new Date(ts).toLocaleString() : t('na'); }
function _levelBadge(level, status) {
  const pending = status === 'pending_dual';
  return `<span class="level-cell lc-${level}${pending ? ' pending' : ''}" title="${t('level_'+level)}">${t('level_short_'+level)}</span>`;
}
function _badge3x3(status) {
  const map = { met: 'badge-met', partial: 'badge-partial', critical: 'badge-critical' };
  const labels = { met: 'met', partial: 'partial_status', critical: 'critical_status' };
  return `<span class="badge ${map[status]}">${t(labels[status])}</span>`;
}
function _noLine() {
  return `<div class="empty-state"><div class="empty-icon">⚙</div><p>${t('no_line_selected')}</p></div>`;
}
function _rc(html) { document.getElementById('page-content').innerHTML = html; }
function _shiftBadge(shift) {
  if (!shift) return '';
  return `<span class="badge badge-info">${t('shift_'+shift)}</span>`;
}
function _colLetter(idx) {
  if (window.XLSX) return XLSX.utils.encode_col(idx);
  let r = '', n = idx + 1;
  while (n > 0) { n--; r = String.fromCharCode(65 + n % 26) + r; n = Math.floor(n / 26); }
  return r;
}
function _colIndex(letter) {
  if (window.XLSX) return XLSX.utils.decode_col(letter.toUpperCase().trim());
  let r = 0;
  for (const c of letter.toUpperCase().trim()) r = r * 26 + (c.charCodeAt(0) - 64);
  return r - 1;
}
function _setupUploadZone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;
  zone.onclick = () => input.click();
  input.onchange = e => { if (e.target.files[0]) handler(e.target.files[0]); };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop = e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  };
}
function _setupTabs(root) {
  (root || document).querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      const parent = btn.closest('.tabs').parentElement;
      parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      parent.querySelector('#tab-' + btn.dataset.tab)?.classList.add('active');
    };
  });
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════ */
Pages.dashboard = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }

  const today = _today();
  if (!AppState.todayAttendance) await attendanceService.loadForDate(lineId, today);

  const employees = AppState.employees;
  const positions = AppState.positions;
  const presentEmps = AppState.getPresentEmployees(today);
  const pendingDual = AppState.skillRecords.filter(r => r.status === 'pending_dual');
  const analysis = crossTraining.analyze(employees, positions, AppState.skillRecords);
  const recentLogs = await trainingLogService.getRecentForLine(lineId, 20);

  const auditLogs = await DB.getAllByIndex('auditLogs', 'lineId', lineId);
  const done = auditLogs.filter(a => a.result !== null);
  const passRate = done.length ? Math.round(done.filter(a => a.result === 'pass').length / done.length * 100) : null;
  const criticalPos = positions.filter(p => p.critical);
  const topPriorities = analysis.recommendations.slice(0, 6);

  _rc(`
    <div class="grid-4" style="margin-bottom:var(--sp-5)">
      <div class="stat-card" style="--stat-color:var(--accent)">
        <div class="stat-value">${employees.length}</div>
        <div class="stat-label">${t('team_members')}</div>
        <div class="stat-sub">${presentEmps.length} ${t('present_today')}</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--blue)">
        <div class="stat-value">${positions.length}</div>
        <div class="stat-label">${t('positions_label')}</div>
        <div class="stat-sub">${criticalPos.length} ${t('critical_count')}</div>
      </div>
      <div class="stat-card" style="--stat-color:${pendingDual.length ? 'var(--amber)' : 'var(--green)'}">
        <div class="stat-value">${pendingDual.length}</div>
        <div class="stat-label">${t('pending_approvals')}</div>
        <div class="stat-sub">${t('awaiting_sig')}</div>
      </div>
      <div class="stat-card" style="--stat-color:${passRate === null ? 'var(--text-3)' : passRate >= 80 ? 'var(--green)' : 'var(--red)'}">
        <div class="stat-value">${passRate !== null ? passRate + '%' : t('na')}</div>
        <div class="stat-label">${t('audit_pass_dash')}</div>
        <div class="stat-sub">${done.length} ${t('total_audits_dash')}</div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:var(--sp-5)">
      <div class="card">
        <div class="card-header">
          <span class="card-title">${t('coverage_by_pos')}</span>
          <span class="badge badge-info">${analysis.summary.positionsMet}/${positions.length} ${t('met')}</span>
        </div>
        <div class="card-body" style="padding:var(--sp-3) var(--sp-4)">
          ${analysis.positionStatus.slice(0, 10).map(ps => `
            <div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:6px">
              <span style="font-size:11px;color:var(--text-2);min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${ps.name}">${ps.name}</span>
              <div class="progress-bar-wrap" style="flex:1">
                <div class="progress-bar-fill ${ps.count >= 3 ? 'green' : ps.count > 0 ? 'amber' : 'red'}" style="width:${Math.min(100, Math.round(ps.count/3*100))}%"></div>
              </div>
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);min-width:24px;text-align:right">${ps.count}/3</span>
            </div>`).join('')}
          ${positions.length > 10 ? `<div style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);margin-top:var(--sp-2)">+${positions.length - 10} more</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">${t('top_priorities')}</span></div>
        <div class="card-body" style="padding:var(--sp-2) 0">
          ${topPriorities.length === 0
            ? `<div class="empty-state" style="padding:var(--sp-6)">${t('no_priorities')}</div>`
            : topPriorities.map(rec => `
              <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4)">
                ${rec.critical ? '<span class="badge badge-error">⚡</span>' : ''}
                <span style="font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rec.positionName}</span>
                <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${rec.currentL3Count}/3</span>
                ${_badge3x3(rec.currentL3Count === 0 ? 'critical' : 'partial')}
              </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">${t('recent_logs')}</span></div>
      ${recentLogs.length === 0
        ? `<div class="empty-state">${t('no_logs_yet')}</div>`
        : `<div style="overflow-x:auto"><table class="data-table">
          <thead><tr><th>${t('col_employee')}</th><th>${t('col_position')}</th><th>${t('col_trainer')}</th><th>${t('col_duration')}</th><th>${t('col_date')}</th><th>${t('col_rec')}</th></tr></thead>
          <tbody>${recentLogs.map(log => `<tr>
            <td class="td-name">${log.employeeNameSnapshot}${!log.employeeResolved ? ' <span class="badge badge-warning">⚠</span>' : ''}</td>
            <td>${log.positionNameSnapshot}</td>
            <td class="td-mono" style="font-size:11px">${log.trainerNameSnapshot || '—'}</td>
            <td class="td-mono">${log.duration}</td>
            <td class="td-mono" style="font-size:10px">${_fmtTs(log.timestamp)}</td>
            <td>${log.recommendLevelChange ? '<span class="badge badge-warning">↑</span>' : ''}</td>
          </tr>`).join('')}</tbody>
          </table></div>`}
    </div>`);
};

/* ══════════════════════════════════════════════════════════════
   SKILLS MATRIX
══════════════════════════════════════════════════════════════ */
Pages.matrix = function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }
  const employees = AppState.employees;
  const positions = AppState.positions;

  _rc(`
    <div class="matrix-filter-bar">
      <input type="text" id="emp-search" placeholder="${t('col_employee')}…" style="max-width:200px">
      <select id="pos-filter">
        <option value="all">All Positions</option>
        <option value="critical">Critical Only</option>
      </select>
      <span class="matrix-scale-info">${employees.length} ${t('team_members')} × ${positions.length} ${t('positions_label')}</span>
    </div>
    <div class="matrix-container" id="matrix-wrap"></div>
    <div class="matrix-legend" style="margin-top:var(--sp-4)">
      ${[0,1,2,3,4].map(l => `<div class="legend-item"><div class="level-cell lc-${l}" style="cursor:default">${t('level_short_'+l)}</div>${t('level_'+l)}</div>`).join('')}
      <div class="legend-item"><div class="level-cell lc-3 pending" style="cursor:default">L3</div>${t('pending_dual')}</div>
    </div>`);

  _buildMatrixTable(employees, positions);

  document.getElementById('emp-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('tr.emp-row').forEach(row => {
      row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  document.getElementById('pos-filter').addEventListener('change', e => {
    const crit = e.target.value === 'critical';
    document.querySelectorAll('th.th-pos').forEach(th => {
      th.style.display = (!crit || th.dataset.critical === 'true') ? '' : 'none';
    });
    document.querySelectorAll('td.td-skill').forEach(td => {
      const pos = AppState.positions.find(p => p.id === +td.dataset.pos);
      td.style.display = (!crit || (pos && pos.critical)) ? '' : 'none';
    });
  });
};

function _buildMatrixTable(employees, positions) {
  const wrap = document.getElementById('matrix-wrap');
  if (!wrap) return;
  const sm = AppState.skillMap;

  const headers = positions.map(p =>
    `<th class="th-pos" data-pos="${p.id}" data-critical="${p.critical}">
      <div class="pos-header-wrap"><span class="pos-header-text${p.critical ? ' critical' : ''}" title="${p.name}">${p.name}</span></div>
    </th>`).join('');

  const rows = employees.map(emp => {
    const cells = positions.map(pos => {
      const rec = sm.get(`${emp.id}_${pos.id}`);
      const lv = rec ? rec.currentLevel : 0;
      const pending = rec && rec.status === 'pending_dual';
      return `<td class="td-skill" data-emp="${emp.id}" data-pos="${pos.id}">
        <div class="level-cell lc-${lv}${pending ? ' pending' : ''}">${t('level_short_'+lv)}</div>
      </td>`;
    }).join('');
    return `<tr class="emp-row" data-name="${emp.name}" data-emp="${emp.id}">
      <td class="td-roster">
        <span class="emp-name">${emp.name}</span>
        <span class="emp-role-badge">${emp.role === 'teamlead' ? 'TL' : emp.role === 'supervisor' ? 'SUP' : ''}</span>
      </td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `<table class="matrix-table">
    <thead><tr><th class="th-corner">${t('col_employee')}</th>${headers}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${positions.length+1}" class="empty-state">No employees</td></tr>`}</tbody>
  </table>`;

  wrap.addEventListener('click', e => {
    const td = e.target.closest('td.td-skill');
    if (td) _openSkillModal(+td.dataset.emp, +td.dataset.pos);
  });
}

async function _openSkillModal(empId, posId) {
  const emp = AppState.employees.find(e => e.id === empId);
  const pos = AppState.positions.find(p => p.id === posId);
  if (!emp || !pos) return;

  let rec = await skillService.getOrBlank(empId, posId);
  rec = { ...rec, lineId: AppState.currentLineId };

  const isSup = Session.isSupervisor();
  const isPending = rec.status === 'pending_dual';
  const canPromote = rec.currentLevel < 4;
  const targetLv = rec.currentLevel + 1;

  const approvalHtml = (rec.approvals || []).map(a =>
    `<div class="history-entry"><div class="history-dot promotion"></div>
      <div><div class="history-text">${a.approverName} <span class="badge badge-info">${a.role}</span> → ${t('level_'+a.forLevel)}</div>
      <div class="history-meta">${_fmtTs(a.timestamp)}${a.comment ? ' — '+a.comment : ''}</div></div></div>`).join('');

  const histHtml = (rec.history || []).slice().reverse().map(h =>
    `<div class="history-entry"><div class="history-dot ${h.type}"></div>
      <div><div class="history-text">${t('level_'+h.fromLevel)} → ${t('level_'+h.toLevel)} <span class="badge badge-info">${h.type}</span></div>
      <div class="history-meta">${_fmtTs(h.at)} · ${h.by}${h.reason ? ' — '+h.reason : ''}</div></div></div>`).join('');

  Modal.open({
    title: `${emp.name} · ${pos.name}`, maxWidth: '600px',
    body: `
      <div style="display:flex;align-items:center;gap:var(--sp-4);padding:var(--sp-4);background:var(--bg-3);border-radius:var(--r);margin-bottom:var(--sp-4)">
        ${_levelBadge(rec.currentLevel, rec.status)}
        <div>
          <div style="font-size:15px;font-weight:600">${t('level_'+rec.currentLevel)}</div>
          ${isPending ? `<span class="badge badge-pending">${t('pending_dual')} → ${t('level_'+rec.requestedLevel)}</span>`
                      : `<span class="badge badge-success">${t('approved')}</span>`}
        </div>
      </div>

      ${canPromote ? `<div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header"><span class="card-title">${isPending ? t('second_approval') : t('promote_to') + ' ' + t('level_'+targetLv)}</span></div>
        <div class="card-body">
          <div class="form-grid-2" style="margin-bottom:var(--sp-3)">
            <div class="form-group"><label>${t('your_name')}</label><input type="text" id="appr-name"></div>
            <div class="form-group"><label>${t('your_role')}</label>
              <select id="appr-role">
                <option value="teamlead">${t('role_teamlead')}</option>
                <option value="supervisor">${t('role_supervisor')}</option>
              </select>
            </div>
          </div>
          <div class="form-group"><label>${t('comment_optional')}</label><input type="text" id="appr-comment" placeholder="…"></div>
          <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-4)">
            <button class="btn btn-primary" id="btn-promote">${t('promote_to')} ${t('level_'+targetLv)}</button>
            ${isSup && rec.currentLevel > 0 ? `<button class="btn btn-danger" id="btn-demote">${t('demote')}</button>` : ''}
          </div>
          <div class="form-error" id="promote-err" style="margin-top:var(--sp-2)"></div>
        </div>
      </div>` : `<div class="info-box" style="margin-bottom:var(--sp-4)">Already at maximum level (L4)${isSup ? ` — <a href="#" id="btn-demote" style="color:var(--red)">${t('demote')}</a>` : ''}</div>`}

      ${approvalHtml ? `<div class="card" style="margin-bottom:var(--sp-4)">
        <div class="card-header"><span class="card-title">${t('approval_chain')}</span></div>
        <div class="card-body" style="padding:var(--sp-3) var(--sp-4)">${approvalHtml}</div>
      </div>` : ''}

      <details><summary style="cursor:pointer;font-family:var(--font-mono);font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em">${t('history')}</summary>
        <div style="margin-top:var(--sp-3)">${histHtml || `<div class="history-meta">${t('no_history')}</div>`}</div>
      </details>`
  });

  document.getElementById('btn-promote')?.addEventListener('click', async () => {
    const name = document.getElementById('appr-name').value.trim();
    const role = document.getElementById('appr-role').value;
    const comment = document.getElementById('appr-comment').value.trim();
    const errEl = document.getElementById('promote-err');
    errEl.textContent = '';
    const result = await skillService.promote(rec, name, role, comment);
    if (!result.ok) { errEl.textContent = t(result.error); return; }
    rec = result.newRecord;
    Modal.close();
    Toast[result.promoted ? 'success' : 'warn'](
      result.promoted ? `${emp.name} → ${t('level_'+rec.currentLevel)}` : `${t('pending_dual')}: ${emp.name} → ${t('level_'+rec.requestedLevel)}`
    );
    _refreshMatrixCell(empId, posId, rec);
  });

  document.getElementById('btn-demote')?.addEventListener('click', () => _openDemoteModal(rec, emp, pos));
}

function _refreshMatrixCell(empId, posId, rec) {
  const cell = document.querySelector(`td.td-skill[data-emp="${empId}"][data-pos="${posId}"]`);
  if (cell) cell.innerHTML = `<div class="level-cell lc-${rec.currentLevel}${rec.status==='pending_dual'?' pending':''}">${t('level_short_'+rec.currentLevel)}</div>`;
}

function _openDemoteModal(rec, emp, pos) {
  const opts = Array.from({length: rec.currentLevel}, (_, i) =>
    `<option value="${i}">${t('level_'+i)}</option>`).join('');
  Modal.open({
    title: `${t('demote')} — ${emp.name}`,
    body: `
      <div class="info-box warn" style="margin-bottom:var(--sp-4)">${emp.name} @ ${pos.name}: ${t('level_'+rec.currentLevel)}</div>
      <div class="form-grid-2">
        <div class="form-group"><label>${t('demote_to')}</label><select id="dem-level">${opts}</select></div>
        <div class="form-group"><label>${t('your_name')}</label><input type="text" id="dem-name"></div>
      </div>
      <div class="form-group"><label>${t('reason_required')}</label>
        <textarea id="dem-reason" placeholder="${t('demotion_reason_placeholder')}"></textarea>
        <div class="form-error" id="dem-err"></div>
      </div>`,
    footer: `<button class="btn btn-secondary" id="dem-cancel">${t('cancel')}</button>
             <button class="btn btn-danger" id="dem-ok">${t('confirm_demotion')}</button>`
  });
  document.getElementById('dem-cancel').onclick = Modal.close;
  document.getElementById('dem-ok').onclick = async () => {
    const level = +document.getElementById('dem-level').value;
    const name = document.getElementById('dem-name').value.trim();
    const reason = document.getElementById('dem-reason').value.trim();
    const result = await skillService.demote(rec, name, level, reason);
    if (!result.ok) { document.getElementById('dem-err').textContent = t(result.error); return; }
    Modal.close();
    Toast.success(`${t('demote')}: ${emp.name} → ${t('level_'+level)}`);
    _refreshMatrixCell(emp.id, pos.id, result.newRecord);
  };
}

/* ══════════════════════════════════════════════════════════════
   APPROVALS
══════════════════════════════════════════════════════════════ */
Pages.approvals = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }

  const [pendingDual, pendingRecs] = await Promise.all([
    skillService.getPendingDual(lineId),
    skillService.getPendingRecs(lineId)
  ]);
  const empName = id => AppState.employees.find(e => e.id === id)?.name || t('unknown');
  const posName = id => AppState.positions.find(p => p.id === id)?.name || t('unknown');

  _rc(`
    <div class="tabs">
      <button class="tab-btn active" data-tab="dual">${t('pending_dual')} (${pendingDual.length})</button>
      <button class="tab-btn" data-tab="recs">${t('training_recommended')} (${pendingRecs.length})</button>
    </div>
    <div id="tab-dual" class="tab-panel active">
      ${!pendingDual.length ? `<div class="empty-state"><div class="empty-icon">✓</div><p>No pending approvals</p></div>`
        : `<table class="data-table"><thead><tr>
          <th>${t('col_employee')}</th><th>${t('col_position')}</th><th>${t('col_level')}</th><th>${t('col_actions')}</th>
        </tr></thead><tbody>
          ${pendingDual.map(r => `<tr>
            <td class="td-name">${empName(r.employeeId)}</td>
            <td>${posName(r.positionId)}</td>
            <td>${_levelBadge(r.currentLevel, r.status)} → ${t('level_'+(r.requestedLevel||0))}</td>
            <td><button class="btn btn-sm btn-primary" data-emp="${r.employeeId}" data-pos="${r.positionId}">${t('second_approval')}</button></td>
          </tr>`).join('')}
        </tbody></table>`}
    </div>
    <div id="tab-recs" class="tab-panel">
      ${!pendingRecs.length ? `<div class="empty-state"><div class="empty-icon">✓</div><p>No recommendations</p></div>`
        : `<table class="data-table"><thead><tr>
          <th>${t('col_employee')}</th><th>${t('col_position')}</th><th>${t('col_level')}</th><th>${t('col_date')}</th><th>${t('col_actions')}</th>
        </tr></thead><tbody>
          ${pendingRecs.map(r => `<tr>
            <td class="td-name">${r.employeeNameSnapshot}</td>
            <td>${r.positionNameSnapshot}</td>
            <td>${_levelBadge(r.currentLevel||0)} → <span class="badge badge-warning">L${r.suggestedLevel||1}</span></td>
            <td class="td-mono">${_fmtDate(r.createdAt)}</td>
            <td style="display:flex;gap:var(--sp-2)">
              <button class="btn btn-sm btn-primary" data-action="promote-rec" data-rec="${r.id}" data-emp="${r.employeeId}" data-pos="${r.positionId}">${t('promote')}</button>
              <button class="btn btn-sm btn-ghost" data-action="dismiss-rec" data-rec="${r.id}">${t('cancel')}</button>
            </td>
          </tr>`).join('')}
        </tbody></table>`}
    </div>`);

  _setupTabs();

  document.querySelectorAll('[data-emp][data-pos]').forEach(btn => {
    btn.onclick = () => _openSkillModal(+btn.dataset.emp, +btn.dataset.pos);
  });
  document.querySelectorAll('[data-action="promote-rec"]').forEach(btn => {
    btn.onclick = async () => {
      await skillService.actionRecommendation(+btn.dataset.rec, 'promoted', Session.get()?.name || '', '');
      _openSkillModal(+btn.dataset.emp, +btn.dataset.pos);
    };
  });
  document.querySelectorAll('[data-action="dismiss-rec"]').forEach(btn => {
    btn.onclick = async () => {
      const ok = await confirmDialog(t('confirm_delete'));
      if (!ok) return;
      await skillService.actionRecommendation(+btn.dataset.rec, 'dismissed', Session.get()?.name || '', '');
      Toast.success(t('deactivated')); Pages.approvals();
    };
  });
};

/* ══════════════════════════════════════════════════════════════
   CROSS-TRAINING 3×3
══════════════════════════════════════════════════════════════ */
Pages.cross = function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }

  const analysis = crossTraining.analyze(AppState.employees, AppState.positions, AppState.skillRecords);
  const s = analysis.summary;

  _rc(`
    <div class="grid-4" style="margin-bottom:var(--sp-5)">
      <div class="stat-card" style="--stat-color:var(--green)">
        <div class="stat-value">${s.positionsMet}</div><div class="stat-label">${t('positions_met')}</div>
        <div class="stat-sub">${s.positionsPartial} partial · ${s.positionsCritical} critical</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--blue)">
        <div class="stat-value">${s.employeesMet}</div><div class="stat-label">${t('employees_met')}</div>
        <div class="stat-sub">${s.employeesPartial} partial · ${s.employeesCritical} critical</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--accent)">
        <div class="stat-value">${Math.round(s.fillRate*100)}%</div><div class="stat-label">Fill Rate</div>
        <div class="stat-sub">${s.filledSlots}/${s.totalSlots} slots</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--purple)">
        <div class="stat-value">${analysis.recommendations.length}</div><div class="stat-label">${t('recommendations')}</div>
        <div class="stat-sub">positions below target</div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="bypos">${t('by_position')}</button>
      <button class="tab-btn" data-tab="byperson">${t('by_person')}</button>
      <button class="tab-btn" data-tab="recs">${t('recommendations')}</button>
    </div>
    <div id="tab-bypos" class="tab-panel active">
      <table class="data-table"><thead><tr>
        <th>${t('col_position')}</th><th>${t('col_critical')}</th><th>${t('col_l3plus')}</th><th>${t('col_3x3')}</th>
      </tr></thead><tbody>
        ${analysis.positionStatus.map(ps => `<tr>
          <td class="td-name">${ps.name}</td>
          <td>${ps.critical ? '<span class="badge badge-error">⚡</span>' : ''}</td>
          <td class="td-mono">${ps.count}</td>
          <td>${_badge3x3(ps.status)}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>
    <div id="tab-byperson" class="tab-panel">
      <table class="data-table"><thead><tr>
        <th>${t('col_employee')}</th><th>${t('col_l3plus')}</th><th>${t('col_3x3')}</th>
      </tr></thead><tbody>
        ${analysis.employeeStatus.map(es => `<tr>
          <td class="td-name">${es.name}</td>
          <td class="td-mono">${es.count}</td>
          <td>${_badge3x3(es.status)}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>
    <div id="tab-recs" class="tab-panel">
      ${!analysis.recommendations.length
        ? `<div class="empty-state"><div class="empty-icon">✓</div><p>${t('all_met')}</p></div>`
        : analysis.recommendations.map(rec => `
          <div class="card" style="margin-bottom:var(--sp-4)">
            <div class="card-header">
              <span class="card-title">${rec.positionName} ${rec.critical ? '<span class="badge badge-error">⚡</span>' : ''}</span>
              <span>${_badge3x3(rec.currentL3Count===0?'critical':'partial')} <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${rec.currentL3Count}/3</span></span>
            </div>
            <div class="card-body" style="padding:var(--sp-3) var(--sp-4)">
              <div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono);margin-bottom:var(--sp-2)">Need ${rec.need} more at L3+</div>
              ${rec.candidates.slice(0,5).map(c => `<div style="display:flex;align-items:center;gap:var(--sp-3);padding:2px 0">
                ${_levelBadge(c.currentLevel, c.status)}
                <span style="font-size:12px;color:var(--text-2)">${c.name}</span>
                ${c.currentLevel===0 ? `<span class="badge badge-warning">${t('not_started')}</span>` : ''}
              </div>`).join('')}
            </div>
          </div>`).join('')}
    </div>`);
  _setupTabs();
};

/* ══════════════════════════════════════════════════════════════
   ROTATION PLANNER
══════════════════════════════════════════════════════════════ */
Pages.rotation = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }
  const today = _today();

  _rc(`
    <div class="card" style="margin-bottom:var(--sp-5)">
      <div class="card-body">
        <div class="flex-gap">
          <div class="form-group" style="margin:0">
            <label>${t('rotation_date')}</label>
            <input type="date" id="rot-date" value="${today}" style="width:160px">
          </div>
          <label class="checkbox-row" id="bb-wrap" style="margin-top:18px;cursor:pointer">
            <input type="checkbox" id="bb-mode">
            <span class="checkbox-label">${t('bb_mode')}</span>
          </label>
          <button class="btn btn-primary" id="gen-btn" style="margin-top:18px">${t('generate')}</button>
        </div>
      </div>
    </div>
    <div id="rotation-result"></div>`);

  document.getElementById('gen-btn').onclick = async () => {
    const date = document.getElementById('rot-date').value;
    const bbMode = document.getElementById('bb-mode').checked;
    const btn = document.getElementById('gen-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const plan = await rotationService.generate(lineId, date, bbMode);
      _renderRotationPlan(plan);
    } catch(e) { Toast.error(e.message); }
    finally { btn.disabled = false; btn.textContent = t('generate'); }
  };

  // Load existing for today
  const plans = await DB.getAllByIndex('rotationPlans', 'lineDate', IDBKeyRange.only([lineId, today]));
  if (plans.length) _renderRotationPlan(plans[0]);
};

function _renderRotationPlan(plan) {
  const el = document.getElementById('rotation-result');
  if (!el) return;
  const empName = id => AppState.employees.find(e => e.id === id)?.name || t('unknown');
  const posName = id => AppState.positions.find(p => p.id === id)?.name || t('unknown');
  const periods = ['A','B','C'];
  const pLabels = { A: t('period_a'), B: t('period_b'), C: t('period_c') };

  el.innerHTML = `
    <div class="flex-gap" style="margin-bottom:var(--sp-4)">
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-3)">${plan.date}</span>
      ${plan.bbMode ? '<span class="badge badge-warning">BB MODE</span>' : ''}
      ${!plan.violations.length && !plan.gaps.filter(g=>g.reason!=='bb_skipped').length
        ? `<span class="badge badge-success">${t('rotation_clean')}</span>`
        : `<span class="badge badge-error">${plan.violations.length} violations · ${plan.gaps.filter(g=>g.reason!=='bb_skipped').length} gaps</span>`}
    </div>
    <div class="grid-3" style="margin-bottom:var(--sp-5)">
      ${periods.map(p => {
        const slots = plan.slots.filter(s => s.period === p);
        const gaps  = plan.gaps.filter(g => g.period === p && g.reason !== 'bb_skipped');
        return `<div class="card">
          <div class="card-header"><span class="card-title">${pLabels[p]}</span></div>
          <div style="padding:var(--sp-1) 0">
            ${slots.map(s => `<div style="display:flex;align-items:center;gap:var(--sp-3);padding:6px var(--sp-4)${s.violation?';background:rgba(239,68,68,.05)':''}">
              <span style="font-size:12px;color:var(--text);min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${empName(s.employeeId)}</span>
              <span style="font-size:11px;color:var(--text-3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${posName(s.positionId)}</span>
              ${s.violation ? `<span class="vio-tag vio-${(s.violationReason||'').replace('violation_','')}">${t(s.violationReason||'violation_repeat')}</span>` : ''}
            </div>`).join('')}
            ${gaps.map(g => `<div style="display:flex;align-items:center;gap:var(--sp-3);padding:6px var(--sp-4);background:rgba(239,68,68,.05)">
              <span style="font-size:12px;color:var(--red)">OPEN</span>
              <span style="font-size:11px;color:var(--text-3);flex:1">${posName(g.positionId)}</span>
              <span class="vio-tag vio-gap">${t('gap_label')}</span>
            </div>`).join('')}
            ${!slots.length && !gaps.length ? `<div style="padding:var(--sp-3) var(--sp-4);font-size:11px;color:var(--text-3)">No assignments</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${plan.suggestions.length ? `<div class="card">
      <div class="card-header"><span class="card-title">${t('who_train')}</span></div>
      <div style="padding:var(--sp-2) 0">
        ${plan.suggestions.slice(0,8).map(s => `<div style="display:flex;align-items:center;gap:var(--sp-3);padding:6px var(--sp-4)">
          <span style="font-size:12px;color:var(--text);min-width:120px">${s.positionName}</span>
          <span class="badge badge-error">${t('urgency')} ${s.urgencyScore}</span>
          <span style="font-size:11px;color:var(--text-3)">${s.candidates.slice(0,3).map(c=>c.name).join(', ')}</span>
        </div>`).join('')}
      </div>
    </div>` : ''}`;
}

/* ══════════════════════════════════════════════════════════════
   ATTENDANCE
══════════════════════════════════════════════════════════════ */
Pages.attendance = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }
  const today = _today();
  await attendanceService.loadForDate(lineId, today);
  const employees = AppState.employees;
  const attMap = AppState.todayAttendance || new Map();

  _rc(`
    <div class="card">
      <div class="card-header">
        <span class="card-title">${t('today_attendance')} — ${today}</span>
        <button class="btn btn-primary btn-sm" id="save-att">${t('save_attendance')}</button>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th>${t('col_employee')}</th><th>${t('col_status')}</th>
            <th>${t('partial_hours')}</th><th>${t('notes')}</th>
          </tr></thead>
          <tbody>
            ${employees.map(emp => {
              const rec = attMap.get(emp.id);
              const st = rec?.status || 'present';
              return `<tr data-emp="${emp.id}">
                <td class="td-name">${emp.name}</td>
                <td><select class="att-status" style="width:180px">
                  ${['present','absent_approved','absent_unapproved','partial'].map(s =>
                    `<option value="${s}"${st===s?' selected':''}>${t(s)}</option>`).join('')}
                </select></td>
                <td><input type="number" class="att-hours" min="0.5" max="11.5" step="0.5"
                  value="${rec?.partialHours||''}" style="width:80px;display:${st==='partial'?'block':'none'}"></td>
                <td><input type="text" class="att-notes" value="${rec?.notes||''}" style="width:200px"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`);

  document.querySelectorAll('.att-status').forEach(sel => {
    sel.onchange = () => {
      const hoursInput = sel.closest('tr').querySelector('.att-hours');
      if (hoursInput) hoursInput.style.display = sel.value === 'partial' ? 'block' : 'none';
    };
  });

  document.getElementById('save-att').onclick = async () => {
    const formData = Array.from(document.querySelectorAll('tr[data-emp]')).map(row => ({
      employeeId: +row.dataset.emp,
      status: row.querySelector('.att-status').value,
      partialHours: row.querySelector('.att-hours')?.value || null,
      notes: row.querySelector('.att-notes')?.value || null
    }));
    await attendanceService.saveAll(lineId, today, _deriveShift(), formData);
    Toast.success(t('attendance_saved'));
  };
};

function _deriveShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'day';
  if (h >= 14 && h < 22) return 'afternoon';
  return 'night';
}

/* ══════════════════════════════════════════════════════════════
   AUDITS
══════════════════════════════════════════════════════════════ */
Pages.audits = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }
  const session = Session.get();
  if (!session || session.role !== 'supervisor') {
    _rc(`<div class="info-box warn">${t('supervisor_only')}</div>`); return;
  }
  const today = _today();
  const auditInfo = await auditService.getTodaysAudit(lineId, session.id, today);
  const history  = await auditService.getHistory(lineId, session.id);
  const passRate = history.length ? Math.round(history.filter(a=>a.result==='pass').length/history.length*100) : null;

  _rc(`
    <div class="grid-2" style="margin-bottom:var(--sp-5)">
      <div class="card">
        <div class="card-header"><span class="card-title">${t('todays_audit')}</span></div>
        <div class="card-body">
          ${!auditInfo ? `<div class="empty-state">${t('no_positions_audit')}</div>` : `
            ${auditInfo.cycleReset ? `<div class="info-box" style="margin-bottom:var(--sp-3)">${t('cycle_reset')}</div>` : ''}
            <div style="font-size:18px;font-weight:600;color:var(--text);margin-bottom:var(--sp-4)">${auditInfo.audit.positionName}</div>
            ${auditInfo.audit.result === null ? `
              <div class="form-group">
                <label>${t('audit_notes')}</label>
                <textarea id="audit-notes" rows="3">${auditInfo.audit.notes||''}</textarea>
              </div>
              <div style="display:flex;gap:var(--sp-3)">
                <button class="btn btn-primary" id="btn-pass">${t('pass')} ✓</button>
                <button class="btn btn-danger" id="btn-fail">${t('fail')} ✗</button>
              </div>` :
              `<span class="badge ${auditInfo.audit.result==='pass'?'badge-success':'badge-error'}" style="font-size:13px;padding:4px 10px">${t(auditInfo.audit.result)}</span>
               ${auditInfo.audit.notes ? `<p style="margin-top:var(--sp-3);font-size:12px;color:var(--text-2)">${auditInfo.audit.notes}</p>` : ''}`}
          `}
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">${t('audit_pass_rate')}</span>
          <span class="badge badge-info">${history.length} ${t('total_audits_dash')}</span>
        </div>
        <div class="card-body">
          ${passRate !== null ? `
            <div style="font-size:32px;font-weight:700;font-family:var(--font-mono);margin-bottom:var(--sp-3)">${passRate}%</div>
            <div class="progress-bar-wrap" style="height:8px">
              <div class="progress-bar-fill ${passRate>=80?'green':passRate>=50?'amber':'red'}" style="width:${passRate}%"></div>
            </div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);margin-top:var(--sp-2)">
              ${history.filter(a=>a.result==='pass').length} pass · ${history.filter(a=>a.result==='fail').length} fail
            </div>` : `<div class="empty-state" style="padding:var(--sp-6)">No audits yet</div>`}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">${t('audit_history')}</span></div>
      ${!history.length ? `<div class="empty-state">No audit history</div>` :
        `<table class="data-table"><thead><tr>
          <th>${t('col_date')}</th><th>${t('col_position')}</th><th>${t('col_result')}</th><th>${t('notes')}</th>
        </tr></thead><tbody>
          ${history.map(a => `<tr>
            <td class="td-mono">${a.date}</td>
            <td class="td-name">${a.positionName}</td>
            <td><span class="badge ${a.result==='pass'?'badge-success':'badge-error'}">${t(a.result)}</span></td>
            <td style="font-size:11px;color:var(--text-3)">${a.notes||''}</td>
          </tr>`).join('')}
        </tbody></table>`}
    </div>`);

  if (auditInfo?.audit.result === null) {
    const log = async (result) => {
      const notes = document.getElementById('audit-notes')?.value || '';
      await auditService.logResult(auditInfo.audit.id, result, notes);
      Toast.success(`${t('log_audit')}: ${t(result)}`);
      Pages.audits();
    };
    document.getElementById('btn-pass')?.addEventListener('click', () => log('pass'));
    document.getElementById('btn-fail')?.addEventListener('click', () => log('fail'));
  }
};

/* ══════════════════════════════════════════════════════════════
   IMPORT / EXPORT
══════════════════════════════════════════════════════════════ */
Pages.importExport = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }
  const hasXLSX = !!window.XLSX;
  const tmRecord = await DB.getByIndex('templateMappings', 'lineId', lineId);

  _rc(`
    ${!hasXLSX ? `<div class="info-box error" style="margin-bottom:var(--sp-4)">${t('no_xlsx')} — place <code>xlsx.full.min.js</code> in the <code>libs/</code> folder.</div>` : ''}
    <div class="tabs">
      <button class="tab-btn active" data-tab="template">${t('template_tab')}</button>
      <button class="tab-btn" data-tab="import">${t('import_tab')}</button>
      <button class="tab-btn" data-tab="export">${t('export_tab')}</button>
    </div>
    <div id="tab-template" class="tab-panel active">
      <div class="card">
        <div class="card-header">
          <span class="card-title">${t('upload_template')}</span>
          ${tmRecord ? `<span class="badge badge-success">${tmRecord.fileName||'saved'} · ${tmRecord.detectionMethod}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="upload-zone" id="template-zone">
            <input type="file" id="template-file" accept=".xlsx,.xls">
            <div class="upload-icon">📋</div>
            <span class="upload-label">${t('drop_excel')}</span>
            <span class="upload-hint">${t('excel_formats')}</span>
          </div>
          <div id="template-status" style="margin-top:var(--sp-4)"></div>
        </div>
      </div>
    </div>
    <div id="tab-import" class="tab-panel">
      <div class="card">
        <div class="card-header"><span class="card-title">${t('upload_matrix')}</span></div>
        <div class="card-body">
          <div class="upload-zone" id="import-zone">
            <input type="file" id="import-file" accept=".xlsx,.xls">
            <div class="upload-icon">📥</div>
            <span class="upload-label">${t('drop_excel')}</span>
            <span class="upload-hint">${t('excel_formats')}</span>
          </div>
          <div id="import-status" style="margin-top:var(--sp-4)"></div>
        </div>
      </div>
    </div>
    <div id="tab-export" class="tab-panel">
      <div class="card">
        <div class="card-header"><span class="card-title">${t('export_excel')}</span></div>
        <div class="card-body">
          ${!tmRecord ? `<div class="info-box warn">${t('no_template')}</div>` :
            `<p style="color:var(--text-2);margin-bottom:var(--sp-4)">Export skills matrix to Excel using saved template.</p>
             <button class="btn btn-primary" id="export-btn">${t('export_excel')}</button>`}
        </div>
      </div>
    </div>`);

  _setupTabs();

  const handleUpload = async (file, statusId) => {
    const status = document.getElementById(statusId);
    status.innerHTML = `<div class="info-box">${t('analyzing')}</div>`;
    try {
      const result = await importExportService.importExcel(file, lineId);
      if (result.needsReview) {
        _showMappingReview(result.workbook, result.detection, lineId, result.binary, file.name, statusId);
      } else {
        const s = result.stats;
        status.innerHTML = `<div class="info-box success">${t('import_complete')}: ${s.newEmployees} ${t('new_employees')}, ${s.newPositions} ${t('new_positions')}, ${s.skillRecords} ${t('skill_records')}</div>`;
        Toast.success(t('import_complete'));
        await lineService.loadLineData(lineId);
      }
    } catch(e) { status.innerHTML = `<div class="info-box error">${e.message}</div>`; }
  };

  _setupUploadZone('template-zone', 'template-file', f => handleUpload(f, 'template-status'));
  _setupUploadZone('import-zone',   'import-file',   f => handleUpload(f, 'import-status'));
  document.getElementById('export-btn')?.addEventListener('click', async () => {
    try { await importExportService.exportExcel(lineId); Toast.success(t('export_excel')); }
    catch(e) { Toast.error(e.message); }
  });
};

function _showMappingReview(workbook, detection, lineId, binary, fileName, statusId) {
  const ws = workbook.Sheets[detection.sheet];
  const range = window.XLSX ? XLSX.utils.decode_range(ws['!ref']||'A1:A1') : {s:{r:0,c:0},e:{r:20,c:15}};
  let grid = `<div style="overflow:auto;max-height:260px;border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:var(--sp-4)"><table style="border-collapse:collapse;font-family:var(--font-mono);font-size:10px">`;
  for (let r = range.s.r; r <= Math.min(39, range.e.r); r++) {
    grid += '<tr>';
    for (let c = range.s.c; c <= Math.min(24, range.e.c); c++) {
      const addr = window.XLSX ? XLSX.utils.encode_cell({r,c}) : '';
      const val = ws[addr] ? String(ws[addr].v||'') : '';
      let bg = 'transparent';
      if (r === detection.headerRow) bg = 'rgba(245,158,11,.2)';
      else if (c === detection.rosterCol && r >= detection.firstRosterRow) bg = 'rgba(59,130,246,.2)';
      else if (r >= detection.firstRosterRow && c >= detection.firstPositionCol) bg = 'rgba(34,197,94,.08)';
      grid += `<td style="padding:2px 5px;border:1px solid var(--border);background:${bg};white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis">${val}</td>`;
    }
    grid += '</tr>';
  }
  grid += '</table></div>';

  const sheetOpts = workbook.SheetNames.map(s => `<option value="${s}"${s===detection.sheet?' selected':''}>${s}</option>`).join('');

  Modal.open({
    title: t('mapping_review'), maxWidth: '800px',
    body: `
      ${!detection.valid ? `<div class="info-box error" style="margin-bottom:var(--sp-4)">${(detection.errors||[]).join(' · ')}</div>` : ''}
      ${grid}
      <div style="font-size:10px;color:var(--text-3);font-family:var(--font-mono);margin-bottom:var(--sp-4)">🟡 Header &nbsp;🔵 Roster &nbsp;🟢 Skills Grid</div>
      <div class="form-grid-2">
        <div class="form-group"><label>Sheet</label><select id="map-sheet">${sheetOpts}</select></div>
        <div class="form-group"><label>${t('header_row')}</label><input type="number" id="map-header" value="${detection.headerRow+1}" min="1"></div>
        <div class="form-group"><label>${t('roster_col')}</label><input type="text" id="map-roster" value="${_colLetter(detection.rosterCol)}"></div>
        <div class="form-group"><label>${t('first_pos_col')}</label><input type="text" id="map-fpc" value="${_colLetter(detection.firstPositionCol)}"></div>
        <div class="form-group"><label>${t('first_roster_row')}</label><input type="number" id="map-frr" value="${detection.firstRosterRow+1}" min="1"></div>
      </div>
      <div id="map-val-result" style="margin-top:var(--sp-3)"></div>`,
    footer: `<button class="btn btn-secondary" id="map-cancel">${t('cancel')}</button>
             <button class="btn btn-secondary" id="map-validate">${t('validate_mapping')}</button>
             <button class="btn btn-primary" id="map-save">${t('confirm_mapping')}</button>`
  });

  const readForm = () => ({
    sheet: document.getElementById('map-sheet').value,
    headerRow: +document.getElementById('map-header').value - 1,
    rosterCol: _colIndex(document.getElementById('map-roster').value||'A'),
    firstPositionCol: _colIndex(document.getElementById('map-fpc').value||'C'),
    firstRosterRow: +document.getElementById('map-frr').value - 1,
  });

  document.getElementById('map-cancel').onclick = Modal.close;
  document.getElementById('map-validate').onclick = () => {
    const m = readForm();
    const v = templateMapper.validateOnly(workbook.Sheets[m.sheet], m);
    const el = document.getElementById('map-val-result');
    el.innerHTML = v.valid
      ? `<div class="info-box success">${t('validation_pass')}: ${v.positionHeaders} positions, ${v.rosterEntries} employees</div>`
      : `<div class="info-box error">${t('validation_fail')}: ${(v.errors||[]).join(' · ')}</div>`;
  };
  document.getElementById('map-save').onclick = async () => {
    const m = { ...readForm(), method: 'manual' };
    try {
      await importExportService.saveMapping(workbook, m, lineId, binary, fileName);
      Modal.close();
      Toast.success(t('template_manual'));
      await lineService.loadLineData(lineId);
      Pages.importExport();
    } catch(e) { Toast.error(e.message); }
  };
}

/* ══════════════════════════════════════════════════════════════
   QR CODES (Authority — print page)
══════════════════════════════════════════════════════════════ */
Pages.qr = function() {
  const lineId = AppState.currentLineId;
  const lines   = AppState.lines;
  _rc(`
    <div class="card">
      <div class="card-header"><span class="card-title">${t('page_qr')}</span></div>
      <div class="card-body">
        <p style="color:var(--text-2);margin-bottom:var(--sp-5)">${t('qr_desc')}</p>
        <div class="form-group" style="max-width:280px;margin-bottom:var(--sp-5)">
          <label>${t('select_line')}</label>
          <select id="qr-line-sel">
            ${lines.map(l=>`<option value="${l.id}"${l.id===lineId?' selected':''}>${l.name}</option>`).join('')}
          </select>
        </div>
        <div id="qr-display" style="display:flex;gap:var(--sp-8);align-items:flex-start;flex-wrap:wrap"></div>
        <p style="margin-top:var(--sp-5);font-size:11px;color:var(--text-3);font-family:var(--font-mono)">${t('qr_note')}</p>
      </div>
    </div>
    <div class="qr-print-sheet" style="display:none" id="qr-print-sheet"></div>`);

  const renderQR = selId => {
    const line = lines.find(l => l.id === selId);
    if (!line) return;
    const payload = `smapp://line/${selId}`;
    const display = document.getElementById('qr-display');
    display.innerHTML = `
      <div>
        <div id="qr-canvas" style="background:white;padding:12px;border-radius:var(--r);display:inline-block;border:1px solid var(--border)"></div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);margin-top:var(--sp-2)">${t('qr_url_label')}: ${payload}</div>
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:22px;font-weight:700;color:var(--text);margin-bottom:var(--sp-4)">${line.name}</div>
        <div class="flex-gap">
          <button class="btn btn-primary" id="print-qr-btn">${t('print_qr')}</button>
          <a class="btn btn-secondary" href="index.html?qr=${selId}" target="_blank">${t('open_form')}</a>
        </div>
      </div>`;

    // Generate QR
    const qrDiv = document.getElementById('qr-canvas');
    if (window.QRCode) {
      new QRCode(qrDiv, { text: payload, width: 160, height: 160, colorDark: '#000000', colorLight: '#ffffff' });
    } else {
      qrDiv.innerHTML = `<div style="font-family:monospace;font-size:8px;color:#000;word-break:break-all;max-width:160px;padding:8px">${payload}</div>`;
    }

    // Print sheet
    const ps = document.getElementById('qr-print-sheet');
    ps.innerHTML = `
      <div class="qr-line-name">${line.name}</div>
      <div class="qr-image" id="qr-print-img"></div>
      <div class="qr-url">${payload}</div>
      <div class="qr-instructions-en">📱 Scan with your phone's camera or QR reader app</div>
      <div class="qr-instructions-es">📱 Escanea con la cámara de tu teléfono o una app de QR</div>`;
    if (window.QRCode) {
      new QRCode(document.getElementById('qr-print-img'), { text: payload, width: 240, height: 240, colorDark: '#000000', colorLight: '#ffffff' });
    }

    document.getElementById('print-qr-btn').onclick = () => {
      document.getElementById('qr-print-sheet').style.display = 'block';
      window.print();
      setTimeout(() => { document.getElementById('qr-print-sheet').style.display = 'none'; }, 1000);
    };
  };

  if (lineId) renderQR(lineId);
  document.getElementById('qr-line-sel').onchange = e => renderQR(+e.target.value);
};

/* ══════════════════════════════════════════════════════════════
   SYNC
══════════════════════════════════════════════════════════════ */
Pages.sync = async function() {
  const deviceRole = await DB.getSetting('deviceRole', 'authority');
  const lineId = AppState.currentLineId || await DB.getSetting('deviceLineId', null);
  deviceRole === 'field' ? _renderFieldSync(lineId) : _renderAuthSync();
};

async function _renderFieldSync(lineId) {
  const [logs, recs] = await Promise.all([
    lineId ? DB.getAllByIndex('trainingLogs','syncedToAuthority',false) : Promise.resolve([]),
    lineId ? DB.getAllByIndex('pendingRecommendations','syncedToAuthority',false) : Promise.resolve([])
  ]);
  const fl = logs.filter(l => l.lineId === lineId);
  const fr = recs.filter(r => r.lineId === lineId);
  const lastSync = await DB.getSetting('lastSyncAt', null);
  const seedV    = await DB.getSetting('seedVersion', 1);

  _rc(`
    <div class="card" style="margin-bottom:var(--sp-5)">
      <div class="card-header"><span class="card-title">${t('sync_export')}</span></div>
      <div class="card-body">
        <div class="grid-2" style="margin-bottom:var(--sp-5)">
          <div class="stat-card"><div class="stat-value">${fl.length}</div><div class="stat-label">${t('sync_pending_logs')}</div></div>
          <div class="stat-card"><div class="stat-value">${fr.length}</div><div class="stat-label">${t('sync_pending_recs')}</div></div>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-3);margin-bottom:var(--sp-4)">
          ${t('sync_last')}: ${lastSync ? _fmtTs(lastSync) : t('sync_never')} &nbsp;·&nbsp; Seed v${seedV}
        </div>
        <button class="btn btn-primary" id="export-delta-btn">${t('sync_export')}</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">${t('sync_receipt')}</span></div>
      <div class="card-body">
        <div class="upload-zone" id="receipt-zone">
          <input type="file" id="receipt-file" accept=".json">
          <div class="upload-icon">📩</div>
          <span class="upload-label">Drop receipt JSON here</span>
        </div>
        <div id="receipt-status" style="margin-top:var(--sp-3)"></div>
      </div>
    </div>`);

  document.getElementById('export-delta-btn').onclick = async () => {
    if (!lineId) { Toast.error('No line set'); return; }
    try {
      const bundle = await syncService.exportDelta(lineId);
      if (!bundle) { Toast.warn(t('sync_nothing')); return; }
      const date = new Date().toISOString().slice(0,10);
      const src = (bundle.sourceDeviceId||'dev').slice(0,8);
      _downloadJSON(bundle, `delta_line${lineId}_${date}_${src}.json`);
      Toast.success(t('sync_exported'));
    } catch(e) { Toast.error(e.message); }
  };

  _setupUploadZone('receipt-zone','receipt-file', async f => {
    try {
      const receipt = JSON.parse(await f.text());
      const ids = receipt.results.filter(r=>r.status==='imported').map(r=>r.clientId);
      await syncService.markSynced(ids);
      await DB.setSetting('lastSyncAt', Date.now());
      document.getElementById('receipt-status').innerHTML = `<div class="info-box success">Marked ${ids.length} records as synced</div>`;
      Toast.success('Receipt imported');
    } catch(e) { Toast.error(e.message); }
  });
}

async function _renderAuthSync() {
  _rc(`
    <div class="card">
      <div class="card-header"><span class="card-title">${t('sync_import')}</span></div>
      <div class="card-body">
        <div class="upload-zone" id="delta-zone">
          <input type="file" id="delta-file" accept=".json">
          <div class="upload-icon">📦</div>
          <span class="upload-label">${t('sync_import')}</span>
          <span class="upload-hint">delta_line*.json</span>
        </div>
        <div id="delta-status" style="margin-top:var(--sp-4)"></div>
      </div>
    </div>`);

  _setupUploadZone('delta-zone','delta-file', async f => {
    const status = document.getElementById('delta-status');
    status.innerHTML = `<div class="info-box">${t('loading')}</div>`;
    try {
      const bundle = JSON.parse(await f.text());
      const results = await syncService.importDelta(bundle);
      const receipt = { schemaVersion:2, bundleId: bundle.bundleId, importedAt: Date.now(), results: results.details, unresolvedCount: results.unresolved };
      _downloadJSON(receipt, `receipt_${bundle.bundleId}.json`);
      status.innerHTML = `<div class="info-box success">
        ${results.imported} ${t('imported')} · ${results.skipped} ${t('skipped')} · ${results.errors} ${t('errors')}
        ${results.unresolved > 0 ? `<br><span style="color:var(--amber)">⚠ ${results.unresolved} ${t('unresolved')}</span>` : ''}
      </div>`;
      Toast.success(t('sync_imported'));
    } catch(e) {
      status.innerHTML = `<div class="info-box error">${e.message}</div>`;
      Toast.error(e.message);
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   SETUP
══════════════════════════════════════════════════════════════ */
Pages.setup = async function() {
  const lineId = AppState.currentLineId;
  const lines   = AppState.lines;
  const users   = AppState.users;
  const isSup   = Session.isSupervisor();

  _rc(`
    <div class="tabs">
      <button class="tab-btn active" data-tab="employees">${t('setup_employees')}</button>
      <button class="tab-btn" data-tab="positions">${t('setup_positions')}</button>
      ${isSup ? `<button class="tab-btn" data-tab="lines">${t('setup_lines')}</button>` : ''}
      ${isSup ? `<button class="tab-btn" data-tab="users">${t('setup_users')}</button>` : ''}
      ${isSup ? `<button class="tab-btn" data-tab="devices">${t('setup_devices')}</button>` : ''}
    </div>

    <div id="tab-employees" class="tab-panel active">
      <div class="flex-between" style="margin-bottom:var(--sp-4)">
        <span style="font-size:11px;color:var(--text-3)">${AppState.employees.length} total</span>
        ${lineId ? `<button class="btn btn-primary btn-sm" id="add-emp-btn">${t('add_employee')}</button>` : ''}
      </div>
      <table class="data-table"><thead><tr>
        <th>${t('col_name')}</th><th>${t('col_role')}</th><th>${t('col_status')}</th><th></th>
      </tr></thead><tbody>
        ${AppState.employees.length ? AppState.employees.map(emp => `<tr>
          <td class="td-name">${emp.name}</td>
          <td><span class="badge badge-info">${t('role_'+emp.role)}</span></td>
          <td><span class="badge ${emp.active!==false?'badge-success':'badge-error'}">${emp.active!==false?'Active':'Inactive'}</span></td>
          <td class="td-actions"><button class="btn btn-sm btn-ghost" data-action="deact-emp" data-id="${emp.id}">${t('deactivate')}</button></td>
        </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:var(--sp-5)">${t('no_employees')}</td></tr>`}
      </tbody></table>
    </div>

    <div id="tab-positions" class="tab-panel">
      <div class="flex-between" style="margin-bottom:var(--sp-4)">
        <span style="font-size:11px;color:var(--text-3)">${AppState.positions.length} total</span>
        ${lineId ? `<button class="btn btn-primary btn-sm" id="add-pos-btn">${t('add_position')}</button>` : ''}
      </div>
      <table class="data-table"><thead><tr>
        <th>${t('col_name')}</th><th>${t('col_critical')}</th><th></th>
      </tr></thead><tbody>
        ${AppState.positions.length ? AppState.positions.map(pos => `<tr>
          <td class="td-name">${pos.name}</td>
          <td>${pos.critical ? '<span class="badge badge-error">⚡ Critical</span>' : ''}</td>
          <td class="td-actions"><button class="btn btn-sm btn-ghost" data-action="deact-pos" data-id="${pos.id}">${t('deactivate')}</button></td>
        </tr>`).join('') : `<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:var(--sp-5)">${t('no_positions')}</td></tr>`}
      </tbody></table>
    </div>

    ${isSup ? `<div id="tab-lines" class="tab-panel">
      <div class="flex-between" style="margin-bottom:var(--sp-4)">
        <span></span>
        <button class="btn btn-primary btn-sm" id="add-line-btn">${t('add_line')}</button>
      </div>
      <table class="data-table"><thead><tr><th>${t('col_name')}</th><th>${t('shift')}</th></tr></thead><tbody>
        ${lines.map(l => `<tr><td class="td-name">${l.name}</td><td>${_shiftBadge(l.shift)}</td></tr>`).join('') || `<tr><td colspan="2" style="text-align:center;color:var(--text-3)">${t('no_lines')}</td></tr>`}
      </tbody></table>
    </div>

    <div id="tab-users" class="tab-panel">
      <div class="flex-between" style="margin-bottom:var(--sp-4)">
        <span></span>
        <button class="btn btn-primary btn-sm" id="add-user-btn">${t('add_user')}</button>
      </div>
      <table class="data-table"><thead><tr>
        <th>${t('col_name')}</th><th>${t('col_role')}</th><th>${t('col_status')}</th><th></th>
      </tr></thead><tbody>
        ${users.length ? users.map(u => `<tr>
          <td class="td-name">${u.name}</td>
          <td><span class="badge badge-info">${t('role_'+u.role)}</span></td>
          <td><span class="badge ${u.active!==false?'badge-success':'badge-error'}">${u.active!==false?'Active':'Inactive'}</span></td>
          <td class="td-actions"><button class="btn btn-sm btn-ghost" data-action="deact-user" data-id="${u.id}">${t('deactivate')}</button></td>
        </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--text-3)">${t('no_users')}</td></tr>`}
      </tbody></table>
    </div>

    <div id="tab-devices" class="tab-panel">
      <div class="card">
        <div class="card-header"><span class="card-title">${t('provision_device')}</span></div>
        <div class="card-body">
          <p style="color:var(--text-2);margin-bottom:var(--sp-4)">Generate a seed file to provision a field device for a specific line.</p>
          <div class="form-group" style="max-width:280px;margin-bottom:var(--sp-4)">
            <label>${t('select_line')}</label>
            <select id="seed-line-sel">${lines.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select>
          </div>
          <button class="btn btn-primary" id="gen-seed-btn">${t('generate_seed')}</button>
          <div id="seed-status" style="margin-top:var(--sp-3)"></div>
        </div>
      </div>
    </div>` : ''}
  `);

  _setupTabs();

  // Delegate deactivation buttons
  document.querySelector('#tab-employees')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="deact-emp"]');
    if (!btn) return;
    if (!await confirmDialog(t('confirm_delete'))) return;
    await lineService.deactivateEmployee(+btn.dataset.id);
    await lineService.loadLineData(lineId);
    Toast.success(t('deactivated')); Pages.setup();
  });
  document.querySelector('#tab-positions')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="deact-pos"]');
    if (!btn) return;
    if (!await confirmDialog(t('confirm_delete'))) return;
    await lineService.deactivatePosition(+btn.dataset.id);
    await lineService.loadLineData(lineId);
    Toast.success(t('deactivated')); Pages.setup();
  });
  document.querySelector('#tab-users')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action="deact-user"]');
    if (!btn) return;
    await lineService.deactivateUser(+btn.dataset.id);
    await lineService.loadUsers();
    Toast.success(t('deactivated')); Pages.setup();
  });

  // Add employee
  document.getElementById('add-emp-btn')?.addEventListener('click', () => {
    Modal.open({
      title: t('add_employee'),
      body: `<div class="form-group"><label>${t('employee_name')}</label><input type="text" id="ne-name" autofocus></div>
             <div class="form-group"><label>${t('role')}</label><select id="ne-role">
               <option value="operator">${t('role_operator')}</option>
               <option value="teamlead">${t('role_teamlead')}</option>
               <option value="supervisor">${t('role_supervisor')}</option>
             </select></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">${t('cancel')}</button>
               <button class="btn btn-primary" id="ne-save">${t('save')}</button>`
    });
    document.getElementById('ne-save').onclick = async () => {
      const name = document.getElementById('ne-name').value.trim();
      const role = document.getElementById('ne-role').value;
      if (!name) return;
      await lineService.addEmployee(lineId, name, role);
      await lineService.loadLineData(lineId);
      Modal.close(); Toast.success(t('employee_added')); Pages.setup();
    };
  });

  // Add position
  document.getElementById('add-pos-btn')?.addEventListener('click', () => {
    Modal.open({
      title: t('add_position'),
      body: `<div class="form-group"><label>${t('position_name')}</label><input type="text" id="np-name" autofocus></div>
             <label class="checkbox-row" id="np-crit-row">
               <input type="checkbox" id="np-critical">
               <span class="checkbox-label">${t('critical')} — ${t('critical_note')}</span>
             </label>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">${t('cancel')}</button>
               <button class="btn btn-primary" id="np-save">${t('save')}</button>`
    });
    document.getElementById('np-save').onclick = async () => {
      const name = document.getElementById('np-name').value.trim();
      const crit = document.getElementById('np-critical').checked;
      if (!name) return;
      await lineService.addPosition(lineId, name, crit, AppState.positions.length);
      await lineService.loadLineData(lineId);
      Modal.close(); Toast.success(t('position_added')); Pages.setup();
    };
  });

  // Add line
  document.getElementById('add-line-btn')?.addEventListener('click', () => {
    Modal.open({
      title: t('add_line'),
      body: `<div class="form-group"><label>${t('line_name')}</label><input type="text" id="nl-name" autofocus></div>
             <div class="form-group"><label>${t('shift')}</label><select id="nl-shift">
               <option value="">${t('shift_multi')}</option>
               <option value="day">${t('shift_day')}</option>
               <option value="afternoon">${t('shift_afternoon')}</option>
               <option value="night">${t('shift_night')}</option>
             </select></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">${t('cancel')}</button>
               <button class="btn btn-primary" id="nl-save">${t('save')}</button>`
    });
    document.getElementById('nl-save').onclick = async () => {
      const name = document.getElementById('nl-name').value.trim();
      const shift = document.getElementById('nl-shift').value || null;
      if (!name) return;
      await lineService.addLine(name, shift);
      Modal.close(); Toast.success(t('line_added'));
      App.renderSidebar(); Pages.setup();
    };
  });

  // Add user
  document.getElementById('add-user-btn')?.addEventListener('click', () => {
    Modal.open({
      title: t('add_user'),
      body: `<div class="form-group"><label>${t('col_name')}</label><input type="text" id="nu-name" autofocus></div>
             <div class="form-group"><label>${t('role')}</label><select id="nu-role">
               <option value="teamlead">${t('role_teamlead')}</option>
               <option value="supervisor">${t('role_supervisor')}</option>
             </select></div>`,
      footer: `<button class="btn btn-secondary" onclick="Modal.close()">${t('cancel')}</button>
               <button class="btn btn-primary" id="nu-save">${t('save')}</button>`
    });
    document.getElementById('nu-save').onclick = async () => {
      const name = document.getElementById('nu-name').value.trim();
      const role = document.getElementById('nu-role').value;
      if (!name) return;
      await lineService.addUser(name, role, []);
      await lineService.loadUsers();
      Modal.close(); Toast.success(t('user_added')); Pages.setup();
    };
  });

  // Generate seed
  document.getElementById('gen-seed-btn')?.addEventListener('click', async () => {
    const selId = +document.getElementById('seed-line-sel').value;
    try {
      const seed = await syncService.generateSeed(selId);
      const line = lines.find(l => l.id === selId);
      _downloadJSON(seed, `deviceSeed_line${selId}_v${seed.seedVersion}.json`);
      document.getElementById('seed-status').innerHTML = `<div class="info-box success">Seed generated for ${line?.name}</div>`;
    } catch(e) { Toast.error(e.message); }
  });
};

/* ══════════════════════════════════════════════════════════════
   QR TRAINING LOG FORM (field device / ?qr= URL mode)
══════════════════════════════════════════════════════════════ */
Pages.qrForm = async function(lineId, lineData) {
  const { employees, positions } = lineData;
  const allUsers = await DB.getAll('users');
  const trainers = allUsers.filter(u => u.active !== false && (u.role === 'teamlead' || u.role === 'supervisor'));
  const session  = Session.get();

  _rc(`
    <div style="max-width:560px;margin:0 auto">
      ${!session ? `<div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header"><span class="card-title">${t('session_who')}</span></div>
        <div class="card-body">
          ${trainers.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)" id="logger-picker">
            ${trainers.map(u => `<button class="btn btn-secondary" style="height:52px" data-logger-id="${u.id}" data-logger-role="${u.role}" data-logger-name="${u.name}">
              ${u.name} <span class="badge badge-info">${u.role==='teamlead'?'TL':'SUP'}</span>
            </button>`).join('')}
          </div>` : `<div class="empty-state">${t('session_no_users')}</div>`}
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header">
          <span class="card-title">${t('log_training')}</span>
          ${session ? `<span style="font-size:11px;color:var(--text-3)">${t('logging_as')}: <strong>${session.name}</strong> · <a href="#" id="switch-logger" style="color:var(--accent)">${t('session_switch')}</a></span>` : ''}
        </div>
        <div class="card-body">
          <div id="log-success-bar" style="display:none;margin-bottom:var(--sp-4)"></div>

          <div class="form-group">
            <label>${t('trainee')} *</label>
            <select id="qf-trainee">
              <option value="">${t('select_trainee')}</option>
              ${employees.filter(e=>e.active!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(e =>
                `<option value="${e.id}" data-name="${e.name}">${e.name}</option>`).join('')}
            </select>
            <div class="form-error" id="err-trainee"></div>
          </div>

          <div class="form-group">
            <label>${t('position')} *</label>
            <select id="qf-position">
              <option value="">${t('select_position')}</option>
              ${positions.map(p => `<option value="${p.id}" data-name="${p.name}">${p.name}${p.critical?' ⚡':''}</option>`).join('')}
            </select>
            <div class="form-error" id="err-position"></div>
          </div>

          <div class="form-group">
            <label>${t('trainer')}</label>
            <select id="qf-trainer">
              <option value="">${t('none_option')}</option>
              ${trainers.sort((a,b)=>a.name.localeCompare(b.name)).map(u =>
                `<option value="${u.id}" data-name="${u.name}">${u.name} (${u.role==='teamlead'?'TL':'SUP'})</option>`).join('')}
            </select>
            <div class="form-error" id="err-trainer"></div>
          </div>

          <div class="form-group">
            <label>${t('duration')} * <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-3)">${t('duration_hint')}</span></label>
            <input type="number" id="qf-duration" min="1" max="480" value="30" style="width:140px">
            <div class="form-error" id="err-duration"></div>
          </div>

          <div class="form-group">
            <label>${t('notes')}</label>
            <textarea id="qf-notes" maxlength="500" rows="3"></textarea>
            <div style="text-align:right;font-family:var(--font-mono);font-size:9px;color:var(--text-3)" id="notes-ctr">0/500</div>
          </div>

          <label class="checkbox-row" id="rec-row">
            <input type="checkbox" id="qf-recommend">
            <span class="checkbox-label">${t('recommend_level')}</span>
          </label>

          <div style="margin-top:var(--sp-5)">
            <button class="btn btn-primary btn-full btn-lg" id="qf-submit" ${!session?'disabled':''}>${t('submit_log')}</button>
          </div>
        </div>
      </div>
    </div>`);

  // Logger picker
  document.querySelectorAll('[data-logger-id]').forEach(btn => {
    btn.onclick = () => {
      Session.set(+btn.dataset.loggerId, btn.dataset.loggerRole, btn.dataset.loggerName);
      Pages.qrForm(lineId, lineData);
    };
  });

  document.getElementById('switch-logger')?.addEventListener('click', e => {
    e.preventDefault(); Session.clear(); Pages.qrForm(lineId, lineData);
  });

  // Notes counter
  document.getElementById('qf-notes').addEventListener('input', e => {
    document.getElementById('notes-ctr').textContent = `${e.target.value.length}/500`;
  });

  // Recommend row highlight
  document.getElementById('qf-recommend').addEventListener('change', e => {
    document.getElementById('rec-row').classList.toggle('checked', e.target.checked);
  });

  // Trainer ≠ trainee live guard
  document.getElementById('qf-trainee').addEventListener('change', () => {
    const trainee = document.getElementById('qf-trainee').value;
    const trainer = document.getElementById('qf-trainer');
    if (trainer.value && trainer.value === trainee) {
      trainer.value = '';
      document.getElementById('err-trainer').textContent = t('trainer_eq_trainee');
    } else {
      document.getElementById('err-trainer').textContent = '';
    }
  });

  // Submit
  document.getElementById('qf-submit').addEventListener('click', async () => {
    const curSession = Session.get();
    if (!curSession) return;

    const traineeEl  = document.getElementById('qf-trainee');
    const posEl      = document.getElementById('qf-position');
    const trainerEl  = document.getElementById('qf-trainer');
    const durationEl = document.getElementById('qf-duration');

    const traineeId  = +traineeEl.value;
    const posId      = +posEl.value;
    const trainerId  = trainerEl.value ? +trainerEl.value : null;
    const duration   = parseInt(durationEl.value);
    const notes      = document.getElementById('qf-notes').value.trim();
    const recommend  = document.getElementById('qf-recommend').checked;

    // Validate
    let valid = true;
    const setErr = (id, msg) => { document.getElementById(id).textContent = msg; if (msg) valid = false; };

    setErr('err-trainee',  !traineeId                   ? t('select_trainee') : '');
    setErr('err-position', !posId                       ? t('select_position') : '');
    setErr('err-trainer',  trainerId && trainerId===traineeId ? t('trainer_eq_trainee') : '');
    setErr('err-duration', isNaN(duration) || !durationEl.value ? t('duration_required')
                         : duration < 1  ? t('duration_min')
                         : duration > 480 ? t('duration_max') : '');
    if (!valid) return;

    // Duplicate guard (same emp+pos within 5 min)
    const recent = await DB.getAllByIndex('trainingLogs', 'lineTimestamp',
      IDBKeyRange.bound([lineId, Date.now()-300000], [lineId, Date.now()]));
    const dupe = recent.find(l => l.employeeId === traineeId && l.positionId === posId);
    if (dupe) {
      const ok = await confirmDialog(t('duplicate_log'));
      if (!ok) return;
    }

    const btn = document.getElementById('qf-submit');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;

    try {
      const traineeName = traineeEl.options[traineeEl.selectedIndex]?.dataset.name || '';
      const posName     = posEl.options[posEl.selectedIndex]?.dataset.name || '';
      const trainerName = trainerId ? (trainerEl.options[trainerEl.selectedIndex]?.dataset.name || '') : null;

      await trainingLogService.saveLog({
        lineId, employeeId: traineeId, employeeNameSnapshot: traineeName,
        positionId: posId, positionNameSnapshot: posName,
        trainerId, trainerNameSnapshot: trainerName,
        duration, notes, recommendLevelChange: recommend,
        shift: _deriveShift()
      });

      // Success feedback
      const bar = document.getElementById('log-success-bar');
      bar.style.display = 'block';
      bar.innerHTML = `<div class="confirm-banner">✓ ${traineeName} · ${posName} · ${duration} ${t('min')}</div>`;

      // Reset form
      traineeEl.value = '';
      posEl.value = '';
      trainerEl.value = '';
      durationEl.value = 30;
      document.getElementById('qf-notes').value = '';
      document.getElementById('notes-ctr').textContent = '0/500';
      document.getElementById('qf-recommend').checked = false;
      document.getElementById('rec-row').classList.remove('checked');
      traineeEl.focus();

      setTimeout(() => { bar.style.display = 'none'; btn.disabled = false; btn.textContent = t('submit_log'); }, 3000);
    } catch(e) {
      Toast.error(e.message);
      btn.disabled = false;
      btn.textContent = t('submit_log');
    }
  });
};

/* ══════════════════════════════════════════════════════════════
   REPORTS
══════════════════════════════════════════════════════════════ */
Pages.reports = async function() {
  const lineId = AppState.currentLineId;
  if (!lineId) { _rc(_noLine()); return; }

  const [logs, skillRecords, auditLogs] = await Promise.all([
    DB.getAllByIndex('trainingLogs', 'lineId', lineId),
    AppState.skillRecords,
    DB.getAllByIndex('auditLogs', 'lineId', lineId)
  ]);

  const analysis = crossTraining.analyze(AppState.employees, AppState.positions, skillRecords);
  const completedAudits = auditLogs.filter(a => a.result !== null);
  const passRate = completedAudits.length ? Math.round(completedAudits.filter(a=>a.result==='pass').length/completedAudits.length*100) : null;

  // Training logs per employee
  const logsByEmp = {};
  logs.forEach(l => { if (l.employeeId) logsByEmp[l.employeeId] = (logsByEmp[l.employeeId]||0)+1; });

  _rc(`
    <div class="grid-4" style="margin-bottom:var(--sp-5)">
      <div class="stat-card" style="--stat-color:var(--accent)">
        <div class="stat-value">${logs.length}</div><div class="stat-label">Total Training Logs</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--green)">
        <div class="stat-value">${analysis.summary.positionsMet}</div>
        <div class="stat-label">${t('positions_met')}</div>
        <div class="stat-sub">of ${AppState.positions.length}</div>
      </div>
      <div class="stat-card" style="--stat-color:var(--blue)">
        <div class="stat-value">${completedAudits.length}</div><div class="stat-label">Completed Audits</div>
      </div>
      <div class="stat-card" style="--stat-color:${passRate===null?'var(--text-3)':passRate>=80?'var(--green)':'var(--red)'}">
        <div class="stat-value">${passRate!==null?passRate+'%':t('na')}</div>
        <div class="stat-label">${t('audit_pass_rate')}</div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:var(--sp-5)">
      <div class="card">
        <div class="card-header"><span class="card-title">Level Distribution</span></div>
        <div class="card-body">
          ${[0,1,2,3,4].map(lv => {
            const cnt = skillRecords.filter(r => r.currentLevel === lv).length;
            const pct = skillRecords.length ? Math.round(cnt/skillRecords.length*100) : 0;
            return `<div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:6px">
              ${_levelBadge(lv)}
              <div class="progress-bar-wrap" style="flex:1">
                <div class="progress-bar-fill lc-${lv}" style="width:${pct}%;background:var(--l${lv>0?lv:'1'})"></div>
              </div>
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);min-width:40px;text-align:right">${cnt} (${pct}%)</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Top Trainers</span></div>
        <div class="card-body" style="padding:var(--sp-3) 0">
          ${(() => {
            const trainerCounts = {};
            logs.filter(l => l.trainerNameSnapshot).forEach(l => {
              trainerCounts[l.trainerNameSnapshot] = (trainerCounts[l.trainerNameSnapshot]||0)+1;
            });
            const sorted = Object.entries(trainerCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
            return sorted.length ? sorted.map(([name, cnt]) => `
              <div style="display:flex;align-items:center;gap:var(--sp-3);padding:5px var(--sp-4)">
                <span style="flex:1;font-size:12px;color:var(--text)">${name}</span>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent)">${cnt} sessions</span>
              </div>`).join('')
              : `<div class="empty-state" style="padding:var(--sp-6)">No training data</div>`;
          })()}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Recent Training Logs</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${logs.length} total</span>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table"><thead><tr>
          <th>${t('col_employee')}</th><th>${t('col_position')}</th>
          <th>${t('col_trainer')}</th><th>${t('col_duration')}</th>
          <th>${t('col_shift')}</th><th>${t('col_date')}</th>
        </tr></thead><tbody>
          ${logs.sort((a,b)=>b.timestamp-a.timestamp).slice(0,50).map(log => `<tr>
            <td class="td-name">${log.employeeNameSnapshot}${!log.employeeResolved?'<span class="badge badge-warning" style="margin-left:4px">⚠</span>':''}</td>
            <td>${log.positionNameSnapshot}</td>
            <td class="td-mono" style="font-size:11px">${log.trainerNameSnapshot||'—'}</td>
            <td class="td-mono">${log.duration}</td>
            <td>${_shiftBadge(log.shift)}</td>
            <td class="td-mono" style="font-size:10px">${_fmtTs(log.timestamp)}</td>
          </tr>`).join('')}
        </tbody></table>
        ${logs.length > 50 ? `<div style="padding:var(--sp-3) var(--sp-4);font-size:11px;color:var(--text-3);font-family:var(--font-mono)">Showing 50 of ${logs.length} logs</div>` : ''}
      </div>
    </div>`);
};
