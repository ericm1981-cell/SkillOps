/**
 * skillSM — Pure skill level state machine. No DB, no DOM, no side effects.
 */
const skillSM = (() => {

  function blank(employeeId, positionId) {
    return {
      employeeId, positionId,
      currentLevel: 0, requestedLevel: null,
      status: 'approved',
      approvals: [], history: []
    };
  }

  function fromImport(employeeId, positionId, level) {
    const rec = blank(employeeId, positionId);
    rec.currentLevel = level;
    if (level > 0) {
      rec.history = [{ fromLevel: 0, toLevel: level, by: 'Excel Import', role: 'import', at: Date.now(), type: 'import' }];
    }
    return rec;
  }

  function isQualified(record) {
    if (!record) return false;
    return record.status === 'approved' && record.currentLevel >= 3;
  }

  function countsFor3x3(record) { return isQualified(record); }

  function addPromotion(record, approverName, approverRole, comment) {
    if (!approverName || !approverName.trim()) return { ok: false, error: 'err_no_name' };
    if (record.currentLevel >= 4) return { ok: false, error: 'err_max_level' };

    const targetLevel = record.currentLevel + 1;
    const needsDual = targetLevel >= 3;
    const now = Date.now();

    if (!needsDual) {
      // Single signature
      const newRec = _deepClone(record);
      newRec.currentLevel = targetLevel;
      newRec.requestedLevel = null;
      newRec.status = 'approved';
      newRec.approvals = [{ approverName, role: approverRole, timestamp: now, comment: comment || '', forLevel: targetLevel }];
      newRec.history = [...record.history, { fromLevel: record.currentLevel, toLevel: targetLevel, by: approverName, role: approverRole, at: now, type: 'promotion' }];
      return { ok: true, newRecord: newRec, promoted: true, pendingDual: false };
    }

    // Dual signature required
    if (record.status !== 'pending_dual') {
      // First signature
      const newRec = _deepClone(record);
      newRec.requestedLevel = targetLevel;
      newRec.status = 'pending_dual';
      newRec.approvals = [{ approverName, role: approverRole, timestamp: now, comment: comment || '', forLevel: targetLevel }];
      return { ok: true, newRecord: newRec, promoted: false, pendingDual: true };
    }

    // Second signature
    const firstApprover = record.approvals[0];
    if (firstApprover && firstApprover.approverName === approverName.trim()) {
      return { ok: false, error: 'err_same_person' };
    }
    const roles = [firstApprover?.role, approverRole];
    if (!roles.includes('supervisor')) {
      return { ok: false, error: 'err_need_supervisor' };
    }

    const newRec = _deepClone(record);
    newRec.currentLevel = targetLevel;
    newRec.requestedLevel = null;
    newRec.status = 'approved';
    newRec.approvals = [
      ...record.approvals,
      { approverName, role: approverRole, timestamp: now, comment: comment || '', forLevel: targetLevel }
    ];
    newRec.history = [...record.history, { fromLevel: record.currentLevel, toLevel: targetLevel, by: approverName, role: approverRole, at: now, type: 'promotion' }];
    return { ok: true, newRecord: newRec, promoted: true, pendingDual: false };
  }

  function demote(record, supervisorName, targetLevel, reason) {
    if (!supervisorName || !supervisorName.trim()) return { ok: false, error: 'err_no_name' };
    if (!reason || !reason.trim()) return { ok: false, error: 'err_reason_required' };
    if (targetLevel >= record.currentLevel) return { ok: false, error: 'err_reason_required' };

    const newRec = _deepClone(record);
    newRec.currentLevel = targetLevel;
    newRec.requestedLevel = null;
    newRec.status = 'approved';
    newRec.approvals = [];
    newRec.history = [...record.history, {
      fromLevel: record.currentLevel, toLevel: targetLevel,
      by: supervisorName, role: 'supervisor', at: Date.now(),
      reason: reason.trim(), type: 'demotion'
    }];
    return { ok: true, newRecord: newRec };
  }

  function _deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  return { blank, fromImport, isQualified, countsFor3x3, addPromotion, demote };
})();
