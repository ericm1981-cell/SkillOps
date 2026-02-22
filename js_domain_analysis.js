/**
 * crossTraining — Pure 3×3 analysis. No DB, no DOM.
 */
const crossTraining = (() => {
  function analyze(employees, positions, skillRecords) {
    // Build lookup: "empId_posId" -> record
    const map = {};
    skillRecords.forEach(r => { map[`${r.employeeId}_${r.positionId}`] = r; });

    const isQ = (empId, posId) => {
      const r = map[`${empId}_${posId}`];
      return r && r.status === 'approved' && r.currentLevel >= 3;
    };

    const activeEmps = employees.filter(e => e.active !== false);

    // Position status
    const positionStatus = positions.map(pos => {
      const qualified = activeEmps.filter(e => isQ(e.id, pos.id));
      const count = qualified.length;
      return {
        id: pos.id, name: pos.name, critical: pos.critical, count,
        status: count >= 3 ? 'met' : count > 0 ? 'partial' : 'critical',
        qualifiedEmployeeIds: qualified.map(e => e.id)
      };
    });

    // Employee status
    const employeeStatus = activeEmps.map(emp => {
      const qualified = positions.filter(pos => isQ(emp.id, pos.id));
      const count = qualified.length;
      return {
        id: emp.id, name: emp.name, count,
        status: count >= 3 ? 'met' : count > 0 ? 'partial' : 'critical',
        qualifiedPositionIds: qualified.map(p => p.id)
      };
    });

    // Recommendations: positions not yet at 3, sorted by count asc
    const recommendations = positionStatus
      .filter(p => p.count < 3)
      .sort((a, b) => a.count - b.count || (b.critical ? 1 : 0) - (a.critical ? 1 : 0))
      .map(ps => {
        const candidates = activeEmps
          .filter(e => !isQ(e.id, ps.id))
          .map(e => {
            const r = map[`${e.id}_${ps.id}`];
            return { employeeId: e.id, name: e.name, currentLevel: r ? r.currentLevel : 0, status: r ? r.status : 'none' };
          })
          .sort((a, b) => b.currentLevel - a.currentLevel)
          .slice(0, 5);
        return { positionId: ps.id, positionName: ps.name, critical: ps.critical, need: 3 - ps.count, currentL3Count: ps.count, candidates };
      });

    const summary = {
      positionsMet:      positionStatus.filter(p => p.status === 'met').length,
      positionsPartial:  positionStatus.filter(p => p.status === 'partial').length,
      positionsCritical: positionStatus.filter(p => p.status === 'critical').length,
      employeesMet:      employeeStatus.filter(e => e.status === 'met').length,
      employeesPartial:  employeeStatus.filter(e => e.status === 'partial').length,
      employeesCritical: employeeStatus.filter(e => e.status === 'critical').length,
      totalSlots: employees.length * positions.length,
      filledSlots: skillRecords.filter(r => r.currentLevel > 0).length,
    };
    summary.fillRate = summary.totalSlots ? summary.filledSlots / summary.totalSlots : 0;

    return { positionStatus, employeeStatus, recommendations, summary };
  }

  return { analyze };
})();

/**
 * auditScheduler — Pure audit selection logic. No DB, no DOM.
 */
const auditScheduler = (() => {
  function selectAudit({ positions, auditHistory, today }) {
    if (!positions || !positions.length) return null;

    // Only count audits where result is not null (completed)
    const auditedSet = new Set(auditHistory.filter(a => a.result !== null).map(a => a.positionId));
    let pool = positions.filter(p => !auditedSet.has(p.id));
    let cycleReset = false;

    if (!pool.length) {
      cycleReset = true;
      pool = [...positions];
    }

    const selected = pool[Math.floor(Math.random() * pool.length)];
    return { positionId: selected.id, positionName: selected.name, cycleReset };
  }

  function getTodaysAudit(auditLogs, supervisorId, today) {
    return auditLogs.find(a => a.supervisorId === supervisorId && a.date === today) || null;
  }

  return { selectAudit, getTodaysAudit };
})();
