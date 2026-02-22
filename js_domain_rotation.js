/**
 * rotation — Pure rotation plan generator. No DB, no DOM.
 */
const rotation = (() => {

  function generate({ presentEmployees, positions, qualifiedSet, l2Set, yesterdayPlan, bbMode }) {
    const slots = [], violations = [], gaps = [];
    const periods = ['A', 'B', 'C'];

    // Track per-employee assignment counts today
    const todayCount = {};       // empId -> total assignments
    const todayPositions = {};   // empId -> Set of positionIds assigned today

    presentEmployees.forEach(e => {
      todayCount[e.id] = 0;
      todayPositions[e.id] = new Set();
    });

    // Build yesterday's last assignment map for tie-breaking
    const yesterdayMap = {}; // empId -> positionId
    if (yesterdayPlan && yesterdayPlan.slots) {
      yesterdayPlan.slots.forEach(s => { yesterdayMap[s.employeeId] = s.positionId; });
    }

    periods.forEach(period => {
      const periodUsed = new Set(); // empIds used this period

      positions.forEach(pos => {
        const key = (empId) => `${empId}_${pos.id}`;

        // Pool1: qualified, not in period, not assigned this pos today
        const pool1 = presentEmployees.filter(e =>
          qualifiedSet.has(key(e.id)) &&
          !periodUsed.has(e.id) &&
          !todayPositions[e.id]?.has(pos.id)
        );

        // Pool2: qualified, not in period, but WAS assigned this pos today
        const pool2 = presentEmployees.filter(e =>
          qualifiedSet.has(key(e.id)) &&
          !periodUsed.has(e.id) &&
          todayPositions[e.id]?.has(pos.id)
        );

        // Pool3: qualified, already in period (double assign)
        const pool3 = presentEmployees.filter(e =>
          qualifiedSet.has(key(e.id)) && periodUsed.has(e.id)
        );

        // Pool4: L2, not in period
        const pool4 = presentEmployees.filter(e =>
          l2Set.has(key(e.id)) && !periodUsed.has(e.id)
        );

        let chosen = null, violationReason = null;

        if (pool1.length) {
          chosen = _tieBreak(pool1, todayCount, yesterdayMap, pos.id);
        } else if (pool2.length) {
          chosen = _tieBreak(pool2, todayCount, yesterdayMap, pos.id);
          violationReason = 'violation_repeat';
        } else if (pool3.length) {
          chosen = _tieBreak(pool3, todayCount, yesterdayMap, pos.id);
          violationReason = 'violation_double';
        } else if (pool4.length) {
          chosen = _tieBreak(pool4, todayCount, yesterdayMap, pos.id);
          violationReason = 'violation_underqualified';
        }

        if (chosen) {
          slots.push({ period, employeeId: chosen.id, employeeName: chosen.name, positionId: pos.id, positionName: pos.name, violation: !!violationReason, violationReason });
          if (violationReason) violations.push({ period, positionId: pos.id, positionName: pos.name, employeeId: chosen.id, reason: violationReason });
          periodUsed.add(chosen.id);
          todayCount[chosen.id] = (todayCount[chosen.id] || 0) + 1;
          if (!todayPositions[chosen.id]) todayPositions[chosen.id] = new Set();
          todayPositions[chosen.id].add(pos.id);
        } else {
          gaps.push({ period, positionId: pos.id, positionName: pos.name });
        }
      });
    });

    // Suggestions: positions with violations or gaps
    const urgencyMap = {};
    [...violations, ...gaps].forEach(v => {
      urgencyMap[v.positionId] = (urgencyMap[v.positionId] || 0) + 1;
    });

    const suggestions = Object.entries(urgencyMap)
      .map(([posId, urgencyScore]) => {
        const pos = positions.find(p => p.id == posId);
        if (!pos) return null;
        const currentL3Count = presentEmployees.filter(e => qualifiedSet.has(`${e.id}_${posId}`)).length;
        const candidates = presentEmployees
          .filter(e => {
            const k = `${e.id}_${posId}`;
            return !qualifiedSet.has(k); // not yet L3+
          })
          .map(e => {
            const k = `${e.id}_${posId}`;
            const level = l2Set.has(k) ? 2 : 0;
            return { employeeId: e.id, name: e.name, currentLevel: level };
          })
          .sort((a, b) => b.currentLevel - a.currentLevel)
          .slice(0, 5);
        return { positionId: pos.id, positionName: pos.name, urgencyScore, currentL3Count, candidates };
      })
      .filter(Boolean)
      .sort((a, b) => b.urgencyScore - a.urgencyScore || a.currentL3Count - b.currentL3Count);

    return { slots, violations, gaps, suggestions };
  }

  function _tieBreak(pool, todayCount, yesterdayMap, positionId) {
    return pool.slice().sort((a, b) => {
      const ca = todayCount[a.id] || 0, cb = todayCount[b.id] || 0;
      if (ca !== cb) return ca - cb;
      // Prefer employee whose yesterday assignment was NOT this position
      const ya = yesterdayMap[a.id] === positionId ? 1 : 0;
      const yb = yesterdayMap[b.id] === positionId ? 1 : 0;
      return ya - yb;
    })[0];
  }

  return { generate };
})();
