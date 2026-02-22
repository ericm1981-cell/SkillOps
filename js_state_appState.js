/**
 * AppState — Single mutable in-memory state. Services update it after DB writes.
 */
const AppState = (() => {
  const state = {
    lines: [],
    employees: [],      // active line's employees
    positions: [],      // active line's positions
    users: [],
    skillRecords: [],   // active line's skill records
    skillMap: new Map(),         // "empId_posId" -> SkillRecord
    qualifiedSet: new Set(),     // "empId_posId" where L3+ approved
    l2Set: new Set(),            // "empId_posId" where level===2
    todayAttendance: null,       // Map<empId, AttendanceRecord>
    templateMapping: null,
    currentRotation: null,
    recentLogs: [],
    currentLineId: null,
    settings: { language: 'en', maxRotationPlansPerLine: 30 }
  };

  function _buildMaps() {
    state.skillMap.clear();
    state.qualifiedSet.clear();
    state.l2Set.clear();
    state.skillRecords.forEach(r => {
      const key = `${r.employeeId}_${r.positionId}`;
      state.skillMap.set(key, r);
      if (r.status === 'approved' && r.currentLevel >= 3) state.qualifiedSet.add(key);
      if (r.currentLevel === 2) state.l2Set.add(key);
    });
  }

  function setLineData({ employees, positions, skillRecords, lineId }) {
    state.employees = employees.filter(e => e.active !== false);
    state.positions = positions.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    state.skillRecords = skillRecords;
    state.currentLineId = lineId;
    state.todayAttendance = null;
    state.currentRotation = null;
    _buildMaps();
  }

  function setLines(lines) { state.lines = lines; }
  function setUsers(users) { state.users = users; }

  function updateSkillRecord(record) {
    const idx = state.skillRecords.findIndex(r => r.id === record.id);
    if (idx >= 0) state.skillRecords[idx] = record;
    else state.skillRecords.push(record);
    _buildMaps();
  }

  function setAttendance(map) { state.todayAttendance = map; }
  function setTemplateMapping(m) { state.templateMapping = m; }
  function setCurrentRotation(plan) { state.currentRotation = plan; }
  function setRecentLogs(logs) { state.recentLogs = logs; }

  function getSkillRecord(empId, posId) {
    return state.skillMap.get(`${empId}_${posId}`) || null;
  }

  function getPresentEmployees(date) {
    const att = state.todayAttendance;
    return state.employees.filter(emp => {
      if (!att) return true;
      const rec = att.get(emp.id);
      if (!rec) return true; // default present
      return rec.status === 'present' || rec.status === 'partial';
    });
  }

  return {
    get(key) { return state[key]; },
    setLineData, setLines, setUsers, updateSkillRecord,
    setAttendance, setTemplateMapping, setCurrentRotation, setRecentLogs,
    getSkillRecord, getPresentEmployees,
    get employees() { return state.employees; },
    get positions()  { return state.positions;  },
    get skillRecords() { return state.skillRecords; },
    get skillMap()   { return state.skillMap;   },
    get qualifiedSet() { return state.qualifiedSet; },
    get l2Set()      { return state.l2Set;      },
    get users()      { return state.users;      },
    get lines()      { return state.lines;      },
    get currentLineId() { return state.currentLineId; },
    get todayAttendance() { return state.todayAttendance; },
    get templateMapping() { return state.templateMapping; },
    get currentRotation() { return state.currentRotation; },
    get recentLogs()  { return state.recentLogs;  },
    get settings()   { return state.settings;   },
  };
})();

/**
 * Session — sessionStorage wrapper
 */
const Session = (() => {
  const KEY_USER = 'sm_userId';
  const KEY_ROLE = 'sm_userRole';
  const KEY_NAME = 'sm_userName';

  function set(userId, role, name) {
    sessionStorage.setItem(KEY_USER, String(userId));
    sessionStorage.setItem(KEY_ROLE, role);
    sessionStorage.setItem(KEY_NAME, name);
  }
  function clear() {
    sessionStorage.removeItem(KEY_USER);
    sessionStorage.removeItem(KEY_ROLE);
    sessionStorage.removeItem(KEY_NAME);
  }
  function get() {
    const id = sessionStorage.getItem(KEY_USER);
    if (!id) return null;
    return { id: parseInt(id), role: sessionStorage.getItem(KEY_ROLE), name: sessionStorage.getItem(KEY_NAME) };
  }
  function isSupervisor() { const s = get(); return s && s.role === 'supervisor'; }
  function isLoggedIn() { return !!get(); }

  return { set, clear, get, isSupervisor, isLoggedIn };
})();
