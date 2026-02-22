/**
 * Services — All DB orchestration. Call domain modules. Return plain objects.
 */

/* ─────────────────────────────────────────────────────────────────────────
   lineService
───────────────────────────────────────────────────────────────────────── */
const lineService = {
  async loadAll() {
    const lines = await DB.getAll('lines');
    AppState.setLines(lines);
    return lines;
  },

  async loadLineData(lineId) {
    const [employees, positions, skillRecords] = await Promise.all([
      DB.getAllByIndex('employees', 'lineId', lineId),
      DB.getAllByIndex('positions', 'lineId', lineId),
      DB.getAllByIndex('skillRecords', 'lineId', lineId),
    ]);
    AppState.setLineData({ employees, positions, skillRecords, lineId });
    return { employees, positions, skillRecords };
  },

  async loadUsers() {
    const users = await DB.getAll('users');
    AppState.setUsers(users);
    return users;
  },

  async addLine(name, shift) {
    const id = await DB.add('lines', { name, shift: shift || null, createdAt: Date.now() });
    await this.loadAll();
    return id;
  },

  async addEmployee(lineId, name, role) {
    const norm = name.trim().toLowerCase();
    const data = { lineId, name: name.trim(), normalizedName: norm, role, active: true, createdAt: Date.now() };
    let id;
    try {
      id = await DB.add('employees', data);
    } catch (e) {
      // Unique constraint: upsert
      id = await DB.upsertByIndex('employees', 'lineNormName', [lineId, norm], data);
    }
    return id;
  },

  async addPosition(lineId, name, critical, sortOrder) {
    const norm = name.trim().toLowerCase();
    const data = { lineId, name: name.trim(), normalizedName: norm, critical: !!critical, sortOrder: sortOrder || 0, createdAt: Date.now() };
    let id;
    try {
      id = await DB.add('positions', data);
    } catch (e) {
      id = await DB.upsertByIndex('positions', 'lineNormName', [lineId, norm], data);
    }
    return id;
  },

  async deactivateEmployee(empId) {
    const rec = await DB.get('employees', empId);
    if (rec) await DB.put('employees', { ...rec, active: false });
  },

  async deactivatePosition(posId) {
    const rec = await DB.get('positions', posId);
    if (rec) await DB.put('positions', { ...rec, active: false });
  },

  async addUser(name, role, lineIds) {
    const norm = name.trim().toLowerCase();
    return await DB.add('users', { name: name.trim(), normalizedName: norm, role, active: true, lineIds: lineIds || [], createdAt: Date.now() });
  },

  async deactivateUser(userId) {
    const rec = await DB.get('users', userId);
    if (rec) await DB.put('users', { ...rec, active: false });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   skillService
───────────────────────────────────────────────────────────────────────── */
const skillService = {
  async getOrBlank(empId, posId) {
    let rec = AppState.getSkillRecord(empId, posId);
    if (!rec) {
      rec = await DB.getByIndex('skillRecords', 'empPos', IDBKeyRange.only([empId, posId]));
    }
    if (!rec) rec = skillSM.blank(empId, posId);
    return rec;
  },

  async promote(record, approverName, approverRole, comment) {
    const result = skillSM.addPromotion(record, approverName, approverRole, comment);
    if (!result.ok) return result;

    const lineId = record.lineId || AppState.currentLineId;
    const newRec = { ...result.newRecord, lineId };

    if (newRec.id) {
      await DB.put('skillRecords', newRec);
    } else {
      const id = await DB.add('skillRecords', newRec);
      newRec.id = id;
    }

    AppState.updateSkillRecord(newRec);
    return { ...result, newRecord: newRec };
  },

  async demote(record, supervisorName, targetLevel, reason) {
    const result = skillSM.demote(record, supervisorName, targetLevel, reason);
    if (!result.ok) return result;

    const newRec = { ...result.newRecord };
    if (newRec.id) {
      await DB.put('skillRecords', newRec);
    } else {
      const id = await DB.add('skillRecords', newRec);
      newRec.id = id;
    }
    AppState.updateSkillRecord(newRec);
    return { ...result, newRecord: newRec };
  },

  async getPendingDual(lineId) {
    const records = await DB.getAllByIndex('skillRecords', 'lineId', lineId);
    return records.filter(r => r.status === 'pending_dual');
  },

  async getPendingRecs(lineId) {
    return await DB.getAllByIndex('pendingRecommendations', 'lineStatus', IDBKeyRange.only([lineId, 'open']));
  },

  async actionRecommendation(recId, result, actionedByName, note) {
    const rec = await DB.get('pendingRecommendations', recId);
    if (!rec) return;
    await DB.put('pendingRecommendations', {
      ...rec, status: 'actioned',
      actionedAt: Date.now(), actionedByName, actionedResult: result, actionNote: note || null
    });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   attendanceService
───────────────────────────────────────────────────────────────────────── */
const attendanceService = {
  async loadForDate(lineId, date) {
    const records = await DB.getAllByIndex('attendance', 'lineDate', IDBKeyRange.only([lineId, date]));
    const map = new Map();
    records.forEach(r => map.set(r.employeeId, r));
    AppState.setAttendance(map);
    return map;
  },

  async saveAll(lineId, date, shift, formData) {
    // formData: [{ employeeId, status, partialHours, notes }]
    const records = formData.map(d => ({
      lineId, employeeId: d.employeeId, date, shift: shift || _deriveShift(),
      status: d.status || 'present',
      partialHours: d.status === 'partial' ? (parseFloat(d.partialHours) || null) : null,
      notes: d.notes || null
    }));
    await DB.batchUpsertAttendance(records);
    await this.loadForDate(lineId, date);
    return records;
  }
};

function _deriveShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'day';
  if (h >= 14 && h < 22) return 'afternoon';
  return 'night';
}

/* ─────────────────────────────────────────────────────────────────────────
   rotationService
───────────────────────────────────────────────────────────────────────── */
const rotationService = {
  async generate(lineId, date, bbMode) {
    // Load all required data
    const [employees, allAttendance, positions, skillRecords, allPlans] = await Promise.all([
      DB.getAllByIndex('employees', 'lineId', lineId),
      DB.getAllByIndex('attendance', 'lineDate', IDBKeyRange.only([lineId, date])),
      DB.getAllByIndex('positions', 'lineId', lineId),
      DB.getAllByIndex('skillRecords', 'lineId', lineId),
      DB.getAllByIndex('rotationPlans', 'lineId', lineId)
    ]);

    // Yesterday's plan
    const yesterday = allPlans
      .filter(p => p.date !== date)
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null;

    const attMap = new Map();
    allAttendance.forEach(a => attMap.set(a.employeeId, a));

    const activeEmps = employees.filter(e => e.active !== false);
    const presentEmployees = activeEmps.filter(emp => {
      const att = attMap.get(emp.id);
      if (!att) return true;
      return att.status === 'present' || att.status === 'partial';
    });

    // Build qualified sets
    const qualifiedSet = new Set();
    const l2Set = new Set();
    skillRecords.forEach(r => {
      const key = `${r.employeeId}_${r.positionId}`;
      if (r.status === 'approved' && r.currentLevel >= 3) qualifiedSet.add(key);
      if (r.currentLevel === 2) l2Set.add(key);
    });

    // Sort positions
    const sortedPositions = [...positions].sort((a, b) => {
      if (a.critical !== b.critical) return b.critical ? 1 : -1;
      const aCount = skillRecords.filter(r => r.positionId === a.id && r.status === 'approved' && r.currentLevel >= 3).length;
      const bCount = skillRecords.filter(r => r.positionId === b.id && r.status === 'approved' && r.currentLevel >= 3).length;
      return aCount - bCount;
    });

    // Filter for BB mode
    const planPositions = bbMode ? sortedPositions.filter(p => p.critical) : sortedPositions;
    const skippedPositions = bbMode ? sortedPositions.filter(p => !p.critical) : [];

    const result = rotation.generate({
      presentEmployees, positions: planPositions, qualifiedSet, l2Set,
      yesterdayPlan: yesterday, bbMode
    });

    // Add BB skipped gaps
    if (bbMode) {
      ['A','B','C'].forEach(period => {
        skippedPositions.forEach(pos => {
          result.gaps.push({ period, positionId: pos.id, positionName: pos.name, reason: 'bb_skipped' });
        });
      });
    }

    const plan = {
      lineId, date, shift: _deriveShift(), bbMode: !!bbMode,
      slots: result.slots, violations: result.violations,
      gaps: result.gaps, suggestions: result.suggestions, createdAt: Date.now()
    };

    // Upsert by lineDate
    const existing = allPlans.find(p => p.date === date);
    if (existing) {
      plan.id = existing.id;
      await DB.put('rotationPlans', plan);
    } else {
      plan.id = await DB.add('rotationPlans', plan);
    }

    // Prune old plans
    const allNew = await DB.getAllByIndex('rotationPlans', 'lineId', lineId);
    const maxPlans = 30;
    if (allNew.length > maxPlans) {
      const sorted = allNew.sort((a, b) => a.date.localeCompare(b.date));
      const toDelete = sorted.slice(0, allNew.length - maxPlans);
      for (const p of toDelete) await DB.remove('rotationPlans', p.id);
    }

    AppState.setCurrentRotation(plan);
    return plan;
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   auditService
───────────────────────────────────────────────────────────────────────── */
const auditService = {
  async getTodaysAudit(lineId, supervisorId, today) {
    const allLogs = await DB.getAllByIndex('auditLogs', 'lineSuper', IDBKeyRange.only([lineId, supervisorId]));
    const existing = allLogs.find(a => a.date === today);
    if (existing) return { audit: existing, isNew: false, cycleReset: false };

    const positions = await DB.getAllByIndex('positions', 'lineId', lineId);
    if (!positions.length) return null;

    const selected = auditScheduler.selectAudit({ positions, auditHistory: allLogs, today });
    if (!selected) return null;

    const draft = {
      lineId, positionId: selected.positionId, positionName: selected.positionName,
      supervisorId, supervisorName: Session.get()?.name || '',
      date: today, result: null, notes: null, createdAt: Date.now()
    };
    draft.id = await DB.add('auditLogs', draft);
    return { audit: draft, isNew: true, cycleReset: selected.cycleReset };
  },

  async logResult(auditId, result, notes) {
    const rec = await DB.get('auditLogs', auditId);
    if (!rec) return;
    const updated = { ...rec, result, notes: notes || null };
    await DB.put('auditLogs', updated);
    return updated;
  },

  async getHistory(lineId, supervisorId, limit = 50) {
    const all = await DB.getAllByIndex('auditLogs', 'lineSuper', IDBKeyRange.only([lineId, supervisorId]));
    return all.filter(a => a.result !== null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   trainingLogService
───────────────────────────────────────────────────────────────────────── */
const trainingLogService = {
  async saveLog(data) {
    const session = Session.get();
    const deviceId = await DB.getSetting('deviceId', 'unknown');
    const seq = (await DB.getSetting('logLocalSequence', 0)) + 1;
    await DB.setSetting('logLocalSequence', seq);

    const record = {
      lineId: data.lineId,
      employeeId: data.employeeId,
      employeeNameSnapshot: data.employeeNameSnapshot || '',
      employeeResolved: true,
      positionId: data.positionId,
      positionNameSnapshot: data.positionNameSnapshot || '',
      positionResolved: true,
      trainerId: data.trainerId || null,
      trainerNameSnapshot: data.trainerNameSnapshot || null,
      trainerResolved: data.trainerId ? true : null,
      createdByUserId: session ? session.id : null,
      createdByNameSnapshot: session ? session.name : (data.loggerName || ''),
      createdByRole: session ? session.role : (data.loggerRole || 'unknown'),
      createdByResolved: true,
      duration: parseInt(data.duration) || 0,
      notes: data.notes ? data.notes.trim() : null,
      recommendLevelChange: !!data.recommendLevelChange,
      timestamp: Date.now(),
      serverReceivedAt: null,
      shift: data.shift || _deriveShift(),
      deviceId,
      clientId: `${deviceId}_log_${seq}`,
      syncedToAuthority: false,
      importedAt: null
    };

    const id = await DB.add('trainingLogs', record);
    record.id = id;

    // If recommend, create pending recommendation (with dedup)
    if (data.recommendLevelChange) {
      await this._createRecommendation(record);
    }

    return record;
  },

  async _createRecommendation(log) {
    // Dedup by empPos open
    const existing = await DB.getAllByIndex('pendingRecommendations', 'empPos',
      IDBKeyRange.only([log.employeeId, log.positionId]));
    const openRec = existing.find(r => r.status === 'open');

    if (openRec) {
      // Update trainingLogId to newest
      await DB.put('pendingRecommendations', { ...openRec, trainingLogId: log.id });
      return;
    }

    const deviceId = await DB.getSetting('deviceId', 'unknown');
    const seq = (await DB.getSetting('recLocalSequence', 0)) + 1;
    await DB.setSetting('recLocalSequence', seq);

    // Get current skill level
    const skillRec = AppState.getSkillRecord(log.employeeId, log.positionId);
    const currentLevel = skillRec ? skillRec.currentLevel : null;

    const rec = {
      trainingLogId: log.id,
      employeeId: log.employeeId,
      employeeNameSnapshot: log.employeeNameSnapshot,
      positionId: log.positionId,
      positionNameSnapshot: log.positionNameSnapshot,
      lineId: log.lineId,
      currentLevel,
      suggestedLevel: currentLevel !== null ? currentLevel + 1 : null,
      createdByUserId: log.createdByUserId,
      createdByNameSnapshot: log.createdByNameSnapshot,
      createdByRole: log.createdByRole,
      createdAt: Date.now(),
      deviceId,
      clientId: `${deviceId}_rec_${seq}`,
      syncedToAuthority: false,
      status: 'open',
      actionedAt: null, actionedByName: null, actionedResult: null, actionNote: null
    };

    try {
      await DB.add('pendingRecommendations', rec);
    } catch (e) {
      // clientId already exists (duplicate)
    }
  },

  async getRecentForLine(lineId, limit = 20) {
    const all = await DB.getAllByIndex('trainingLogs', 'lineId', lineId);
    return all
      .sort((a, b) => (b.serverReceivedAt || b.timestamp) - (a.serverReceivedAt || a.timestamp))
      .slice(0, limit);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   syncService
───────────────────────────────────────────────────────────────────────── */
const syncService = {
  async exportDelta(lineId) {
    const [logs, recs] = await Promise.all([
      DB.getAllByIndex('trainingLogs', 'syncedToAuthority', false),
      DB.getAllByIndex('pendingRecommendations', 'syncedToAuthority', false)
    ]);
    const filteredLogs = logs.filter(l => l.lineId === lineId);
    const filteredRecs = recs.filter(r => r.lineId === lineId);

    if (!filteredLogs.length && !filteredRecs.length) return null;

    const records = { trainingLogs: filteredLogs, pendingRecommendations: filteredRecs };
    const deviceId = await DB.getSetting('deviceId', 'unknown');
    const seedVersion = await DB.getSetting('seedVersion', 1);
    const usersVersion = await DB.getSetting('usersVersion', 1);
    const checksum = await _sha256(JSON.stringify(records));

    const bundle = {
      schemaVersion: 2,
      bundleId: _uuid(),
      exportedAt: Date.now(),
      sourceDeviceId: deviceId,
      targetLineId: lineId,
      seedVersion,
      usersVersion,
      recordCount: { trainingLogs: filteredLogs.length, pendingRecommendations: filteredRecs.length },
      records,
      checksum
    };

    return bundle;
  },

  async importDelta(bundle) {
    const results = { imported: 0, skipped: 0, errors: 0, unresolved: 0, details: [] };

    // Validate checksum
    const computedChecksum = await _sha256(JSON.stringify(bundle.records));
    if (computedChecksum !== bundle.checksum) {
      throw new Error('Bundle checksum mismatch — file may be corrupted');
    }

    const line = AppState.lines.find(l => l.id === bundle.targetLineId);
    if (!line) throw new Error(`Unknown targetLineId: ${bundle.targetLineId}`);

    const now = Date.now();

    // Import training logs
    for (const log of (bundle.records.trainingLogs || [])) {
      try {
        // Resolve references
        const empRecord = await DB.get('employees', log.employeeId);
        const posRecord = await DB.get('positions', log.positionId);
        const resolved = {
          ...log,
          employeeResolved: !!(empRecord && empRecord.lineId === bundle.targetLineId),
          positionResolved: !!(posRecord && posRecord.lineId === bundle.targetLineId),
          serverReceivedAt: now,
          importedAt: now
        };
        if (!resolved.employeeResolved) { resolved.employeeId = null; results.unresolved++; }
        if (!resolved.positionResolved) { resolved.positionId = null; }

        await DB.add('trainingLogs', resolved);
        results.imported++;
        results.details.push({ clientId: log.clientId, status: 'imported' });
      } catch (e) {
        if (e.name === 'ConstraintError') {
          results.skipped++;
          results.details.push({ clientId: log.clientId, status: 'skipped' });
        } else {
          results.errors++;
          results.details.push({ clientId: log.clientId, status: 'error', detail: e.message });
        }
      }
    }

    // Import pending recommendations
    for (const rec of (bundle.records.pendingRecommendations || [])) {
      try {
        await DB.add('pendingRecommendations', rec);

        // Dedup: check for existing open rec with same empPos
        const existing = await DB.getAllByIndex('pendingRecommendations', 'empPos',
          IDBKeyRange.only([rec.employeeId, rec.positionId]));
        const openOnes = existing.filter(r => r.status === 'open');
        if (openOnes.length > 1) {
          // Keep oldest, remove duplicates
          const sorted = openOnes.sort((a, b) => a.createdAt - b.createdAt);
          for (let i = 1; i < sorted.length; i++) await DB.remove('pendingRecommendations', sorted[i].id);
        }

        results.imported++;
      } catch (e) {
        if (e.name === 'ConstraintError') results.skipped++;
        else results.errors++;
      }
    }

    return results;
  },

  async markSynced(clientIds) {
    for (const cid of clientIds) {
      const log = await DB.getByIndex('trainingLogs', 'clientId', cid);
      if (log) await DB.put('trainingLogs', { ...log, syncedToAuthority: true });
      const rec = await DB.getByIndex('pendingRecommendations', 'clientId', cid);
      if (rec) await DB.put('pendingRecommendations', { ...rec, syncedToAuthority: true });
    }
  },

  async generateSeed(lineId) {
    const line = AppState.lines.find(l => l.id === lineId);
    if (!line) throw new Error('Line not found');

    const [employees, positions, users] = await Promise.all([
      DB.getAllByIndex('employees', 'lineId', lineId),
      DB.getAllByIndex('positions', 'lineId', lineId),
      DB.getAll('users')
    ]);

    const deviceId = await DB.getSetting('deviceId', 'unknown');
    const seedVersion = Date.now(); // use timestamp as version
    const usersVersion = Date.now();

    return {
      schemaVersion: 2,
      seedId: _uuid(),
      authorityDeviceId: deviceId,
      lineId, lineName: line.name, lineShift: line.shift,
      seedVersion, usersVersion,
      generatedAt: Date.now(),
      language: window._LANG || 'en',
      shiftBoundaries: { day: '06:00', afternoon: '14:00', night: '22:00' },
      employees: employees.filter(e => e.active !== false),
      positions,
      users: users.filter(u => u.active !== false)
    };
  },

  async importSeed(seed) {
    if (seed.schemaVersion !== 2) throw new Error('Invalid seed schema version');
    if (!seed.lineId || !seed.employees) throw new Error('Invalid seed file');

    // Write all in sequence (IDB multi-store transactions not easily wrapped)
    for (const emp of seed.employees) {
      try {
        await DB.add('employees', emp);
      } catch (e) {
        await DB.upsertByIndex('employees', 'lineNormName', [emp.lineId, emp.normalizedName], emp);
      }
    }

    for (const pos of seed.positions) {
      try {
        await DB.add('positions', pos);
      } catch (e) {
        await DB.upsertByIndex('positions', 'lineNormName', [pos.lineId, pos.normalizedName], pos);
      }
    }

    for (const user of seed.users) {
      try {
        await DB.add('users', user);
      } catch (e) {
        // ignore
      }
    }

    const deviceId = _uuid();
    await DB.put('devices', {
      id: deviceId, label: `Field Device - ${seed.lineName}`,
      role: 'field', lineId: seed.lineId,
      provisionedAt: Date.now(), lastSyncAt: null,
      seedVersion: seed.seedVersion, usersVersion: seed.usersVersion
    });

    await DB.setSetting('deviceId', deviceId);
    await DB.setSetting('deviceRole', 'field');
    await DB.setSetting('deviceLabel', `Field - ${seed.lineName}`);
    await DB.setSetting('deviceLineId', seed.lineId);
    await DB.setSetting('seedVersion', seed.seedVersion);
    await DB.setSetting('usersVersion', seed.usersVersion);
    await DB.setSetting('language', seed.language || 'en');
    await DB.setSetting('logLocalSequence', 0);
    await DB.setSetting('recLocalSequence', 0);

    window._LANG = seed.language || 'en';
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   importExportService — Excel import/export
───────────────────────────────────────────────────────────────────────── */
const importExportService = {
  async importExcel(file, lineId) {
    if (!window.XLSX) throw new Error(t('no_xlsx'));

    const buf = await _readFile(file);
    const wb = XLSX.read(buf, { type: 'array' });
    const detection = templateMapper.detectMapping(wb);

    if (!detection.valid) {
      return { needsReview: true, detection, workbook: wb, binary: new Uint8Array(buf) };
    }

    return await this._processImport(wb, detection, lineId, new Uint8Array(buf), file.name);
  },

  async _processImport(wb, mapping, lineId, binary, fileName) {
    const ws = wb.Sheets[mapping.sheet];
    const extracted = templateMapper.extractData(ws, mapping);
    const stats = { newEmployees: 0, newPositions: 0, skillRecords: 0 };
    const now = Date.now();

    // Upsert positions
    const posMap = {};
    for (let i = 0; i < extracted.positions.length; i++) {
      const pn = extracted.positions[i].name;
      const norm = pn.trim().toLowerCase();
      let existing = await DB.getByIndex('positions', 'lineNormName', IDBKeyRange.only([lineId, norm]));
      if (!existing) {
        const id = await lineService.addPosition(lineId, pn, false, i);
        posMap[pn] = id;
        stats.newPositions++;
      } else {
        posMap[pn] = existing.id;
      }
    }

    // Upsert employees
    const empMap = {};
    for (const en of extracted.employees) {
      const norm = en.name.trim().toLowerCase();
      let existing = await DB.getByIndex('employees', 'lineNormName', IDBKeyRange.only([lineId, norm]));
      if (!existing) {
        const id = await lineService.addEmployee(lineId, en.name, 'operator');
        empMap[en.name] = id;
        stats.newEmployees++;
      } else {
        empMap[en.name] = existing.id;
      }
    }

    // Upsert skill records
    for (const sk of extracted.skills) {
      if (!sk.level || sk.level === 0) continue;
      const empId = empMap[sk.empName];
      const posId = posMap[sk.posName];
      if (!empId || !posId) continue;

      const rec = skillSM.fromImport(empId, posId, sk.level, lineId);
      try {
        rec.id = await DB.add('skillRecords', rec);
        stats.skillRecords++;
      } catch (e) {
        // Update existing
        const existing = await DB.getByIndex('skillRecords', 'empPos', IDBKeyRange.only([empId, posId]));
        if (existing) {
          const updated = { ...existing, currentLevel: sk.level };
          if (!updated.history) updated.history = [];
          updated.history.push({ type: 'import', fromLevel: existing.currentLevel, toLevel: sk.level, by: 'Excel Import', role: 'system', at: now });
          await DB.put('skillRecords', updated);
          stats.skillRecords++;
        }
      }
    }

    // Save template mapping
    const mappingRecord = {
      lineId, fileName: fileName || '',
      sheetName: mapping.sheet, headerRow: mapping.headerRow,
      rosterCol: mapping.rosterCol, firstPositionCol: mapping.firstPositionCol,
      firstRosterRow: mapping.firstRosterRow, detectionMethod: mapping.method,
      templateBinary: binary, savedAt: Date.now()
    };
    await DB.upsertByIndex('templateMappings', 'lineId', lineId, mappingRecord);

    return { needsReview: false, stats, mapping };
  },

  async saveMapping(wb, mapping, lineId, binary, fileName) {
    return await this._processImport(wb, mapping, lineId, binary, fileName);
  },

  async exportExcel(lineId) {
    if (!window.XLSX) throw new Error(t('no_xlsx'));
    const tmRecord = await DB.getByIndex('templateMappings', 'lineId', lineId);
    if (!tmRecord) throw new Error(t('no_template'));

    const [employees, positions, skillRecords] = await Promise.all([
      DB.getAllByIndex('employees', 'lineId', lineId),
      DB.getAllByIndex('positions', 'lineId', lineId),
      DB.getAllByIndex('skillRecords', 'lineId', lineId),
    ]);

    const activeEmps = employees.filter(e => e.active !== false)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const sortedPos = positions.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const wb = XLSX.read(tmRecord.templateBinary, { type: 'array' });
    const ws = wb.Sheets[tmRecord.sheetName];
    const m = tmRecord;

    const skillMap = {};
    skillRecords.forEach(r => { skillMap[`${r.employeeId}_${r.positionId}`] = r; });

    // Write positions to header row
    sortedPos.forEach((pos, i) => {
      const addr = XLSX.utils.encode_cell({ r: m.headerRow, c: m.firstPositionCol + i });
      if (ws[addr]) { ws[addr].v = pos.name; ws[addr].w = pos.name; }
      else ws[addr] = { t: 's', v: pos.name };
    });

    // Write employees + skill grid
    activeEmps.forEach((emp, ei) => {
      const rosterAddr = XLSX.utils.encode_cell({ r: m.firstRosterRow + ei, c: m.rosterCol });
      if (ws[rosterAddr]) { ws[rosterAddr].v = emp.name; ws[rosterAddr].w = emp.name; }
      else ws[rosterAddr] = { t: 's', v: emp.name };

      sortedPos.forEach((pos, pi) => {
        const cellAddr = XLSX.utils.encode_cell({ r: m.firstRosterRow + ei, c: m.firstPositionCol + pi });
        const sr = skillMap[`${emp.id}_${pos.id}`];
        const level = sr ? sr.currentLevel : 0;
        if (ws[cellAddr]) { ws[cellAddr].v = level; ws[cellAddr].w = String(level); ws[cellAddr].t = 'n'; }
        else ws[cellAddr] = { t: 'n', v: level };
      });
    });

    // Update range
    const lastR = m.firstRosterRow + activeEmps.length - 1;
    const lastC = m.firstPositionCol + sortedPos.length - 1;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastR, c: lastC } });

    const date = new Date().toISOString().slice(0, 10);
    const line = AppState.lines.find(l => l.id === lineId);
    XLSX.writeFile(wb, `SkillMatrix_${line ? line.name.replace(/\s/g, '_') : lineId}_${date}.xlsx`);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────── */
function _readFile(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = e => rej(e);
    reader.readAsArrayBuffer(file);
  });
}

async function _sha256(str) {
  try {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // Fallback for non-secure context
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(16);
  }
}

function _uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
